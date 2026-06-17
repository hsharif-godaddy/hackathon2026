import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sleep } from '../sleep.js';

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the given duration when no signal is supplied', async () => {
    const resolved = vi.fn();
    const promise = sleep(1_000).then(resolved);
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('resolves after the duration when given a non-aborted signal', async () => {
    const controller = new AbortController();
    const resolved = vi.fn();
    const promise = sleep(1_000, controller.signal).then(resolved);
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('rejects immediately with the reason when the signal is already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);
    await expect(sleep(60_000, controller.signal)).rejects.toBe(reason);
  });

  it('rejects with the reason and cancels the timer when aborted mid-sleep', async () => {
    const controller = new AbortController();
    const reason = new Error('aborted mid-sleep');
    const promise = sleep(300_000, controller.signal);
    const assertion = expect(promise).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort(reason);
    await assertion;
  });
});
