/**
 * Tests for the bootstrap-fetch retry helper.
 *
 * `fetchWithRetry` encodes the four branching paths that are the entire
 * mechanism of the preview-auth bootstrap-race mitigation (Layer 2):
 *
 *   1. 5xx response → retry up to MAX_BOOTSTRAP_ATTEMPTS times
 *   2. 4xx / opaque-redirect (status 0) → break early, no retry
 *   3. Network/timeout error → retry (transient)
 *   4. 2xx response → return immediately, no retry
 *
 * Without this coverage a regression in the break condition (e.g. a
 * future "simplify" pass dropping the `< 500` guard and retrying 4xx
 * responses) would silently waste ~1s per failed health check and ship
 * to prod undetected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOOTSTRAP_BACKOFF_BASE_MS,
  BOOTSTRAP_FETCH_TIMEOUT_MS,
  fetchWithRetry,
  MAX_BOOTSTRAP_ATTEMPTS,
} from './useServerPollingStore';

const URL = 'https://preview.example.com';

describe('fetchWithRetry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  // Helper: run the whole retry to completion, advancing fake timers as
  // needed so `setTimeout(...)` for the inter-attempt sleeps resolves.
  // Sleep schedule between attempts: 250ms, 750ms (formula
  // BOOTSTRAP_BACKOFF_BASE_MS * 3^attempt). Each attempt also has its
  // own 5s abort timeout that we don't trigger here unless a test
  // explicitly waits.
  async function runToCompletion<T>(promise: Promise<T>): Promise<T> {
    // Advance well past the maximum sleep budget so all setTimeouts
    // fire deterministically (worst case: attempt 1 sleep 250ms +
    // attempt 2 sleep 750ms = 1000ms, plus any timeouts).
    await vi.advanceTimersByTimeAsync(2000);
    return promise;
  }

  it('returns immediately on first-attempt 200 (no retries)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    const result = await runToCompletion(fetchWithRetry(URL, 'tok'));

    expect(result.response?.status).toBe(200);
    expect(result.lastError).toBeUndefined();
    expect(result.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds on 200', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await runToCompletion(fetchWithRetry(URL, 'tok'));

    expect(result.response?.status).toBe(200);
    expect(result.attempts).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('exhausts all attempts on persistent 5xx', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));

    const result = await runToCompletion(fetchWithRetry(URL, 'tok'));

    expect(result.response?.ok).toBe(false);
    expect(result.attempts).toBe(MAX_BOOTSTRAP_ATTEMPTS);
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_BOOTSTRAP_ATTEMPTS);
    expect(result.lastError).toBeInstanceOf(Error);
  });

  it('breaks early on 4xx (no retry — definitive client error)', async () => {
    // 401 / 404 / etc. won't recover on retry. Avoid burning the ~1s
    // backoff budget for a request that's already settled.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const result = await runToCompletion(fetchWithRetry(URL, 'tok'));

    expect(result.response?.status).toBe(401);
    expect(result.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('breaks early on status 0 (opaque redirect from `redirect: "manual"`)', async () => {
    // dev-supervisor's 307 → builder redirect comes back as an
    // opaque-redirect response (status 0, type 'opaqueredirect') because
    // we set `redirect: 'manual'`. Treat it as definitive — retrying
    // won't change the auth state mid-loop.
    //
    // Use a plain object — Response.status is a getter and can't be
    // reassigned on a real Response instance.
    const opaqueRedirect = { status: 0, ok: false, type: 'opaqueredirect' } as unknown as Response;
    fetchSpy.mockResolvedValueOnce(opaqueRedirect);

    const result = await runToCompletion(fetchWithRetry(URL, 'tok'));

    expect(result.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries when fetch throws (network error / abort)', async () => {
    // First two attempts throw (transient — DNS hiccup, allocation
    // not yet reachable); third succeeds.
    fetchSpy
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await runToCompletion(fetchWithRetry(URL, 'tok'));

    expect(result.response?.status).toBe(200);
    expect(result.attempts).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns lastError after all attempts throw', async () => {
    const networkErr = new TypeError('Failed to fetch');
    fetchSpy.mockRejectedValue(networkErr);

    const result = await runToCompletion(fetchWithRetry(URL, 'tok'));

    expect(result.response).toBeUndefined();
    expect(result.lastError).toBe(networkErr);
    expect(result.attempts).toBe(MAX_BOOTSTRAP_ATTEMPTS);
  });

  it('omits Authorization header when token is null', async () => {
    // PaaS / unauthenticated previews. Helper still functions; it's the
    // caller's choice to pass null.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await runToCompletion(fetchWithRetry(URL, null));

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({});
  });

  it('sets Authorization Bearer when token is provided', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await runToCompletion(fetchWithRetry(URL, 'my-tok'));

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-tok');
  });

  it('uses HEAD method, no-store cache, manual redirect, credentials include', async () => {
    // Pin the request shape — these are load-bearing for the
    // bootstrap-cookie protocol with dev-supervisor.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await runToCompletion(fetchWithRetry(URL, 'tok'));

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('HEAD');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('include');
  });

  it('exposes the constants used in the schedule', () => {
    // Lightweight sanity to keep the constants stable. Tests above hard
    // code MAX_BOOTSTRAP_ATTEMPTS=3 expectations; a refactor that
    // changed the value should fail those, but pin the constants too
    // so the breakage points at the right place.
    expect(MAX_BOOTSTRAP_ATTEMPTS).toBe(3);
    expect(BOOTSTRAP_BACKOFF_BASE_MS).toBe(250);
    expect(BOOTSTRAP_FETCH_TIMEOUT_MS).toBe(5000);
  });
});
