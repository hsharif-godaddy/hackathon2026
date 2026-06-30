/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mutable ref lets per-test cases flip between the modal env ('godaddy.com')
// and the PNA-blocked redirect env ('test-godaddy.com'). Defaults to modal
// so the majority of tests exercise the SSO outcome flow.
const domainRef = vi.hoisted(() => ({ value: 'godaddy.com' }));
vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => domainRef.value,
}));

const AUTH_PREFLIGHT_TIMEOUT_MS = 5 * 60 * 1000;

function response401(body: unknown = { authReason: 2 }) {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status: 401, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' } }
  );
}

describe('authPreflight', () => {
  beforeEach(() => {
    // Reset module-level pendingSsoPromise between tests so cases do not
    // share an in-flight SSO wait across runs.
    vi.resetModules();
    vi.useFakeTimers();
    domainRef.value = 'godaddy.com';
    // getGasketConfig caches on globalThis; clear so per-test fetch mocks apply.
    (globalThis as unknown as { __gasketConfigCache?: unknown; __gasketConfigPromise?: unknown }).__gasketConfigCache = undefined;
    (globalThis as unknown as { __gasketConfigCache?: unknown; __gasketConfigPromise?: unknown }).__gasketConfigPromise = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('closes the SSO modal and returns the 401 response when wait times out', async () => {
    const { authPreflight } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const resp = response401();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const preflightPromise = authPreflight(3);

    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTH_PREFLIGHT_TIMEOUT_MS + 1);

    const result = await preflightPromise;

    expect(result).toBe(resp);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
    expect(useAuthUIStore.getState().ssoCloseReason).toBe('dismiss');
  });

  it('throws AuthDismissedError when the user dismisses SSO', async () => {
    const { authPreflight, AuthDismissedError } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401()));

    const preflightPromise = authPreflight(3);

    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

    useAuthUIStore.getState().closeSsoLogin('dismiss');

    await expect(preflightPromise).rejects.toBeInstanceOf(AuthDismissedError);
  });

  it('returns null after successful re-auth (retry fetch succeeds)', async () => {
    const { authPreflight } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');
    window.history.pushState({}, '', '/develop/abc123?tab=settings#preview');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const preflightPromise = authPreflight(3);

    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
    expect(useAuthUIStore.getState().redirectUrl).toBe(window.location.href);

    useAuthUIStore.getState().closeSsoLogin('success');

    await expect(preflightPromise).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves an explicit redirectUrl when opening re-auth', async () => {
    const { authPreflight } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401()));
    useAuthUIStore.getState().setRedirectUrl('/create?initialPrompt=hello&template=logo-designer');

    const preflightPromise = authPreflight(3);

    await vi.advanceTimersByTimeAsync(0);

    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
    expect(useAuthUIStore.getState().redirectUrl).toBe('/create?initialPrompt=hello&template=logo-designer');

    useAuthUIStore.getState().closeSsoLogin('dismiss');

    await expect(preflightPromise).rejects.toThrow();
  });

  it('returns the retry response when re-auth completes but retry still fails', async () => {
    const { authPreflight } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const retryResp = response401();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response401())
      .mockResolvedValueOnce(retryResp);
    vi.stubGlobal('fetch', fetchMock);

    const preflightPromise = authPreflight(3);

    await vi.advanceTimersByTimeAsync(0);
    useAuthUIStore.getState().closeSsoLogin('success');

    const result = await preflightPromise;
    expect(result).toBe(retryResp);
  });

  it('returns non-401 responses unchanged without opening SSO', async () => {
    const { authPreflight } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const resp = new Response('server error', { status: 500 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const result = await authPreflight(3);

    expect(result).toBe(resp);
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
  });

  it('opens SSO with null authReason and warns when 401 body is not JSON', async () => {
    const { authPreflight } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');
    const { logger } = await import('@/lib/request-context');

    // WAF HTML 401 page - JSON parse will fail
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401('<html>401</html>')));

    const preflightPromise = authPreflight(3);

    await vi.advanceTimersByTimeAsync(0);

    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
    expect(useAuthUIStore.getState().ssoAuthReason).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.body-parse-failed',
      expect.objectContaining({ url: '<preflight>', level: 3, status: 401 }),
    );

    // Cleanly terminate the hanging preflight so the test doesn't leak.
    useAuthUIStore.getState().closeSsoLogin('dismiss');
    await expect(preflightPromise).rejects.toThrow();
  });

  it('deduplicates concurrent 401 preflights to a single SSO open', async () => {
    const { authPreflight } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const openSpy = vi.spyOn(useAuthUIStore.getState(), 'openSsoLogin');
    const setRedirectUrlSpy = vi.spyOn(useAuthUIStore.getState(), 'setRedirectUrl');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response401()));

    const p1 = authPreflight(3);
    const p2 = authPreflight(3);

    await vi.advanceTimersByTimeAsync(0);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(setRedirectUrlSpy).toHaveBeenCalledTimes(1);

    useAuthUIStore.getState().closeSsoLogin('dismiss');

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();
  });

  it('redirects to login URL in PNA-blocked env instead of opening modal', async () => {
    domainRef.value = 'test-godaddy.com';

    const { authPreflight } = await import('@/lib/gasket-config');
    const { useAuthUIStore } = await import('@/stores/useAuthUIStore');

    const configBody = {
      auth: { realm: 'idp', risk: 'low', type: [], authType: 'jwt', isMock: false, isJWT: true },
      sso: {
        loginUrl: 'https://sso.test-godaddy.com/login',
        logoutUrl: 'https://sso.test-godaddy.com/logout',
        appName: 'airo-builder',
      },
      redirects: { loginRedirectUrl: 'https://airo-builder.test-godaddy.com/', logoutRedirectUrl: '/' },
      supportUrl: '',
    };

    vi.stubGlobal('fetch', vi.fn(function (url: string) {
      if (url.includes('/api/auth/validate')) return Promise.resolve(response401());
      if (url.includes('/api/config')) {
        return Promise.resolve(new Response(JSON.stringify(configBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));

    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'https://airo-builder.test-godaddy.com/apps',
        get hostname() { return 'airo-builder.test-godaddy.com'; },
      },
    });
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      get: () => 'https://airo-builder.test-godaddy.com/apps',
      set: hrefSetter,
    });

    // The function returns a never-resolving promise on the redirect path.
    // Use Promise.race with a tick so the test can assert without hanging.
    void authPreflight(3);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(hrefSetter).toHaveBeenCalledWith(
      expect.stringContaining('https://sso.test-godaddy.com/login'),
    );
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
  });

  it('returns the 401 response if redirect URL lookup fails in PNA env', async () => {
    domainRef.value = 'test-godaddy.com';

    const { authPreflight } = await import('@/lib/gasket-config');
    const { logger } = await import('@/lib/request-context');

    const resp401 = response401();
    vi.stubGlobal('fetch', vi.fn(function (url: string) {
      if (url.includes('/api/auth/validate')) return Promise.resolve(resp401);
      if (url.includes('/api/config')) {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));

    const result = await authPreflight(3);

    expect(result).toBe(resp401);
    expect(logger.warn).toHaveBeenCalledWith(
      'app-fetch.auth-resolve.redirect-url-failed',
      expect.objectContaining({ url: '<preflight>', level: 3, authReason: 2 }),
    );
  });
});
