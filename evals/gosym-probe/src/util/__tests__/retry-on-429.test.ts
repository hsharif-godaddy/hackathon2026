import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitError } from 'openai';

import { retryOn429 } from '../retry-on-429.js';
import { sleep } from '../sleep.js';

vi.mock('../sleep.js', () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));

function makeRateLimitError(retryAfterSeconds?: number): RateLimitError {
  const headers = new Headers();
  if (retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(retryAfterSeconds));
  }
  return new RateLimitError(429, undefined, 'rate limited', headers);
}

const defaultOpts = {
  maxRetries: 3,
  defaultWaitMs: 30_000,
};

describe('retryOn429 — success and retry behavior', () => {
  beforeEach(() => {
    vi.mocked(sleep).mockClear();
  });

  it('returns result on first-try success', async () => {
    const result = await retryOn429(() => Promise.resolve('ok'), defaultOpts);
    expect(result).toBe('ok');
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('retries on 429 and returns result on eventual success', async () => {
    let calls = 0;
    const result = await retryOn429(() => {
      calls++;
      if (calls <= 2) throw makeRateLimitError();
      return Promise.resolve('recovered');
    }, defaultOpts);
    expect(result).toBe('recovered');
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(2);
  });

  it('throws RateLimitError after exhausting retries', async () => {
    await expect(
      retryOn429(() => { throw makeRateLimitError(); }, defaultOpts),
    ).rejects.toThrow(RateLimitError);
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(3);
  });

  it('throws non-429 errors immediately without retry', async () => {
    const err = new Error('network failure');
    await expect(
      retryOn429(() => { throw err; }, defaultOpts),
    ).rejects.toThrow('network failure');
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('uses Retry-After header when present', async () => {
    let calls = 0;
    await retryOn429(() => {
      calls++;
      if (calls === 1) throw makeRateLimitError(45);
      return Promise.resolve('ok');
    }, defaultOpts);
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(45_000);
  });

  it('uses defaultWaitMs when Retry-After header is absent', async () => {
    let calls = 0;
    await retryOn429(() => {
      calls++;
      if (calls === 1) throw makeRateLimitError();
      return Promise.resolve('ok');
    }, { ...defaultOpts, defaultWaitMs: 15_000 });
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(15_000);
  });
});

describe('retryOn429 — callbacks', () => {
  beforeEach(() => {
    vi.mocked(sleep).mockClear();
  });

  it('calls onRetry for each retry attempt', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await retryOn429(() => {
      calls++;
      if (calls <= 2) throw makeRateLimitError();
      return Promise.resolve('ok');
    }, { ...defaultOpts, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, maxRetries: 3, waitMs: 30_000 });
    expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxRetries: 3, waitMs: 30_000 });
  });

  it('calls onExhausted when retry budget is exhausted', async () => {
    const onExhausted = vi.fn();
    await expect(
      retryOn429(
        () => { throw makeRateLimitError(); },
        { ...defaultOpts, onExhausted },
      ),
    ).rejects.toThrow(RateLimitError);
    expect(onExhausted).toHaveBeenCalledWith(4); // 1 initial + 3 retries
  });

  it('does not call onExhausted for non-429 errors', async () => {
    const onExhausted = vi.fn();
    await expect(
      retryOn429(
        () => { throw new Error('other'); },
        { ...defaultOpts, onExhausted },
      ),
    ).rejects.toThrow('other');
    expect(onExhausted).not.toHaveBeenCalled();
  });
});

describe('retryOn429 — edge cases', () => {
  beforeEach(() => {
    vi.mocked(sleep).mockClear();
  });

  it('works with maxRetries: 0 (no retries, throws immediately)', async () => {
    await expect(
      retryOn429(
        () => { throw makeRateLimitError(); },
        { ...defaultOpts, maxRetries: 0 },
      ),
    ).rejects.toThrow(RateLimitError);
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('succeeds on the last allowed retry', async () => {
    let calls = 0;
    const result = await retryOn429(() => {
      calls++;
      if (calls <= 3) throw makeRateLimitError();
      return Promise.resolve('last-chance');
    }, defaultOpts);
    expect(result).toBe('last-chance');
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(3);
  });
});
