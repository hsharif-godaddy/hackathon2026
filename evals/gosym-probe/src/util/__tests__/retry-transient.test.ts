import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError, InternalServerError, RateLimitError } from 'openai';

import { retryTransient } from '../retry-transient.js';
import { sleep } from '../sleep.js';

vi.mock('../sleep.js', () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));

function makeRateLimitError(retryAfterSeconds?: number): RateLimitError {
  const headers = new Headers();
  if (retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(retryAfterSeconds));
  }
  return new RateLimitError(429, undefined, 'rate limited', headers);
}

function makeServerError(status: number): InternalServerError {
  return new InternalServerError(status, undefined, 'server error', new Headers());
}

const defaultOpts = {
  maxRetries: 3,
  defaultWaitMs: 30_000,
};

describe('retryTransient — 429 rate-limit behavior', () => {
  beforeEach(() => {
    vi.mocked(sleep).mockClear();
  });

  it('returns result on first-try success', async () => {
    const result = await retryTransient(() => Promise.resolve('ok'), defaultOpts);
    expect(result).toBe('ok');
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('retries on 429 and returns result on eventual success', async () => {
    let calls = 0;
    const result = await retryTransient(() => {
      calls++;
      if (calls <= 2) throw makeRateLimitError();
      return Promise.resolve('recovered');
    }, defaultOpts);
    expect(result).toBe('recovered');
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(2);
  });

  it('throws RateLimitError after exhausting retries', async () => {
    await expect(
      retryTransient(() => { throw makeRateLimitError(); }, defaultOpts),
    ).rejects.toThrow(RateLimitError);
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(3);
  });

  it('throws non-retryable errors immediately without retry', async () => {
    const err = new Error('plain error');
    await expect(
      retryTransient(() => { throw err; }, defaultOpts),
    ).rejects.toThrow('plain error');
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('uses Retry-After header when present', async () => {
    let calls = 0;
    await retryTransient(() => {
      calls++;
      if (calls === 1) throw makeRateLimitError(45);
      return Promise.resolve('ok');
    }, defaultOpts);
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(45_000, undefined);
  });

  it('uses defaultWaitMs when Retry-After header is absent', async () => {
    let calls = 0;
    await retryTransient(() => {
      calls++;
      if (calls === 1) throw makeRateLimitError();
      return Promise.resolve('ok');
    }, { ...defaultOpts, defaultWaitMs: 15_000 });
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(15_000, undefined);
  });

  it('threads the abort signal into the backoff sleep', async () => {
    const controller = new AbortController();
    let calls = 0;
    await retryTransient(() => {
      calls++;
      if (calls === 1) throw makeRateLimitError();
      return Promise.resolve('ok');
    }, { ...defaultOpts, signal: controller.signal });
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(30_000, controller.signal);
  });

  it('propagates an abort rejection from sleep without further retries', async () => {
    const abortError = new Error('aborted');
    vi.mocked(sleep).mockRejectedValueOnce(abortError);
    let calls = 0;
    await expect(
      retryTransient(() => {
        calls++;
        throw makeRateLimitError();
      }, defaultOpts),
    ).rejects.toBe(abortError);
    expect(calls).toBe(1); // initial attempt only; sleep rejection stops the loop
  });
});

describe('retryTransient — transient connection/5xx behavior', () => {
  beforeEach(() => {
    vi.mocked(sleep).mockClear();
  });

  it('retries a 5xx error and returns result on eventual success', async () => {
    let calls = 0;
    const result = await retryTransient(() => {
      calls++;
      if (calls === 1) throw makeServerError(503);
      return Promise.resolve('recovered');
    }, defaultOpts);
    expect(result).toBe('recovered');
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(1);
  });

  it('retries a connection error', async () => {
    let calls = 0;
    const result = await retryTransient(() => {
      calls++;
      if (calls === 1) throw new APIConnectionError({ message: 'connection reset' });
      return Promise.resolve('ok');
    }, defaultOpts);
    expect(result).toBe('ok');
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(1);
  });

  it('retries a connection timeout', async () => {
    let calls = 0;
    const result = await retryTransient(() => {
      calls++;
      if (calls === 1) throw new APIConnectionTimeoutError();
      return Promise.resolve('ok');
    }, defaultOpts);
    expect(result).toBe('ok');
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(1);
  });

  it('defaults to 2 transient retries (3 attempts) then throws', async () => {
    let calls = 0;
    await expect(
      retryTransient(() => {
        calls++;
        throw makeServerError(500);
      }, defaultOpts),
    ).rejects.toThrow(InternalServerError);
    expect(calls).toBe(3); // 1 initial + 2 transient retries
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(2);
  });

  it('respects a configured maxTransientRetries override', async () => {
    let calls = 0;
    await expect(
      retryTransient(() => {
        calls++;
        throw makeServerError(502);
      }, { ...defaultOpts, maxTransientRetries: 1 }),
    ).rejects.toThrow(InternalServerError);
    expect(calls).toBe(2); // 1 initial + 1 transient retry
  });

  it('uses transientWaitMs for the transient backoff when provided', async () => {
    let calls = 0;
    await retryTransient(() => {
      calls++;
      if (calls === 1) throw makeServerError(500);
      return Promise.resolve('ok');
    }, { ...defaultOpts, transientWaitMs: 1_000 });
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(1_000, undefined);
  });

  it('falls back to defaultWaitMs for transient backoff when transientWaitMs is unset', async () => {
    let calls = 0;
    await retryTransient(() => {
      calls++;
      if (calls === 1) throw makeServerError(500);
      return Promise.resolve('ok');
    }, defaultOpts);
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(30_000, undefined);
  });

  it('does not retry a user abort error', async () => {
    await expect(
      retryTransient(() => { throw new APIUserAbortError(); }, defaultOpts),
    ).rejects.toBeInstanceOf(APIUserAbortError);
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('does not retry a 4xx error other than 429', async () => {
    let calls = 0;
    await expect(
      retryTransient(() => {
        calls++;
        throw makeServerError(400);
      }, defaultOpts),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('tracks 429 and transient budgets independently', async () => {
    const errors = [
      makeRateLimitError(),
      makeServerError(503),
      makeRateLimitError(),
    ];
    let calls = 0;
    const result = await retryTransient(() => {
      const err = errors[calls];
      calls++;
      if (err) throw err;
      return Promise.resolve('ok');
    }, { ...defaultOpts, maxRetries: 2, maxTransientRetries: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(4); // 2 rate-limit retries + 1 transient retry consumed
  });
});

describe('retryTransient — callbacks', () => {
  beforeEach(() => {
    vi.mocked(sleep).mockClear();
  });

  it('calls onRetry with kind "rate-limit" for 429 retries', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await retryTransient(() => {
      calls++;
      if (calls <= 2) throw makeRateLimitError();
      return Promise.resolve('ok');
    }, { ...defaultOpts, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, maxRetries: 3, waitMs: 30_000, kind: 'rate-limit' });
    expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxRetries: 3, waitMs: 30_000, kind: 'rate-limit' });
  });

  it('calls onRetry with kind "transient" for connection/5xx retries', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await retryTransient(() => {
      calls++;
      if (calls === 1) throw makeServerError(503);
      return Promise.resolve('ok');
    }, { ...defaultOpts, onRetry });
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, maxRetries: 2, waitMs: 30_000, kind: 'transient' });
  });

  it('calls onExhausted with kind "rate-limit" when the 429 budget is exhausted', async () => {
    const onExhausted = vi.fn();
    await expect(
      retryTransient(
        () => { throw makeRateLimitError(); },
        { ...defaultOpts, onExhausted },
      ),
    ).rejects.toThrow(RateLimitError);
    expect(onExhausted).toHaveBeenCalledWith({ totalAttempts: 4, kind: 'rate-limit' }); // 1 initial + 3 retries
  });

  it('calls onExhausted with kind "transient" when the transient budget is exhausted', async () => {
    const onExhausted = vi.fn();
    await expect(
      retryTransient(
        () => { throw makeServerError(500); },
        { ...defaultOpts, onExhausted },
      ),
    ).rejects.toThrow(InternalServerError);
    expect(onExhausted).toHaveBeenCalledWith({ totalAttempts: 3, kind: 'transient' }); // 1 initial + 2 retries
  });

  it('does not call onExhausted for non-retryable errors', async () => {
    const onExhausted = vi.fn();
    await expect(
      retryTransient(
        () => { throw new Error('other'); },
        { ...defaultOpts, onExhausted },
      ),
    ).rejects.toThrow('other');
    expect(onExhausted).not.toHaveBeenCalled();
  });
});

describe('retryTransient — edge cases', () => {
  beforeEach(() => {
    vi.mocked(sleep).mockClear();
  });

  it('works with maxRetries: 0 (no 429 retries, throws immediately)', async () => {
    await expect(
      retryTransient(
        () => { throw makeRateLimitError(); },
        { ...defaultOpts, maxRetries: 0 },
      ),
    ).rejects.toThrow(RateLimitError);
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('works with maxTransientRetries: 0 (no transient retries, throws immediately)', async () => {
    await expect(
      retryTransient(
        () => { throw makeServerError(500); },
        { ...defaultOpts, maxTransientRetries: 0 },
      ),
    ).rejects.toThrow(InternalServerError);
    expect(vi.mocked(sleep)).not.toHaveBeenCalled();
  });

  it('succeeds on the last allowed 429 retry', async () => {
    let calls = 0;
    const result = await retryTransient(() => {
      calls++;
      if (calls <= 3) throw makeRateLimitError();
      return Promise.resolve('last-chance');
    }, defaultOpts);
    expect(result).toBe('last-chance');
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(3);
  });
});
