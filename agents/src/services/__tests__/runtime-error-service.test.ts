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
  RuntimeErrorService,
  runtimeErrorSignature,
  type RuntimeErrorEntry
} from '../runtime-error-service.js';
import { runtimeErrorBuffer } from '../runtime-error-buffer.js';

const TEST_APP_ID = 'test-app-runtime';
const CYCLE = 100;

function makeEntry(overrides: Partial<RuntimeErrorEntry> = {}): RuntimeErrorEntry {
  return {
    name: 'TypeError',
    message: 'x is undefined',
    stack: 'TypeError: x is undefined\n  at foo (src/x:1:1)',
    timestamp: Date.now(),
    ...overrides
  };
}

describe('runtimeErrorSignature', () => {
  it('combines name, message, and first stack frame', () => {
    const sig = runtimeErrorSignature({
      name: 'TypeError',
      message: 'boom',
      stack: '  \n  at foo (src/x:1:1)\n  at bar',
      timestamp: 0
    });
    expect(sig).toBe('TypeError::boom::at foo (src/x:1:1)');
  });

  it('handles missing stack', () => {
    const sig = runtimeErrorSignature({ name: 'E', message: 'm', timestamp: 0 });
    expect(sig).toBe('E::m::');
  });
});

describe('RuntimeErrorService.pollRuntimeErrors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeErrorBuffer._resetForTests();
  });

  it('returns aborted skip when signal is already aborted', async () => {
    const service = new RuntimeErrorService();
    const ac = new AbortController();
    ac.abort();
    const result = await service.pollRuntimeErrors(TEST_APP_ID, { signal: ac.signal });
    expect(result).toEqual({ ok: true, errors: [], skipped: true, reason: 'aborted' });
  });

  it('returns ok:true, errors:[] when buffer is empty within the wait budget', async () => {
    const service = new RuntimeErrorService();
    const result = await service.pollRuntimeErrors(TEST_APP_ID, {
      maxWaitMs: 150,
      quietWindowMs: 50
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toBeUndefined();
  });

  it('returns buffered errors and exits after quiet-window', async () => {
    runtimeErrorBuffer.push(TEST_APP_ID, makeEntry(), CYCLE);
    const service = new RuntimeErrorService();
    const result = await service.pollRuntimeErrors(TEST_APP_ID, {
      maxWaitMs: 3000,
      quietWindowMs: 100
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.name).toBe('TypeError');
    expect(result.durationMs ?? 0).toBeLessThan(1500);
  });

  it('ignores entries from superseded cycles', async () => {
    // Push under cycle 100, then rotate to 200 — the entry should be
    // evicted and the poll should come up clean.
    runtimeErrorBuffer.push(TEST_APP_ID, makeEntry({ message: 'stale' }), 100);
    runtimeErrorBuffer.rotateCycle(TEST_APP_ID, 200);
    const service = new RuntimeErrorService();
    const result = await service.pollRuntimeErrors(TEST_APP_ID, {
      maxWaitMs: 100,
      quietWindowMs: 30
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('dedups across invocations when a shared seenSignatures Set is provided', async () => {
    const service = new RuntimeErrorService();
    const seenSignatures = new Set<string>();

    runtimeErrorBuffer.push(TEST_APP_ID, makeEntry(), CYCLE);

    const first = await service.pollRuntimeErrors(TEST_APP_ID, {
      maxWaitMs: 3000,
      quietWindowMs: 100,
      seenSignatures
    });
    expect(first.errors).toHaveLength(1);
    expect(seenSignatures.size).toBe(1);

    const second = await service.pollRuntimeErrors(TEST_APP_ID, {
      maxWaitMs: 150,
      quietWindowMs: 50,
      seenSignatures
    });
    expect(second.ok).toBe(true);
    expect(second.errors).toEqual([]);
  });

  it('honors abort during polling', async () => {
    const ac = new AbortController();
    const service = new RuntimeErrorService();
    setTimeout(() => ac.abort(), 50);
    const result = await service.pollRuntimeErrors(TEST_APP_ID, {
      maxWaitMs: 5000,
      quietWindowMs: 100,
      signal: ac.signal
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('aborted');
  });

  it('hits max-wait timeout when errors keep arriving', async () => {
    const service = new RuntimeErrorService();
    // Drip one new error per tick so the quiet window never closes.
    let counter = 0;
    const interval = setInterval(() => {
      counter += 1;
      runtimeErrorBuffer.push(
        TEST_APP_ID,
        makeEntry({
          message: `oops-${counter}`,
          stack: `at a${counter}`
        }),
        CYCLE
      );
    }, 60);
    try {
      const begin = Date.now();
      const result = await service.pollRuntimeErrors(TEST_APP_ID, {
        maxWaitMs: 400,
        quietWindowMs: 10_000 // unreachable
      });
      const elapsed = Date.now() - begin;
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(elapsed).toBeGreaterThanOrEqual(350);
    } finally {
      clearInterval(interval);
    }
  });
});

describe('RuntimeErrorService.getCurrentCycleId', () => {
  beforeEach(() => {
    runtimeErrorBuffer._resetForTests();
  });

  it('returns undefined when no cycle has been announced', () => {
    const service = new RuntimeErrorService();
    expect(service.getCurrentCycleId(TEST_APP_ID)).toBeUndefined();
  });

  it('mirrors the buffer after rotation', () => {
    runtimeErrorBuffer.rotateCycle(TEST_APP_ID, 42);
    const service = new RuntimeErrorService();
    expect(service.getCurrentCycleId(TEST_APP_ID)).toBe(42);
  });
});

describe('RuntimeErrorService.waitForCycleAdvance', () => {
  beforeEach(() => {
    runtimeErrorBuffer._resetForTests();
  });

  it('resolves immediately when the cycleId already differs from previousCycleId', async () => {
    runtimeErrorBuffer.rotateCycle(TEST_APP_ID, 200);
    const service = new RuntimeErrorService();
    const begin = Date.now();
    const result = await service.waitForCycleAdvance(TEST_APP_ID, 100, {
      timeoutMs: 1000
    });
    expect(result.advanced).toBe(true);
    expect(result.newCycleId).toBe(200);
    expect(Date.now() - begin).toBeLessThan(200);
  });

  it('resolves with advanced:true when the buffer rotates during the wait', async () => {
    runtimeErrorBuffer.rotateCycle(TEST_APP_ID, 100);
    const service = new RuntimeErrorService();
    setTimeout(() => runtimeErrorBuffer.rotateCycle(TEST_APP_ID, 250), 120);
    const result = await service.waitForCycleAdvance(TEST_APP_ID, 100, {
      timeoutMs: 2000
    });
    expect(result.advanced).toBe(true);
    expect(result.newCycleId).toBe(250);
  });

  it('treats any non-undefined cycleId as an advance when previousCycleId is undefined', async () => {
    const service = new RuntimeErrorService();
    setTimeout(() => runtimeErrorBuffer.rotateCycle(TEST_APP_ID, 7), 80);
    const result = await service.waitForCycleAdvance(TEST_APP_ID, undefined, {
      timeoutMs: 1500
    });
    expect(result.advanced).toBe(true);
    expect(result.newCycleId).toBe(7);
  });

  it('returns advanced:false and records durationMs when the timeout fires', async () => {
    runtimeErrorBuffer.rotateCycle(TEST_APP_ID, 100);
    const service = new RuntimeErrorService();
    const result = await service.waitForCycleAdvance(TEST_APP_ID, 100, {
      timeoutMs: 200
    });
    expect(result.advanced).toBe(false);
    expect(result.newCycleId).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(150);
  });

  it('returns advanced:false immediately when the signal is already aborted', async () => {
    const service = new RuntimeErrorService();
    const ac = new AbortController();
    ac.abort();
    const result = await service.waitForCycleAdvance(TEST_APP_ID, 100, {
      timeoutMs: 5000,
      signal: ac.signal
    });
    expect(result.advanced).toBe(false);
    expect(result.durationMs).toBe(0);
  });

  it('honors signal abort mid-wait without throwing', async () => {
    runtimeErrorBuffer.rotateCycle(TEST_APP_ID, 100);
    const service = new RuntimeErrorService();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 60);
    const result = await service.waitForCycleAdvance(TEST_APP_ID, 100, {
      timeoutMs: 5000,
      signal: ac.signal
    });
    expect(result.advanced).toBe(false);
    expect(result.durationMs).toBeLessThan(1000);
  });
});

