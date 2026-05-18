/**
 * Tests for the bootstrap-race prevention + retry helpers.
 *
 * Two helpers are exercised here:
 *
 * 1. `waitForViteReady` — polls dev-supervisor's `/airo/health` until the
 *    upstream customer process (vite/node) is actually serving 2xx (no
 *    `reason:"autostart"`). On hibernation, issues a blocking `HEAD /`
 *    with the JWT to trigger dev-supervisor's autostart-and-block path
 *    and treats that response as the readiness signal.
 *
 * 2. `bootstrapWithRetry` — sends an auth-bearing HEAD to
 *    `/airo/auth-check` that causes dev-supervisor's JWT middleware to
 *    set the cross-domain `preview_auth` cookie. The endpoint is
 *    registered directly on the mux (NOT via RequestRouter), so the
 *    response flushes in ~100ms regardless of vite state — cookie reaches
 *    the browser even when the customer process is hibernated. Retries
 *    up to MAX_BOOTSTRAP_ATTEMPTS on 5xx / network errors; breaks early
 *    on 4xx / opaque-redirect.
 *
 * Branching paths covered:
 *
 *   waitForViteReady — vite-starting race (original):
 *   1. /airo/health 200 healthy immediately       → true on first poll
 *   2. /airo/health 503 then 200 healthy          → true once it flips
 *   3. /airo/health stays 503                     → false at deadline
 *   4. fetch throws (network/CORS)                → keep polling, then false
 *
 *   waitForViteReady — hibernation case:
 *   5. /airo/health 200 + autostart, token, HEAD 200 → true (woken up)
 *   6. /airo/health 200 + autostart, no token        → false, no wake-up
 *   7. /airo/health 200 + autostart, HEAD 502        → false
 *   8. /airo/health 200 + autostart, HEAD aborts     → false
 *
 *   waitForViteReady — defensive parsing:
 *   9. 200 with empty body / parse failure         → treated as ready
 *
 *   bootstrapWithRetry:
 *   10. First-attempt 200                          → no retry, attempts=1
 *   11. 503 then 200                               → retry, attempts=2
 *   12. Persistent 5xx                             → exhausts attempts, false
 *   13. 4xx (definitive)                           → break early, attempts=1
 *   14. Status 0 / opaque redirect                 → break early, attempts=1
 *   15. Network error then 200                     → retry, attempts=2+
 *   16. Authorization Bearer / no-token shape pin
 *   17. HEAD + no-store + manual + credentials shape pin
 *   18. URL target is /airo/auth-check (vite-independent)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOOTSTRAP_BACKOFF_BASE_MS,
  BOOTSTRAP_FETCH_TIMEOUT_MS,
  bootstrapWithRetry,
  HEALTH_POLL_INTERVAL_MS,
  HEALTH_POLL_TIMEOUT_MS,
  HEALTH_PROBE_TIMEOUT_MS,
  MAX_BOOTSTRAP_ATTEMPTS,
  waitForViteReady,
  WAKEUP_TIMEOUT_MS,
} from './useServerPollingStore';

const URL = 'https://preview.example.com';

/**
 * Construct a /airo/health Response with a JSON body. Mirrors the shape
 * dev-supervisor sends back (see internal/proxy/http/health.go).
 */
