import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockConfig = {
  sso: { loginUrl: 'https://sso.test-godaddy.com/login', appName: 'airo-builder' },
  redirects: { loginRedirectUrl: 'https://airo-builder.test-godaddy.com/' },
};

vi.mock('@/lib/gasket-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gasket-config')>();
  return {
    ...actual,
    getGasketConfig: vi.fn(function () { return Promise.resolve(mockConfig); }),
  };
});

const { getLoginUrl } = await import('@/lib/gasket-config');

describe('gasket-config', function gasketConfigTests() {
  describe('#getLoginUrl', function getLoginUrlTests() {
    it('should extract path from absolute URL', async function absoluteUrl() {
      const result = await getLoginUrl('https://airo-builder.godaddy.com/develop/app?sid=x');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder&path=%2Fdevelop%2Fapp%3Fsid%3Dx');
    });

    it('should extract path from relative URL', async function relativeUrl() {
      const result = await getLoginUrl('/develop/abc123');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder&path=%2Fdevelop%2Fabc123');
    });

    it('should omit path param for root URL', async function rootUrl() {
      const result = await getLoginUrl('https://airo-builder.godaddy.com/');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder');
    });

    it('should omit path param for bare slash', async function bareSlash() {
      const result = await getLoginUrl('/');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder');
    });

    it('should fall back to config loginRedirectUrl when no returnUrl provided', async function configFallback() {
      const result = await getLoginUrl();

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder');
    });

    it('should resolve relative path without leading slash against base', async function noLeadingSlash() {
      const result = await getLoginUrl('develop/app');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder&path=%2Fdevelop%2Fapp');
    });

    it('should reject javascript: URLs', async function javascriptUrl() {
      // eslint-disable-next-line no-script-url -- intentionally testing that script URLs are rejected
      const result = await getLoginUrl('javascript:alert(1)');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder');
    });

    it('should reject mailto: URLs', async function mailtoUrl() {
      const result = await getLoginUrl('mailto:test@example.com');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder');
    });

    it('should preserve hash fragment in path', async function hashFragment() {
      const result = await getLoginUrl('/develop/abc123#section');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder&path=%2Fdevelop%2Fabc123%23section');
    });

    it('should preserve query params and hash together', async function queryAndHash() {
      const result = await getLoginUrl('https://airo-builder.godaddy.com/develop/app?sid=x&tab=code#preview');

      expect(result).toBe('https://sso.test-godaddy.com/login?app=airo-builder&path=%2Fdevelop%2Fapp%3Fsid%3Dx%26tab%3Dcode%23preview');
    });
  });

});
