/**
 * @vitest-environment jsdom
 *
 * Integration tests for appFetch's handle401 branch. These exercise the
 * 401 → resolveAuth → retry path against the real resolveAuth module so
 * regressions in the wiring surface even when individual unit tests pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

const domainRef = vi.hoisted(() => ({ value: 'godaddy.com' }));
vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => domainRef.value,
}));

function response401(body: unknown = { authReason: 1 }) {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status: 401, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' } }
  );
}

function response200(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VAT_RECOVERY_DELAY_MS = 2_000;

describe('appFetch handle401', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    domainRef.value = 'godaddy.com';
    (globalThis as unknown as { __gasketConfigCache?: unknown; __gasketConfigPromise?: unknown }).__gasketConfigCache = undefined;
    (globalThis as unknown as { __gasketConfigCache?: unknown; __gasketConfigPromise?: unknown }).__gasketConfigPromise = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries the original request once after successful re-auth', async () => {
    const { appFetch } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // Sequence:
    //   1. Original request → 401
    //   2. resolveAuth probe → 401 (modal opens)
    //   3. After SSO success, verify probe → 200
    //   4. Original request retried → 200
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())  // request
      .mockResolvedValueOnce(response401())  // probe
      .mockResolvedValueOnce(response200())  // verify
      .mockResolvedValueOnce(response200({ data: 'retry-success' }));  // retry
    vi.stubGlobal('fetch', fetchMock);

    const promise = appFetch('/api/things', { method: 'GET' }, { handle401: true });

    // Let the request fire and resolveAuth start its probe
    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

    useAuthUIStore.getState().closeSsoLogin('success');

    const response = await promise;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: 'retry-success' });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('recovers a stale-vat 401 via re-probe and retries without opening the modal', async () => {
    const { appFetch } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // Sequence:
    //   1. Original request → 401 (vat stale)
    //   2. resolveAuth probe → 401 (authReason 3)
    //   3. Spaced re-probe → 200 (browser heartbeat caught up)
    //   4. Original request retried → 200
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401({ authReason: 3 }))
      .mockResolvedValueOnce(response401({ authReason: 3 }))
      .mockResolvedValueOnce(response200())
      .mockResolvedValueOnce(response200({ data: 'retry-success' }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = appFetch('/api/things', { method: 'GET' }, { handle401: true });
    await vi.advanceTimersByTimeAsync(VAT_RECOVERY_DELAY_MS);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: 'retry-success' });
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.vat-recovered',
      expect.objectContaining({ url: '/api/things', authReason: 3 }),
    );
  });

  it('throws AuthDismissedError when the user closes the modal', async () => {
    const { appFetch, AuthDismissedError } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())  // request
      .mockResolvedValueOnce(response401()); // probe
    vi.stubGlobal('fetch', fetchMock);

    const promise = appFetch('/api/things', { method: 'GET' }, { handle401: true });
    await vi.advanceTimersByTimeAsync(0);

    useAuthUIStore.getState().closeSsoLogin('dismiss');

    await expect(promise).rejects.toBeInstanceOf(AuthDismissedError);
    // Original + probe; no retry, no verify
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the original 401 and logs probe-failed when /api/auth/validate is unhealthy', async () => {
    const { appFetch } = await import('@/lib/gasket-config');
    const { logger } = await import('@/lib/request-context');

    const originalResponse = response401();
    const probeFailure = new Response('boom', { status: 503 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(originalResponse)  // request
      .mockResolvedValueOnce(probeFailure);     // probe (non-401, so resolveAuth returns 'failed')
    vi.stubGlobal('fetch', fetchMock);

    const response = await appFetch('/api/things', { method: 'GET' }, { handle401: true });

    // Falls through with the ORIGINAL 401 — caller's normal error path runs.
    expect(response).toBe(originalResponse);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(logger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.probe-failed',
      expect.objectContaining({ url: '/api/things', authReason: null, probeStatus: 503 }),
    );
  });

  it('logs authReason on probe-failed when modal verification fails', async () => {
    const { appFetch } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const originalResponse = response401({ authReason: 2 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(originalResponse)
      .mockResolvedValueOnce(response401({ authReason: 2 }))
      .mockResolvedValueOnce(response401({ authReason: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = appFetch('/api/things', { method: 'GET' }, { handle401: true });
    await vi.advanceTimersByTimeAsync(0);

    useAuthUIStore.getState().closeSsoLogin('success');

    const response = await promise;

    expect(response).toBe(originalResponse);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.probe-failed',
      expect.objectContaining({ url: '/api/things', authReason: 2, probeStatus: 401 }),
    );
  });

  it('passes the appFetch URL into proactive authLevel preflight logs', async () => {
    const { appFetch, AuthDismissedError } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401({ authReason: 2 })));

    const promise = appFetch('/api/secure-action', { method: 'POST' }, { authLevel: 3 });
    await vi.advanceTimersByTimeAsync(0);

    useAuthUIStore.getState().closeSsoLogin('dismiss');

    await expect(promise).rejects.toBeInstanceOf(AuthDismissedError);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.reauth-required',
      expect.objectContaining({ url: '/api/secure-action', level: 3, authReason: 2 }),
    );
  });

  it('strips the query string from the logged URL (no secret export to logs)', async () => {
    const { appFetch } = await import('@/lib/gasket-config');

    const originalResponse = response401();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(originalResponse)              // request
      .mockResolvedValueOnce(new Response('boom', { status: 503 })); // probe non-401 → 'failed'
    vi.stubGlobal('fetch', fetchMock);

    await appFetch('/api/things?token=supersecret&x=1', { method: 'GET' }, { handle401: true });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.probe-failed',
      expect.objectContaining({ url: '/api/things', probeStatus: 503 }),
    );
    const loggedWithQuery = mockLogger.warn.mock.calls.some(
      ([, fields]: [string, { url?: string }]) => fields?.url?.includes('supersecret'),
    );
    expect(loggedWithQuery).toBe(false);
  });

  it('logs only the path for absolute URLs with query strings and hashes', async () => {
    const { appFetch } = await import('@/lib/gasket-config');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await appFetch('https://example.com/api/things?token=supersecret#section', { method: 'GET' }, { handle401: true });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.probe-failed',
      expect.objectContaining({ url: '/api/things', probeStatus: 503 }),
    );
  });

  it('collapses non-string URLs to a log sentinel', async () => {
    const { appFetch } = await import('@/lib/gasket-config');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await appFetch(new URL('https://example.com/api/things?token=supersecret#section') as unknown as string, { method: 'GET' }, { handle401: true });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.probe-failed',
      expect.objectContaining({ url: '<non-string>', probeStatus: 503 }),
    );
  });

  it('skips handle401 when authLevel is also set (avoids double modal flow)', async () => {
    const { appFetch } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    // authLevel triggers proactive preflight first. Probe succeeds → request fires
    // and gets 401. handle401 must NOT kick in (we'd reopen the modal); instead the
    // 401 propagates to the caller.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response200())   // proactive probe at level 3
      .mockResolvedValueOnce(response401());  // request itself
    vi.stubGlobal('fetch', fetchMock);

    const response = await appFetch(
      '/api/things',
      { method: 'GET' },
      { authLevel: 3, handle401: true },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Modal must not have been opened by the reactive path
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
  });

  it('probes at level 3 when handle401 specifies it (HBI route preserved)', async () => {
    const { appFetch } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn().mockImplementation(function (url: string) {
      // Original request 401s. Probe is at level 3 and returns HBI authReason.
      if (typeof url === 'string' && url.includes('/api/auth/validate')) {
        if (url.includes('level=3')) return Promise.resolve(response401({ authReason: 2 }));
        throw new Error(`unexpected validate URL: ${url}`);
      }
      return Promise.resolve(response401());
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = appFetch('/api/things', { method: 'POST' }, { handle401: { level: 3 } });
    await vi.advanceTimersByTimeAsync(0);

    // ssoAuthReason picked up from the level-3 probe response — drives /hbi routing
    expect(useAuthUIStore.getState().ssoAuthReason).toBe(2);

    useAuthUIStore.getState().closeSsoLogin('dismiss');
    // dismiss propagates as AuthDismissedError; we don't await the response here
    await expect(promise).rejects.toMatchObject({ name: 'AuthDismissedError' });
  });

  it('shares a single modal across concurrent callers', async () => {
    const { appFetch } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const fetchMock = vi.fn().mockImplementation(function (url: string) {
      if (typeof url === 'string' && url.includes('/api/auth/validate')) {
        // Probe and verify both succeed. Probe will only be called once thanks
        // to single-flight; verify runs once after SSO success.
        return Promise.resolve(response401()); // first call (probe)
      }
      return Promise.resolve(response401());   // requests 401
    });
    // Replace probe/verify path explicitly to avoid sequencing surprises
    let callCount = 0;
    fetchMock.mockImplementation(function (url: string) {
      const isValidate = typeof url === 'string' && url.includes('/api/auth/validate');
      callCount += 1;
      if (!isValidate && callCount <= 3) return Promise.resolve(response401());           // 3 original requests 401
      if (isValidate && callCount === 4) return Promise.resolve(response401());           // single shared probe
      if (isValidate && callCount === 5) return Promise.resolve(response200());           // verify after SSO
      return Promise.resolve(response200({ retried: true }));                              // retried originals
    });
    vi.stubGlobal('fetch', fetchMock);

    const openSpy = vi.spyOn(useAuthUIStore.getState(), 'openSsoLogin');

    const p1 = appFetch('/api/a', { method: 'GET' }, { handle401: true });
    const p2 = appFetch('/api/b', { method: 'GET' }, { handle401: true });
    const p3 = appFetch('/api/c', { method: 'GET' }, { handle401: true });

    await vi.advanceTimersByTimeAsync(0);

    expect(openSpy).toHaveBeenCalledTimes(1);

    useAuthUIStore.getState().closeSsoLogin('success');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });
});