function healthResponse(status: number, body: { status?: string; reason?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('waitForViteReady', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  describe('vite-starting race (original prevention path)', () => {
    it('returns true on first-poll 200 healthy (no reason field)', async () => {
      fetchSpy.mockResolvedValueOnce(healthResponse(200, { status: 'healthy' }));

      const promise = waitForViteReady(URL, 'tok');
      // Flush the in-flight fetch + body parse promise.
      await vi.advanceTimersByTimeAsync(0);

      await expect(promise).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // Hits /airo/health, not the root URL.
      expect(fetchSpy.mock.calls[0]![0]).toMatch(/\/airo\/health$/);
    });

    it('keeps polling on 503 then returns true when health flips to 200 healthy', async () => {
      fetchSpy
        .mockResolvedValueOnce(healthResponse(503, { status: 'unhealthy' }))
        .mockResolvedValueOnce(healthResponse(503, { status: 'unhealthy' }))
        .mockResolvedValueOnce(healthResponse(200, { status: 'healthy' }));

      const promise = waitForViteReady(URL, 'tok');

      // Each polling tick: fetch fires, then HEALTH_POLL_INTERVAL_MS sleep
      // before the next tick. Advance enough to flush ~3 cycles.
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS * 4);

      await expect(promise).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('returns false at deadline when /airo/health stays 503', async () => {
      fetchSpy.mockResolvedValue(healthResponse(503, { status: 'unhealthy' }));

      const promise = waitForViteReady(URL, 'tok');
      // Advance well past the timeout so the deadline check fires.
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_TIMEOUT_MS + 1000);

      await expect(promise).resolves.toBe(false);
      // We don't pin exact call count (depends on interval/deadline math)
      // but it must be > 1 — the helper polled until the deadline.
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    });

    it('keeps polling when fetch throws (network/abort)', async () => {
      // Network errors during startup are common (DNS not resolved, allocation
      // not yet reachable). Helper should treat them like 503 and keep trying.
      fetchSpy
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(healthResponse(200, { status: 'healthy' }));

      const promise = waitForViteReady(URL, 'tok');
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS * 4);

      await expect(promise).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('returns false at deadline when fetch always throws', async () => {
      fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

      const promise = waitForViteReady(URL, 'tok');
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_TIMEOUT_MS + 1000);

      await expect(promise).resolves.toBe(false);
    });
  });

  describe('hibernation case (autostart wake-up)', () => {
    it('fires HEAD wake-up with Bearer when health reports autostart, returns true on 200', async () => {
      fetchSpy
        // First call: /airo/health says hibernated
        .mockResolvedValueOnce(healthResponse(200, { status: 'healthy', reason: 'autostart' }))
        // Second call: HEAD wake-up returns 200 once autostart completes
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const promise = waitForViteReady(URL, 'my-token');
      await vi.advanceTimersByTimeAsync(0);

      await expect(promise).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Pin the wake-up request shape — this is the load-bearing call.
      const [wakeupUrl, wakeupInit] = fetchSpy.mock.calls[1]!;
      expect(wakeupUrl).toBe(URL);
      const init = wakeupInit as RequestInit;
      expect(init.method).toBe('HEAD');
      expect(init.cache).toBe('no-store');
      expect(init.redirect).toBe('manual');
      // Authorization: Bearer <token>
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token');
    });

    it('returns false WITHOUT firing wake-up when token is null', async () => {
      // Without a JWT we can't trigger dev-supervisor's autostart (the
      // RequestRouter sits behind JWT middleware). Skip and let the outer
      // polling cycle retry with a fresh token.
      fetchSpy.mockResolvedValueOnce(
        healthResponse(200, { status: 'healthy', reason: 'autostart' }),
      );

      const promise = waitForViteReady(URL, null);
      await vi.advanceTimersByTimeAsync(0);

      await expect(promise).resolves.toBe(false);
      // Only the /airo/health probe fired. No wake-up request issued.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]![0]).toMatch(/\/airo\/health$/);
    });

    it('returns false when wake-up HEAD returns non-2xx (e.g. autostart timeout 502)', async () => {
      fetchSpy
        .mockResolvedValueOnce(healthResponse(200, { status: 'healthy', reason: 'autostart' }))
        .mockResolvedValueOnce(new Response(null, { status: 502 }));

      const promise = waitForViteReady(URL, 'tok');
      await vi.advanceTimersByTimeAsync(0);

      await expect(promise).resolves.toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns false when wake-up HEAD aborts (WAKEUP_TIMEOUT_MS exceeded)', async () => {
      fetchSpy.mockResolvedValueOnce(
        healthResponse(200, { status: 'healthy', reason: 'autostart' }),
      );
      // Wake-up never resolves; the AbortController inside triggerWakeup
      // aborts it after WAKEUP_TIMEOUT_MS.
      fetchSpy.mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const promise = waitForViteReady(URL, 'tok');
      await vi.advanceTimersByTimeAsync(WAKEUP_TIMEOUT_MS + 1000);

      await expect(promise).resolves.toBe(false);
    });

    it('handles 503 → autostart transition: keeps polling then fires wake-up', async () => {
      fetchSpy
        .mockResolvedValueOnce(healthResponse(503, { status: 'unhealthy' }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // keepalive HEAD (fire-and-forget)
        .mockResolvedValueOnce(healthResponse(200, { status: 'healthy', reason: 'autostart' }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })); // wake-up succeeds

      const promise = waitForViteReady(URL, 'tok');
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL_MS * 2);

      await expect(promise).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      // Second call is the keepalive HEAD (fire-and-forget).
      const [keepaliveUrl, keepaliveInit] = fetchSpy.mock.calls[1]!;
      expect(keepaliveUrl).toBe(URL);
      expect((keepaliveInit as RequestInit).method).toBe('HEAD');
      expect((keepaliveInit as RequestInit).headers).toEqual({ 'Authorization': 'Bearer tok' });
      // Last call should be the wake-up (HEAD to root).
      const [lastUrl, lastInit] = fetchSpy.mock.calls[3]!;
      expect(lastUrl).toBe(URL);
      expect((lastInit as RequestInit).method).toBe('HEAD');
    });
  });

  describe('defensive parsing', () => {
    it('treats a 200 with empty/non-JSON body as ready (no `reason` field present)', async () => {
      // Defensive guard against hypothetical pre-`reason`-field dev-supervisor
      // versions, or any deploy where /airo/health returns a 200 without a
      // body. Absence of `reason: autostart` means "not hibernated", so ready.
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));

      const promise = waitForViteReady(URL, 'tok');
      await vi.advanceTimersByTimeAsync(0);

      await expect(promise).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('request shape', () => {
    it('uses GET, no-store cache, no credentials on /airo/health', async () => {
      // Pin the request shape — /airo/health is JWT-excluded and doesn't
      // need cookies; sending credentials would force a CORS preflight.
      fetchSpy.mockResolvedValueOnce(healthResponse(200, { status: 'healthy' }));

      const promise = waitForViteReady(URL, 'tok');
      await vi.advanceTimersByTimeAsync(0);
      await promise;

      const init = fetchSpy.mock.calls[0]![1] as RequestInit;
      expect(init.method).toBe('GET');
      expect(init.cache).toBe('no-store');
      expect(init.credentials).toBeUndefined();
    });
  });

  describe('exposed constants', () => {
    it('exposes the constants used in the schedule', () => {
      expect(HEALTH_POLL_TIMEOUT_MS).toBe(5000);
      expect(HEALTH_POLL_INTERVAL_MS).toBe(250);
      expect(HEALTH_PROBE_TIMEOUT_MS).toBe(2000);
      // Must accommodate dev-supervisor's autostart budget:
      // 60s state-wait + 30s TCP probe = 90s worst case (server-side).
      // 100s gives a 10s client-side margin.
      expect(WAKEUP_TIMEOUT_MS).toBe(100000);
    });
  });
});

describe('bootstrapWithRetry', () => {
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
  // BOOTSTRAP_BACKOFF_BASE_MS * 3^attempt). Each attempt also has its own
  // 5s abort timeout that we don't trigger here unless a test explicitly
  // waits.
  async function runToCompletion<T>(promise: Promise<T>): Promise<T> {
    // Advance well past the maximum sleep budget so all setTimeouts fire
    // deterministically (worst case: attempt 1 sleep 250ms +
    // attempt 2 sleep 750ms = 1000ms, plus any timeouts).
    await vi.advanceTimersByTimeAsync(2000);
    return promise;
  }

  it('returns immediately on first-attempt 200 (no retries)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await runToCompletion(bootstrapWithRetry(URL, 'tok'));

    expect(result.response?.status).toBe(200);
    expect(result.lastError).toBeUndefined();
    expect(result.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds on 200', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await runToCompletion(bootstrapWithRetry(URL, 'tok'));

    expect(result.response?.status).toBe(200);
    expect(result.attempts).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('exhausts all attempts on persistent 5xx', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));

    const result = await runToCompletion(bootstrapWithRetry(URL, 'tok'));

    expect(result.response?.ok).toBe(false);
    expect(result.attempts).toBe(MAX_BOOTSTRAP_ATTEMPTS);
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_BOOTSTRAP_ATTEMPTS);
    expect(result.lastError).toBeInstanceOf(Error);
  });

  it('breaks early on 4xx (no retry — definitive client error)', async () => {
    // 401 / 404 / etc. won't recover on retry. Avoid burning the ~1s
    // backoff budget for a request that's already settled.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const result = await runToCompletion(bootstrapWithRetry(URL, 'tok'));

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

    const result = await runToCompletion(bootstrapWithRetry(URL, 'tok'));

    expect(result.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries when fetch throws (network error / abort)', async () => {
    // First two attempts throw (transient — DNS hiccup, brief upstream
    // unavailability post-readiness); third succeeds.
    fetchSpy
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await runToCompletion(bootstrapWithRetry(URL, 'tok'));

    expect(result.response?.status).toBe(200);
    expect(result.attempts).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns lastError after all attempts throw', async () => {
    const networkErr = new TypeError('Failed to fetch');
    fetchSpy.mockRejectedValue(networkErr);

    const result = await runToCompletion(bootstrapWithRetry(URL, 'tok'));

    expect(result.response).toBeUndefined();
    expect(result.lastError).toBe(networkErr);
    expect(result.attempts).toBe(MAX_BOOTSTRAP_ATTEMPTS);
  });

  it('omits Authorization header when token is null', async () => {
    // PaaS / unauthenticated previews. Helper still functions; it's the
    // caller's choice to pass null.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await runToCompletion(bootstrapWithRetry(URL, null));

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({});
  });

  it('sets Authorization Bearer when token is provided', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await runToCompletion(bootstrapWithRetry(URL, 'my-tok'));

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-tok');
  });

  it('uses HEAD method, no-store cache, manual redirect, credentials include', async () => {
    // Pin the request shape — these are load-bearing for the
    // bootstrap-cookie protocol with dev-supervisor.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await runToCompletion(bootstrapWithRetry(URL, 'tok'));

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('HEAD');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('include');
  });

  it('targets /airo/auth-check, NOT the preview root', async () => {
    // Critical correctness invariant. /airo/auth-check is registered
    // directly on the mux (server.go:125) and bypasses RequestRouter,
    // so it never triggers autostart and never depends on the customer
    // process being up. Targeting `/` instead would re-introduce the
    // bug where Set-Cookie sits in dev-supervisor's response buffer
    // waiting for autostart to complete (up to 90s) before flushing —
    // which is the failure mode this PR exists to fix.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await runToCompletion(bootstrapWithRetry(URL, 'tok'));

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toBe(`${URL}/airo/auth-check`);
  });

  it('appends /airo/auth-check correctly even if base URL has a trailing slash', async () => {
    // Defensive coverage: callers may pass `https://abc.example.com` or
    // `https://abc.example.com/`. URL constructor handles both, but
    // pin it so a future "tidy up" doesn't accidentally regress.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await runToCompletion(bootstrapWithRetry(`${URL}/`, 'tok'));

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toBe(`${URL}/airo/auth-check`);
  });

  it('exposes the constants used in the schedule', () => {
    // Lightweight sanity to keep the constants stable. Tests above
    // hard-code MAX_BOOTSTRAP_ATTEMPTS=3 expectations; pinning the
    // constants here points future breakage at the right place.
    expect(MAX_BOOTSTRAP_ATTEMPTS).toBe(3);
    expect(BOOTSTRAP_BACKOFF_BASE_MS).toBe(250);
    expect(BOOTSTRAP_FETCH_TIMEOUT_MS).toBe(5000);
  });
});
