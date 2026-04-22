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
const CYCLE = 100;

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

  it('accepts a well-formed entry with a cycleId', () => {
    expect(buffer.push(APP_A, entry(), CYCLE)).toBe('accepted');
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('drops invalid appId', () => {
    expect(buffer.push('', entry(), CYCLE)).toBe('dropped');
    expect(buffer.push(undefined as unknown as string, entry(), CYCLE)).toBe('dropped');
  });

  it('drops entries missing required fields', () => {
    expect(buffer.push(APP_A, { message: 'm' } as unknown as RuntimeErrorEntry, CYCLE)).toBe(
      'dropped'
    );
    expect(buffer.push(APP_A, { name: 'n' } as unknown as RuntimeErrorEntry, CYCLE)).toBe(
      'dropped'
    );
    expect(buffer.size(APP_A)).toBe(0);
  });

  it('drops entries whose cycleId is missing or non-finite', () => {
    expect(buffer.push(APP_A, entry(), undefined as unknown as number)).toBe('dropped');
    expect(buffer.push(APP_A, entry(), Number.NaN)).toBe('dropped');
    expect(buffer.push(APP_A, entry(), Infinity)).toBe('dropped');
    expect(buffer.size(APP_A)).toBe(0);
  });

  it('dedups identical signatures within the push window', () => {
    expect(buffer.push(APP_A, entry(), CYCLE)).toBe('accepted');
    expect(buffer.push(APP_A, entry(), CYCLE)).toBe('deduped');
    expect(buffer.push(APP_A, entry(), CYCLE)).toBe('deduped');
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('treats different signatures as separate entries', () => {
    expect(buffer.push(APP_A, entry({ message: 'one' }), CYCLE)).toBe('accepted');
    expect(buffer.push(APP_A, entry({ message: 'two' }), CYCLE)).toBe('accepted');
    expect(buffer.size(APP_A)).toBe(2);
  });

  it('keeps different apps isolated', () => {
    buffer.push(APP_A, entry(), CYCLE);
    buffer.push(APP_B, entry(), CYCLE);
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
    // record.
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
    expect(buffer.push(APP_A, entry(), CYCLE)).toBe('accepted');
    nowSpy.mockReturnValue(1000);
    expect(
      buffer.push(APP_A, entry({ message: 'other', stack: 'at b (src/b:1:1)' }), CYCLE)
    ).toBe('accepted');
    nowSpy.mockReturnValue(1900);
    expect(buffer.push(APP_A, entry(), CYCLE)).toBe('deduped');
    nowSpy.mockReturnValue(3500);
    expect(buffer.push(APP_A, entry(), CYCLE)).toBe('deduped');
    expect(buffer.size(APP_A)).toBe(2);
    nowSpy.mockRestore();
  });

  it('evicts oldest entry when exceeding MAX_PER_APP', () => {
    for (let i = 0; i < 51; i++) {
      buffer.push(APP_A, entry({ message: `m-${i}`, stack: `at a${i}` }), CYCLE);
    }
    expect(buffer.size(APP_A)).toBe(50);
    const out = buffer.drainForTurn(APP_A, { seenSignatures: new Set() });
    expect(out).toHaveLength(50);
    expect(out[0]!.message).toBe('m-1');
  });
});

describe('RuntimeErrorBuffer.drainForTurn', () => {
  let buffer: RuntimeErrorBuffer;

  beforeEach(() => {
    buffer = new RuntimeErrorBuffer();
  });

  it('returns nothing for an unknown appId', () => {
    const out = buffer.drainForTurn('missing', { seenSignatures: new Set() });
    expect(out).toEqual([]);
  });

  it('returns nothing when no cycle has been announced for the app', () => {
    // Belt-and-suspenders: pushes without a preceding cycle auto-rotate,
    // so in practice the app always has a cycle by the time drain runs.
    // This asserts the explicit guard for a hypothetical direct call.
    const out = buffer.drainForTurn(APP_A, { seenSignatures: new Set() });
    expect(out).toEqual([]);
  });

  it('skips already-seen signatures and mutates the set with returned ones', () => {
    buffer.push(APP_A, entry({ message: 'first' }), CYCLE);
    buffer.push(APP_A, entry({ message: 'second', stack: 'at b' }), CYCLE);

    const seen = new Set<string>();
    const first = buffer.drainForTurn(APP_A, { seenSignatures: seen });
    expect(first).toHaveLength(2);
    expect(seen.size).toBe(2);

    const second = buffer.drainForTurn(APP_A, { seenSignatures: seen });
    expect(second).toEqual([]);
  });

  it('is non-destructive: two independent callers each see all entries', () => {
    buffer.push(APP_A, entry(), CYCLE);
    const seenOne = new Set<string>();
    const seenTwo = new Set<string>();
    expect(buffer.drainForTurn(APP_A, { seenSignatures: seenOne })).toHaveLength(1);
    expect(buffer.drainForTurn(APP_A, { seenSignatures: seenTwo })).toHaveLength(1);
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('returns entries in push order', () => {
    buffer.push(APP_A, entry({ message: 'a', stack: 'at a' }), CYCLE);
    buffer.push(APP_A, entry({ message: 'b', stack: 'at b' }), CYCLE);
    buffer.push(APP_A, entry({ message: 'c', stack: 'at c' }), CYCLE);
    const out = buffer.drainForTurn(APP_A, { seenSignatures: new Set() });
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
    runtimeErrorBuffer.push(APP_A, entry(), CYCLE);
    expect(runtimeErrorBuffer.size(APP_A)).toBe(1);
  });
});

describe('RuntimeErrorBuffer cycle rotation', () => {
  let buffer: RuntimeErrorBuffer;

  beforeEach(() => {
    buffer = new RuntimeErrorBuffer();
  });

  it('rotateCycle establishes the initial generation without affecting empty buffer', () => {
    buffer.rotateCycle(APP_A, 100);
    expect(buffer.getCurrentCycleId(APP_A)).toBe(100);
    expect(buffer.size(APP_A)).toBe(0);
  });

  it('rotateCycle advances to a strictly greater cycleId and evicts stale entries', () => {
    buffer.push(APP_A, entry({ message: 'gen-100-a' }), 100);
    buffer.push(APP_A, entry({ message: 'gen-100-b', stack: 'at b' }), 100);
    expect(buffer.size(APP_A)).toBe(2);

    buffer.rotateCycle(APP_A, 200);
    expect(buffer.size(APP_A)).toBe(0);
    expect(buffer.getCurrentCycleId(APP_A)).toBe(200);
  });

  it('rotateCycle is a no-op when the incoming cycleId is stale or equal', () => {
    buffer.rotateCycle(APP_A, 100);
    buffer.push(APP_A, entry({ message: 'current' }), 100);

    buffer.rotateCycle(APP_A, 50);
    expect(buffer.getCurrentCycleId(APP_A)).toBe(100);
    expect(buffer.size(APP_A)).toBe(1);

    buffer.rotateCycle(APP_A, 100);
    expect(buffer.getCurrentCycleId(APP_A)).toBe(100);
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('push with a stale cycleId is dropped as stale', () => {
    buffer.rotateCycle(APP_A, 100);
    expect(buffer.push(APP_A, entry(), 50)).toBe('stale');
    expect(buffer.size(APP_A)).toBe(0);
  });

  it('push with a future cycleId auto-rotates the app and accepts the entry', () => {
    // Covers the race where the browser bumps its cycle and reports a
    // fresh error under the new id before the corresponding /cycle
    // POST has reached the server.
    buffer.rotateCycle(APP_A, 100);
    buffer.push(APP_A, entry({ message: 'old-gen' }), 100);
    expect(buffer.size(APP_A)).toBe(1);

    expect(buffer.push(APP_A, entry({ message: 'new-gen' }), 200)).toBe('accepted');
    expect(buffer.getCurrentCycleId(APP_A)).toBe(200);
    // The old-gen entry was evicted by the auto-rotate.
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('first push for an app establishes the cycle without a prior rotateCycle', () => {
    // Dev-tools announces the cycle on load, but the race where an
    // error POST arrives first is possible. Push-driven rotation
    // handles it transparently.
    expect(buffer.push(APP_A, entry(), 100)).toBe('accepted');
    expect(buffer.getCurrentCycleId(APP_A)).toBe(100);
    expect(buffer.size(APP_A)).toBe(1);
  });

  it('rotateCycle ignores invalid inputs', () => {
    buffer.rotateCycle('', 100);
    buffer.rotateCycle(APP_A, Number.NaN);
    buffer.rotateCycle(APP_A, Infinity);
    expect(buffer.getCurrentCycleId(APP_A)).toBeUndefined();
  });

  it('different apps maintain independent current cycleIds', () => {
    buffer.rotateCycle(APP_A, 100);
    buffer.rotateCycle(APP_B, 500);
    expect(buffer.getCurrentCycleId(APP_A)).toBe(100);
    expect(buffer.getCurrentCycleId(APP_B)).toBe(500);

    buffer.push(APP_A, entry({ message: 'a' }), 100);
    buffer.push(APP_B, entry({ message: 'b', stack: 'at b' }), 500);
    expect(buffer.size(APP_A)).toBe(1);
    expect(buffer.size(APP_B)).toBe(1);
  });

  it('scenario: mid-turn transient error is evicted on next HMR cycle (the ghost fix)', () => {
    // The whole-point scenario that motivated cycle-based filtering:
    //   1. Agent writes a broken edit → HMR → preview throws.
    //   2. Agent writes a fixing edit → HMR → preview renders clean.
    //   3. Validator drains: should see NO errors.
    //
    // Before cycle filtering, step 1's error would still sit in the
    // buffer and re-surface as a ghost.
    buffer.rotateCycle(APP_A, 100);

    // Step 1: broken edit → HMR bumps cycle, preview throws under new gen
    buffer.rotateCycle(APP_A, 200);
    buffer.push(
      APP_A,
      entry({ name: 'TypeError', message: 'Cannot read properties of null' }),
      200
    );
    expect(buffer.size(APP_A)).toBe(1);

    // Step 2: fixing edit → HMR bumps cycle, no error thrown this render
    buffer.rotateCycle(APP_A, 300);
    expect(buffer.size(APP_A)).toBe(0);

    const drained = buffer.drainForTurn(APP_A, { seenSignatures: new Set() });
    expect(drained).toEqual([]);
  });

  it('scenario: genuine unfixed error re-appears after HMR as a fresh push', () => {
    // Counterpart to the ghost scenario — we must NOT accidentally
    // suppress errors that are actually still broken. The preview re-
    // throws on every render, so after an HMR cycle bump the new render
    // produces a fresh push under the new gen.
    buffer.rotateCycle(APP_A, 100);
    buffer.push(APP_A, entry({ message: 'still broken' }), 100);

    buffer.rotateCycle(APP_A, 200);
    expect(buffer.size(APP_A)).toBe(0);

    buffer.push(APP_A, entry({ message: 'still broken' }), 200);

    const drained = buffer.drainForTurn(APP_A, { seenSignatures: new Set() });
    expect(drained).toHaveLength(1);
    expect(drained[0]!.message).toBe('still broken');
  });

  it('scenario: late-arriving error from a superseded cycle is dropped as stale', () => {
    // Race: error POST from cycle N is in-flight when the cycle rotates
    // to N+1. When the late POST finally lands it must be dropped
    // rather than admitted into the new cycle.
    buffer.rotateCycle(APP_A, 100);
    buffer.rotateCycle(APP_A, 200);
    expect(buffer.push(APP_A, entry({ message: 'late' }), 100)).toBe('stale');
    expect(buffer.size(APP_A)).toBe(0);
  });
});
