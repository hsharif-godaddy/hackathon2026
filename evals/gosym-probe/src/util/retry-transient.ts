import { APIConnectionError, APIError, RateLimitError } from 'openai';

import { parseRetryAfterMs } from './retry-after.js';
import { sleep } from './sleep.js';

export interface RetryTransientOptions {
  /** Retry budget for 429 rate-limit errors (honors `Retry-After`). */
  maxRetries: number;
  /** Fallback backoff for a 429 when no `Retry-After` header is present. */
  defaultWaitMs: number;
  /**
   * Retry budget for transient connection/5xx errors. These are the failures
   * the OpenAI SDK used to absorb before `maxRetries: 0` made `retryTransient`
   * the single retry layer. Defaults to 2 (the SDK's old default) when unset.
   * Backoff is a fixed `transientWaitMs`.
   */
  maxTransientRetries?: number;
  /** Backoff between transient retries. Defaults to `defaultWaitMs`. */
  transientWaitMs?: number;
  onRetry?: (context: {
    attempt: number;
    maxRetries: number;
    waitMs: number;
    kind: 'rate-limit' | 'transient';
  }) => void;
  onExhausted?: (context: { totalAttempts: number; kind: 'rate-limit' | 'transient' }) => void;
  /**
   * When supplied, an abort during a backoff sleep rejects immediately with the
   * signal's reason instead of waiting out the (potentially multi-minute)
   * `Retry-After` delay. The wrapped `fn` is responsible for honoring the same
   * signal during its own execution.
   */
  signal?: AbortSignal;
}

const DEFAULT_MAX_TRANSIENT_RETRIES = 2;

/**
 * A connection failure (incl. timeouts) or a `>= 500` API response — the
 * transient class the OpenAI SDK retried by default before we disabled its
 * retry layer. Deliberately excludes `APIUserAbortError` (no `status`, and an
 * abort must never be retried) and all 4xx except 429 (handled separately).
 */
function isTransientError(err: unknown): boolean {
  if (err instanceof RateLimitError) return false;
  if (err instanceof APIConnectionError) return true;
  return err instanceof APIError && typeof err.status === 'number' && err.status >= 500;
}

/**
 * Wraps an async function with retry logic for two failure classes, each with
 * its own budget:
 *
 * - **429 rate-limit** (`RateLimitError`): retried up to `maxRetries` times,
 *   honoring `Retry-After` (falling back to `defaultWaitMs`).
 * - **Transient** (connection/timeout/`>=5xx`): retried up to
 *   `maxTransientRetries` times with a fixed `transientWaitMs` backoff. This
 *   restores the resilience the OpenAI SDK provided before `maxRetries: 0`.
 *
 * All other errors (4xx, aborts, etc.) are re-thrown immediately. On budget
 * exhaustion for either class, calls `onExhausted` (if provided) then re-throws
 * the final error. If `opts.signal` aborts during a backoff, the sleep rejects
 * promptly with the signal's reason.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: RetryTransientOptions,
): Promise<T> {
  const maxTransientRetries = opts.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES;
  const transientWaitMs = opts.transientWaitMs ?? opts.defaultWaitMs;
  let rateLimitAttempts = 0;
  let transientAttempts = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RateLimitError && rateLimitAttempts < opts.maxRetries) {
        rateLimitAttempts++;
        const waitMs = parseRetryAfterMs(err.headers) ?? opts.defaultWaitMs;
        opts.onRetry?.({
          attempt: rateLimitAttempts,
          maxRetries: opts.maxRetries,
          waitMs,
          kind: 'rate-limit',
        });
        await sleep(waitMs, opts.signal);
        continue;
      }
      if (isTransientError(err) && transientAttempts < maxTransientRetries) {
        transientAttempts++;
        opts.onRetry?.({
          attempt: transientAttempts,
          maxRetries: maxTransientRetries,
          waitMs: transientWaitMs,
          kind: 'transient',
        });
        await sleep(transientWaitMs, opts.signal);
        continue;
      }
      if (err instanceof RateLimitError) {
        opts.onExhausted?.({ totalAttempts: rateLimitAttempts + 1, kind: 'rate-limit' });
      } else if (isTransientError(err)) {
        opts.onExhausted?.({ totalAttempts: transientAttempts + 1, kind: 'transient' });
      }
      throw err;
    }
  }
}
