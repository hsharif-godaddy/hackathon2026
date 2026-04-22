import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import {
  RuntimeErrorBuffer,
  runtimeErrorBuffer,
  runtimeErrorSignature,
  type RuntimeErrorEntry
} from '../runtime-error-buffer.js';

const APP_A = 'app-alpha';
const APP_B = 'app-beta';

function entry(overrides: Partial<RuntimeErrorEntry> = {}): RuntimeErrorEntry {
  return {
    name: 'TypeError',
    message: 'x is undefined',
    stack: 'TypeError: x is undefined\n  at foo (src/x:1:1)',
    timestamp: 1,
    ...overrides
  };
}

describe('RuntimeErrorBuffer.push', () => {
  let buffer: RuntimeErrorBuffer;

  beforeEach(() => {
    buffer = new RuntimeErrorBuffer();
  });

  it('accepts a well-formed entry', () => {
    expect(buffer.push(APP_A, entry())).toBe('accepted');
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('drops invalid appId', () => {
    expect(buffer.push('', entry())).toBe('dropped');
    expect(buffer.push(undefined as unknown as string, entry())).toBe('dropped');
  });

  it('drops entries missing required fields', () => {
    expect(buffer.push(APP_A, { message: 'm' } as unknown as RuntimeErrorEntry)).toBe('dropped');
    expect(buffer.push(APP_A, { name: 'n' } as unknown as RuntimeErrorEntry)).toBe('dropped');
    expect(buffer.size(APP_A)).toBe(0);
  });

  it('dedups identical signatures within the push window', () => {
    expect(buffer.push(APP_A, entry())).toBe('accepted');
    expect(buffer.push(APP_A, entry())).toBe('deduped');
    expect(buffer.push(APP_A, entry())).toBe('deduped');
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('treats different signatures as separate entries', () => {
    expect(buffer.push(APP_A, entry({ message: 'one' }))).toBe('accepted');
    expect(buffer.push(APP_A, entry({ message: 'two' }))).toBe('accepted');
    expect(buffer.size(APP_A)).toBe(2);
  });

  it('keeps different apps isolated', () => {
    buffer.push(APP_A, entry());
    buffer.push(APP_B, entry());
    expect(buffer.size(APP_A)).toBe(1);
    expect(buffer.size(APP_B)).toBe(1);
  });

  it('dedups a refreshed-then-stale-neighbor entry instead of breaking early', () => {
    // Regression for an early-break bug in the tail-walk dedup: the loop
    // assumed the bucket was monotonic in `pushedAt`, but refreshing an
    // existing entry (`existing.pushedAt = now`) without re-ordering
    // breaks that invariant. When a later-index neighbour's timestamp
    // then aged out of the window, the loop would break before re-
    // checking the refreshed entry and append a duplicate-signature
    // record. Scenario walks through:
    //   t=0   push A          → [A@0]
    //   t=1.0 push B          → [A@0, B@1.0]
    //   t=1.9 push A (dedup)  → [A@1.9, B@1.0]   (A refreshed, B untouched)
    //   t=3.5 push A          → B@1.0 is now outside the 2s window, but
    //                           A@1.9 is still inside it; the fix must
    //                           keep walking and dedup against A.
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
    expect(buffer.push(APP_A, entry())).toBe('accepted');
    nowSpy.mockReturnValue(1000);
    expect(buffer.push(APP_A, entry({ message: 'other', stack: 'at b (src/b:1:1)' }))).toBe('accepted');
    nowSpy.mockReturnValue(1900);
    expect(buffer.push(APP_A, entry())).toBe('deduped');
    nowSpy.mockReturnValue(3500);
    expect(buffer.push(APP_A, entry())).toBe('deduped');
    expect(buffer.size(APP_A)).toBe(2);
    nowSpy.mockRestore();
  });

  it('evicts oldest entry when exceeding MAX_PER_APP', () => {
    for (let i = 0; i < 51; i++) {
      buffer.push(APP_A, entry({ message: `m-${i}`, stack: `at a${i}` }));
    }
    expect(buffer.size(APP_A)).toBe(50);
    // The oldest (message 'm-0') should be gone; drainForTurn with an old
    // `since` and empty seen set should yield 50 entries not starting with
    // 'm-0'.
    const out = buffer.drainForTurn(APP_A, { since: 0, seenSignatures: new Set() });
    expect(out).toHaveLength(50);
    expect(out[0]!.message).toBe('m-1');
  });
});

describe('RuntimeErrorBuffer.drainForTurn', () => {
  let buffer: RuntimeErrorBuffer;
  let fakeNow = 10_000;

  beforeEach(() => {
    buffer = new RuntimeErrorBuffer();
    fakeNow = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
  });

  it('returns nothing for an unknown appId', () => {
    const out = buffer.drainForTurn('missing', { since: 0, seenSignatures: new Set() });
    expect(out).toEqual([]);
  });

  it('filters entries pushed before `since`', () => {
    fakeNow = 100;
    buffer.push(APP_A, entry({ message: 'old' }));
    fakeNow = 500;
    buffer.push(APP_A, entry({ message: 'new', stack: 'at b' }));

    const out = buffer.drainForTurn(APP_A, { since: 200, seenSignatures: new Set() });
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toBe('new');
  });

  it('skips already-seen signatures and mutates the set with returned ones', () => {
    buffer.push(APP_A, entry({ message: 'first' }));
    buffer.push(APP_A, entry({ message: 'second', stack: 'at b' }));

    const seen = new Set<string>();
    const first = buffer.drainForTurn(APP_A, { since: 0, seenSignatures: seen });
    expect(first).toHaveLength(2);
    expect(seen.size).toBe(2);

    const second = buffer.drainForTurn(APP_A, { since: 0, seenSignatures: seen });
    expect(second).toEqual([]);
  });

  it('is non-destructive: two independent callers each see all entries', () => {
    buffer.push(APP_A, entry());
    const seenOne = new Set<string>();
    const seenTwo = new Set<string>();
    expect(buffer.drainForTurn(APP_A, { since: 0, seenSignatures: seenOne })).toHaveLength(1);
    expect(buffer.drainForTurn(APP_A, { since: 0, seenSignatures: seenTwo })).toHaveLength(1);
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('returns entries in push order', () => {
    buffer.push(APP_A, entry({ message: 'a', stack: 'at a' }));
    buffer.push(APP_A, entry({ message: 'b', stack: 'at b' }));
    buffer.push(APP_A, entry({ message: 'c', stack: 'at c' }));
    const out = buffer.drainForTurn(APP_A, { since: 0, seenSignatures: new Set() });
    expect(out.map((e) => e.message)).toEqual(['a', 'b', 'c']);
  });
});

describe('runtimeErrorSignature', () => {
  it('matches between buffer and entries with the same triple', () => {
    const sig = runtimeErrorSignature(entry());
    expect(sig).toContain('TypeError');
    expect(sig).toContain('x is undefined');
  });

  it('uses the first call-site frame so same-message-different-site errors do not collide', () => {
    // V8-shaped stacks lead with a message-echo line (`TypeError: x is
    // undefined`) that the signature must look past; otherwise two
    // distinct call sites hash identically and get collapsed by the
    // push-time dedup window.
    const siteA = runtimeErrorSignature(entry({
      stack: 'TypeError: x is undefined\n  at foo (src/a.ts:10:5)\n  at bar (src/a.ts:20:5)'
    }));
    const siteB = runtimeErrorSignature(entry({
      stack: 'TypeError: x is undefined\n  at baz (src/b.ts:15:7)\n  at qux (src/b.ts:25:7)'
    }));
    expect(siteA).not.toBe(siteB);
    expect(siteA).toContain('at foo');
    expect(siteB).toContain('at baz');
  });

  it('handles Firefox/WebKit-shaped stacks (name@file:line)', () => {
    const sig = runtimeErrorSignature(entry({
      stack: 'foo@http://localhost/src/x.ts:10:5\nbar@http://localhost/src/x.ts:20:5'
    }));
    expect(sig).toContain('foo@http://localhost/src/x.ts:10:5');
  });
});

describe('runtimeErrorBuffer singleton', () => {
  beforeEach(() => {
    runtimeErrorBuffer._resetForTests();
  });

  it('is a shared instance across imports', () => {
    runtimeErrorBuffer.push(APP_A, entry());
    expect(runtimeErrorBuffer.size(APP_A)).toBe(1);
  });
});
