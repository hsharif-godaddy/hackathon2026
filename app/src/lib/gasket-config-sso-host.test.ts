/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getLoginUrl, getLogoutUrl } = await import('@/lib/gasket-config');
const { logger } = await import('@/lib/request-context');

interface MockGasketConfig {
  sso: { loginUrl: string; logoutUrl: string; appName: string };
  redirects: { loginRedirectUrl: string; logoutRedirectUrl: string };
}

function defaultMockConfig(): MockGasketConfig {
  return {
    sso: {
      loginUrl: 'https://sso.test-godaddy.com/login',
      logoutUrl: 'https://sso.test-godaddy.com/logout',
      appName: 'airo-builder',
    },
    redirects: {
      loginRedirectUrl: 'https://airo-builder.test-godaddy.com/',
      logoutRedirectUrl: 'https://airo-builder.test-godaddy.com/',
    },
  };
}

function setLocation(hostname: string, port: string = ''): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      hostname,
      port,
      origin: `https://${hostname}${port ? `:${port}` : ''}`,
    },
  });
}

function installConfigFetch(config: MockGasketConfig): void {
  globalThis.fetch = vi.fn(function fetchMock() {
    return Promise.resolve({ ok: true, json: function jsonMock() { return Promise.resolve(config); } });
  }) as unknown as typeof fetch;
}

describe('gasket-config (browser host derivation)', function describeBrowser() {
  const originalLocation: Location = window.location;
  const originalFetch: typeof fetch = globalThis.fetch;

  beforeEach(function resetCache() {
    // gasket-config caches the resolved config on globalThis; reset so each
    // test can substitute its own mock without leakage.
    delete (globalThis as { __gasketConfigCache?: unknown }).__gasketConfigCache;
    delete (globalThis as { __gasketConfigPromise?: unknown }).__gasketConfigPromise;
    installConfigFetch(defaultMockConfig());
  });

  afterEach(function restore() {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    globalThis.fetch = originalFetch;
    vi.mocked(logger.warn).mockClear();
  });

  describe('#getLogoutUrl', function describeLogout() {
    it('returns env-configured app + redirect when origin matches current host', async function matched() {
      setLocation('airo-builder.test-godaddy.com');
      const result: string = await getLogoutUrl();
      expect(result).toBe(
        'https://sso.test-godaddy.com/logout?app=airo-builder&redirect=https%3A%2F%2Fairo-builder.test-godaddy.com%2F'
      );
      expect(result).not.toContain('port=');
    });

    it('overrides with host-derived app + redirect + port on local dev', async function localOverride() {
      setLocation('local.gasket.dev-godaddy.com', '8443');
      const result: string = await getLogoutUrl();
      expect(result).toBe(
        'https://sso.test-godaddy.com/logout?app=local.gasket&redirect=https%3A%2F%2Flocal.gasket.dev-godaddy.com%3A8443%2F&port=8443'
      );
    });

    it('overrides on pre-test-airo-builder with the multi-label app', async function preTestOverride() {
      setLocation('pre-test-airo-builder.test-godaddy.com');
      const result: string = await getLogoutUrl();
      expect(result).toContain('app=pre-test-airo-builder');
      expect(result).toContain('redirect=https%3A%2F%2Fpre-test-airo-builder.test-godaddy.com%2F');
      expect(result).not.toContain('port=');
    });

    it('suppresses port 3000 (Next dev) even when overriding', async function port3000() {
      setLocation('local.gasket.dev-godaddy.com', '3000');
      const result: string = await getLogoutUrl();
      expect(result).not.toContain('port=');
    });

    it('falls back to env appName when the host is unrecognized', async function unknownHost() {
      setLocation('evil.example.com');
      const result: string = await getLogoutUrl();
      expect(result).toContain('app=airo-builder');
    });

    it('warns and falls back to host derivation when logoutRedirectUrl is malformed', async function malformedUrl() {
      const malformed: MockGasketConfig = defaultMockConfig();
      malformed.redirects.logoutRedirectUrl = '::not a url::';
      installConfigFetch(malformed);
      setLocation('local.gasket.dev-godaddy.com', '8443');
      const result: string = await getLogoutUrl();
      expect(logger.warn).toHaveBeenCalledWith(
        'sso.logout.redirect-url.parse-failed',
        expect.objectContaining({ url: '::not a url::' })
      );
      expect(result).toContain('app=local.gasket');
      expect(result).toContain('port=8443');
    });
  });

  describe('#getLoginUrl', function describeLogin() {
    it('uses the env app on the canonical builder host', async function canonical() {
      setLocation('airo-builder.test-godaddy.com');
      const result: string = await getLoginUrl('/develop/app');
      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder&path=%2Fdevelop%2Fapp');
    });

    it('derives the host-aware app + port on local dev', async function local() {
      setLocation('local.gasket.dev-godaddy.com', '8443');
      const result: string = await getLoginUrl('/apps');
      expect(result).toBe('https://sso.test-godaddy.com/login?app=local.gasket&port=8443&path=%2Fapps');
    });

    it('derives the multi-label app on pre-test (the PR-named host)', async function preTest() {
      setLocation('pre-test-airo-builder.test-godaddy.com');
      const result: string = await getLoginUrl('/develop/abc');
      expect(result).toBe('https://sso.test-godaddy.com/login?app=pre-test-airo-builder&path=%2Fdevelop%2Fabc');
    });

    it('forwards auth_reason for HBI step-up alongside the derived params', async function authReason() {
      setLocation('local.gasket.dev-godaddy.com', '8443');
      const result: string = await getLoginUrl('/develop/abc', 2);
      expect(result).toBe(
        'https://sso.test-godaddy.com/login?app=local.gasket&port=8443&path=%2Fdevelop%2Fabc&auth_reason=2'
      );
    });
  });
});
