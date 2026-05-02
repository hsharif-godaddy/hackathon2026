import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetVisitor = vi.fn();

vi.mock('../../gasket.edge', () => ({
  default: {
    actions: {
      getVisitor: (...args: unknown[]) => mockGetVisitor(...args),
    },
  },
}));

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    NextResponse: {
      ...actual.NextResponse,
      rewrite: vi.fn((url: URL) => ({
        type: 'rewrite',
        url: url.pathname,
        headers: new Headers(),
      })),
    },
  };
});

import { config, middleware } from '../middleware';

interface MakeRequestOptions {
  host?: string;
  dsaHost?: string;
}

function makeRequest(pathname: string, hostOrOptions: string | MakeRequestOptions = 'airo-builder.test-godaddy.com'): Request {
  const opts = typeof hostOrOptions === 'string' ? { host: hostOrOptions } : hostOrOptions;
  const host = opts.host ?? 'airo-builder.test-godaddy.com';
  const headers: Record<string, string> = { host };
  if (opts.dsaHost !== undefined) {
    headers['x-dsa-host'] = opts.dsaHost;
  }
  return new Request(new URL(pathname, `https://${host}`), { headers });
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('config.matcher', () => {
    const negativePattern = config.matcher.find(m => m.includes('(?!'))!;
    const matcherRe = new RegExp(`^${negativePattern}$`);

    it('should include a root path matcher', () => {
      expect(config.matcher).toContain('/');
    });

    it('should match regular page paths', () => {
      expect(matcherRe.test('/develop')).toBe(true);
      expect(matcherRe.test('/explore/some-template')).toBe(true);
      expect(matcherRe.test('/settings')).toBe(true);
    });

    it('should not match /api routes', () => {
      expect(matcherRe.test('/api/health')).toBe(false);
      expect(matcherRe.test('/api/sites')).toBe(false);
    });

    it('should not match /_next routes', () => {
      expect(matcherRe.test('/_next/static/chunk.js')).toBe(false);
    });

    it('should not match static assets', () => {
      expect(matcherRe.test('/favicon.ico')).toBe(false);
      expect(matcherRe.test('/sitemap.xml')).toBe(false);
      expect(matcherRe.test('/robots.txt')).toBe(false);
      expect(matcherRe.test('/images/logo.png')).toBe(false);
      expect(matcherRe.test('/notification-beep.wav')).toBe(false);
    });

    it('should not match /.well-known paths', () => {
      expect(matcherRe.test('/.well-known/jwks.json')).toBe(false);
      expect(matcherRe.test('/.well-known/openid-configuration')).toBe(false);
    });
  });

  describe('rewriting', () => {
    it('should prepend market to the pathname', async () => {
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });
      const result = await middleware(makeRequest('/develop'));
      expect(result.url).toBe('/en-US/develop');
    });

    it('should handle root path with market', async () => {
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });
      const result = await middleware(makeRequest('/'));
      expect(result.url).toBe('/en-US');
    });

    it('should handle non-US markets', async () => {
      mockGetVisitor.mockResolvedValue({ market: 'de-DE' });
      const result = await middleware(makeRequest('/explore'));
      expect(result.url).toBe('/de-DE/explore');
    });

    it('should preserve nested path segments', async () => {
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });
      const result = await middleware(makeRequest('/develop/abc-123'));
      expect(result.url).toBe('/en-US/develop/abc-123');
    });

    it('should pass the request to getVisitor', async () => {
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });
      const req = makeRequest('/develop');
      await middleware(req);
      expect(mockGetVisitor).toHaveBeenCalledWith(req);
    });
  });

  describe('error handling', () => {
    it('should propagate when getVisitor throws', async () => {
      mockGetVisitor.mockRejectedValue(new Error('visitor lookup failed'));
      await expect(middleware(makeRequest('/develop'))).rejects.toThrow('visitor lookup failed');
    });

    it('should handle undefined market gracefully', async () => {
      mockGetVisitor.mockResolvedValue({ market: undefined });
      const result = await middleware(makeRequest('/develop'));
      expect(result.url).toBe('/develop');
    });

    it('should handle empty string market gracefully', async () => {
      mockGetVisitor.mockResolvedValue({ market: '' });
      const result = await middleware(makeRequest('/develop'));
      expect(result.url).toBe('/develop');
    });
  });

  describe('subdomain noindex', () => {
    beforeEach(() => {
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });
    });

    it('should set X-Robots-Tag noindex when host header matches the prod subdomain', async () => {
      const result = await middleware(makeRequest('/develop', 'airo-builder.godaddy.com'));
      expect(result.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('should set X-Robots-Tag noindex on the test-godaddy.com host (pre-test verification)', async () => {
      const result = await middleware(makeRequest('/develop', 'airo-builder.test-godaddy.com'));
      expect(result.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('should set X-Robots-Tag noindex on the dev-godaddy.com host', async () => {
      const result = await middleware(makeRequest('/develop', 'airo-builder.dev-godaddy.com'));
      expect(result.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('should set X-Robots-Tag noindex on the pre-test host', async () => {
      const result = await middleware(makeRequest('/develop', 'pre-test-airo-builder.test-godaddy.com'));
      expect(result.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('should set X-Robots-Tag noindex when only x-dsa-host matches (real Akamai chain)', async () => {
      const result = await middleware(makeRequest('/develop', {
        host: 'airo-builder-internal.katana.int',
        dsaHost: 'airo-builder.godaddy.com',
      }));
      expect(result.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('should prefer x-dsa-host over host when both are present', async () => {
      const result = await middleware(makeRequest('/develop', {
        host: 'airo-builder.godaddy.com',
        dsaHost: 'godaddy.com',
      }));
      expect(result.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('should not set X-Robots-Tag on the godaddy.com apex host (FOS SLP)', async () => {
      const result = await middleware(makeRequest('/explore/games', 'godaddy.com'));
      expect(result.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('should not set X-Robots-Tag on a different godaddy.com subdomain', async () => {
      const result = await middleware(makeRequest('/develop', 'something-else.godaddy.com'));
      expect(result.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('should not set X-Robots-Tag on the test-godaddy.com apex host', async () => {
      const result = await middleware(makeRequest('/develop', 'test-godaddy.com'));
      expect(result.headers.get('X-Robots-Tag')).toBeNull();
    });
  });
});
