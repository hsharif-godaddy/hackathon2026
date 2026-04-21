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
      rewrite: vi.fn((url: URL) => ({ type: 'rewrite', url: url.pathname })),
    },
  };
});

import { config, middleware } from '../middleware';

function makeRequest(pathname: string): Request {
  return new Request(new URL(pathname, 'https://airo-builder.test-godaddy.com'));
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
});
