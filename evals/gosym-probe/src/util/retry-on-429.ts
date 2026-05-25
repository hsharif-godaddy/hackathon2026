import { RateLimitError } from 'openai';

import { parseRetryAfterMs } from './retry-after.js';
import { sleep } from './sleep.js';

export interface RetryOn429Options {
  maxRetries: number;
  defaultWaitMs: number;
  onRetry?: (context: { attempt: number; maxRetries: number; waitMs: number }) => void;
  onExhausted?: (totalAttempts: number) => void;
}

/**
 * Wraps an async function with 429 rate-limit retry logic.
 *
 * Non-429 errors are re-thrown immediately. On retry budget exhaustion,
 * calls `onExhausted` (if provided) then re-throws the final RateLimitError.
 */
export async function retryOn429<T>(
  fn: () => Promise<T>,
  opts: RetryOn429Options,
): Promise<T> {
  let attempts = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RateLimitError && attempts < opts.maxRetries) {
        attempts++;
        const waitMs = parseRetryAfterMs(err.headers) ?? opts.defaultWaitMs;
        opts.onRetry?.({ attempt: attempts, maxRetries: opts.maxRetries, waitMs });
        await sleep(waitMs);
        continue;
      }
      if (err instanceof RateLimitError) {
        opts.onExhausted?.(attempts + 1);
      }
      throw err;
    }
  }
}
