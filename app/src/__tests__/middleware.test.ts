import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSharePayload } from '@airo/shared';

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
      rewrite: vi.fn(function (url: URL) { return {
        type: 'rewrite',
        url: url.pathname,
        headers: new Headers(),
      }; }),
      redirect: vi.fn(function (url: string | URL, status?: number) { return {
        type: 'redirect',
        url: typeof url === 'string' ? url : url.toString(),
        status,
      }; }),
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

    it('should not match /scripts paths so receive-bridge.js is publicly served without auth middleware', () => {
      expect(matcherRe.test('/scripts/receive-bridge.js')).toBe(false);
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

  describe('share fast-path /share/{encoded}', () => {
    it('returns 307 redirect to the preview URL for a valid encoded payload', async () => {
      const encoded = encodeSharePayload({
        siteId: 'k8bnu24pcq',
        cellPrefix: 'c4',
        token: 'yPBorcyKvnYJ',
      });
      const result = await middleware(makeRequest(`/share/${encoded}`)) as any;

      expect(result.type).toBe('redirect');
      expect(result.status).toBe(307);
      // Default makeRequest host is airo-builder.test-godaddy.com, which
      // airoAppDomainForHost maps to test-airoapp.ai for the preview domain.
      expect(result.url).toBe(
        'https://k8bnu24pcq.preview.c4.test-airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
      );
      // Skips Gasket visitor lookup entirely
      expect(mockGetVisitor).not.toHaveBeenCalled();
    });

    it('falls through to the Gasket rewrite when payload is malformed', async () => {
      // Regression guard: any refactor that adds a NextResponse.next() short-
      // circuit on the share path would break the page.tsx notFound() fallback
      // for invalid payloads. Asserting the rewrite happens documents the
      // contract.
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });
      const result = await middleware(makeRequest('/share/not-valid-base64!')) as any;

      expect(result.type).toBe('rewrite');
      expect(result.url).toBe('/en-US/share/not-valid-base64!');
      expect(mockGetVisitor).toHaveBeenCalled();
    });

    it('falls through when payload decodes but fails field validation (dot in siteId)', async () => {
      // Hand-crafted base64url of "evil.com:c4:yPBorcyKvnYJ" — passes base64
      // decode but fails the siteId regex. Must NOT redirect to a constructed
      // hostname; must fall through to the rewrite path.
      const malicious = btoa('evil.com:c4:yPBorcyKvnYJ').replace(/\+/g, '-')
        .replace(/\//g, '_').replace(/=+$/, '');
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });

      const result = await middleware(makeRequest(`/share/${malicious}`)) as any;

      expect(result.type).toBe('rewrite');
      expect(result.url).toContain('/en-US/share/');
      // Critically: must NOT have constructed a redirect to evil.com
      expect(result.url).not.toContain('evil.com');
    });

    it('does not match paths that start with /share but lack the trailing slash', async () => {
      // Boundary check: /share-something should be a normal page, not the
      // share fast-path. Confirms the SHARE_PREFIX = '/share/' check.
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });
      const result = await middleware(makeRequest('/sharestuff')) as any;

      expect(result.type).toBe('rewrite');
      expect(result.url).toBe('/en-US/sharestuff');
    });

    it('uses x-dsa-host for the preview domain behind Akamai', async () => {
      // Regression guard for a real production bug: Akamai rewrites the
      // Host header to an internal Katana origin (e.g.
      // airo-builder-internal.katana.int) before the request reaches us,
      // and the original public host (airo.ai / airo-builder.godaddy.com)
      // survives in x-dsa-host. Reading requestUrl.host instead of
      // getPublicHost(request) would miss the known-host map entirely
      // and fall back to test-airoapp.ai — every prod share link would
      // 307 to the wrong domain. Mirrors the noindex test for the same
      // header-precedence rule.
      const encoded = encodeSharePayload({
        siteId: 'k8bnu24pcq',
        cellPrefix: 'c4',
        token: 'yPBorcyKvnYJ',
      });
      const result = await middleware(makeRequest(`/share/${encoded}`, {
        host: 'airo-builder-internal.katana.int',
        dsaHost: 'airo-builder.godaddy.com',
      })) as any;

      expect(result.type).toBe('redirect');
      expect(result.status).toBe(307);
      // airo-builder.godaddy.com is a prod host → airoapp.ai preview domain.
      expect(result.url).toBe(
        'https://k8bnu24pcq.preview.c4.airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
      );
      // Critically: must NOT have fallen through to the test-airoapp.ai
      // default that the bug produced.
      expect(result.url).not.toContain('test-airoapp.ai');
    });

    it('routes to airoapp.ai (prod) when the public host is airo.ai', async () => {
      // Direct prod path (no Akamai rewrite). Belt-and-suspenders coverage:
      // the previous test asserts the x-dsa-host precedence; this one
      // asserts the prod→airoapp.ai mapping itself, so a future change
      // to airoAppDomainForHost can't silently break prod without a
      // failing test.
      const encoded = encodeSharePayload({
        siteId: 'k8bnu24pcq',
        cellPrefix: 'c4',
        token: 'yPBorcyKvnYJ',
      });
      const result = await middleware(
        makeRequest(`/share/${encoded}`, 'airo.ai'),
      ) as any;

      expect(result.type).toBe('redirect');
      expect(result.url).toBe(
        'https://k8bnu24pcq.preview.c4.airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
      );
    });

    describe('?p= path forwarding', () => {
      // When share-create callers (e.g. PaaS screenshot capture for non-root
      // apps) pass ?p=/blog, the redirect target's path becomes /blog instead
      // of /. The validator gates the value before it ever reaches a URL
      // constructor — these tests cover both happy path and every refusal.
      const encoded = encodeSharePayload({
        siteId: 'k8bnu24pcq',
        cellPrefix: 'c4',
        token: 'yPBorcyKvnYJ',
      });

      it('forwards a valid ?p= path into the redirect target', async () => {
        const result = await middleware(makeRequest(`/share/${encoded}?p=%2Fblog`)) as any;

        expect(result.type).toBe('redirect');
        expect(result.status).toBe(307);
        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/blog?airoShareToken=yPBorcyKvnYJ',
        );
      });

      it('forwards a nested ?p= path with dots', async () => {
        const result = await middleware(makeRequest(`/share/${encoded}?p=%2Fblog%2Fpost.html`)) as any;

        expect(result.type).toBe('redirect');
        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/blog/post.html?airoShareToken=yPBorcyKvnYJ',
        );
      });

      it('falls back to / when ?p= is missing (no behavior change for existing share URLs)', async () => {
        const result = await middleware(makeRequest(`/share/${encoded}`)) as any;

        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
        );
      });

      it('rejects ?p=//evil.com (open-redirect via protocol-relative URL)', async () => {
        // The exact attack the validator exists to stop: //evil.com would
        // normally resolve to https://evil.com when used as a path. Must
        // fall back to / and stay on the previewed app's host.
        const result = await middleware(makeRequest(`/share/${encoded}?p=%2F%2Fevil.com%2F`)) as any;

        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
        );
        expect(result.url).not.toContain('evil.com');
      });

      it('rejects ?p=https://evil.com (open-redirect via absolute URL)', async () => {
        const result = await middleware(makeRequest(`/share/${encoded}?p=https%3A%2F%2Fevil.com`)) as any;

        expect(result.url).not.toContain('evil.com');
        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
        );
      });

      it('rejects ?p= without a leading slash', async () => {
        const result = await middleware(makeRequest(`/share/${encoded}?p=blog`)) as any;

        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
        );
      });

      it('rejects ?p= containing a backslash', async () => {
        const result = await middleware(makeRequest(`/share/${encoded}?p=%2F%5Cevil.com`)) as any;

        expect(result.url).not.toContain('evil.com');
        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
        );
      });

      it('rejects ?p= with disallowed characters (space)', async () => {
        const result = await middleware(makeRequest(`/share/${encoded}?p=%2Fpath%20with%20space`)) as any;

        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
        );
      });

      it('rejects ?p= longer than 128 chars', async () => {
        const longPath = '/' + 'a'.repeat(200);
        const result = await middleware(
          makeRequest(`/share/${encoded}?p=${encodeURIComponent(longPath)}`),
        ) as any;

        expect(result.url).toBe(
          'https://k8bnu24pcq.preview.c4.test-airoapp.ai/?airoShareToken=yPBorcyKvnYJ',
        );
      });
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

  describe('Content-Security-Policy frame-ancestors on /develop/*', () => {
    // Regression guard for the iframe-recursion mitigation. The CSP
    // header must fire on the bare `/develop/<id>` form (the URL the
    // user actually navigates to) — an earlier regex `^\/[^/]+\/develop`
    // only matched the market-prefixed form and silently no-op'd for
    // normal user-facing URLs, defeating the layer.
    //
    // Expected value: dashboard allowlist (matching gasket.ts:372)
    // MINUS `'self'`. Both CSPs must agree, so `'self'` framing (the
    // recursion path) is blocked while the dashboard origins still
    // work via the Gasket Helmet CSP.
    const EXPECTED_CSP = [
      'frame-ancestors',
      'https://dashboard.godaddy.com',
      'https://dashboard.godaddy.com:*',
      'https://dashboard.dev-godaddy.com',
      'https://dashboard.dev-godaddy.com:*',
      'https://dashboard.test-godaddy.com',
      'https://dashboard.test-godaddy.com:*',
    ].join(' ');

    beforeEach(() => {
      mockGetVisitor.mockResolvedValue({ market: 'en-US' });
    });

    it('sets the dashboard frame-ancestors allowlist on bare /develop', async () => {
      const result = await middleware(makeRequest('/develop'));
      expect(result.headers.get('Content-Security-Policy')).toBe(EXPECTED_CSP);
    });

    it('sets the dashboard frame-ancestors allowlist on /develop/<appId>', async () => {
      const result = await middleware(makeRequest('/develop/abc-123'));
      expect(result.headers.get('Content-Security-Policy')).toBe(EXPECTED_CSP);
    });

    it('sets the header on the market-prefixed form too', async () => {
      // If a request ever arrives already-prefixed (e.g. direct deep
      // link bypassing the rewrite), still apply the header.
      const result = await middleware(makeRequest('/en-US/develop/abc-123'));
      expect(result.headers.get('Content-Security-Policy')).toBe(EXPECTED_CSP);
    });

    it("does NOT include 'self' (the recursion-blocking invariant)", async () => {
      // Critical: this is the whole reason we set our own CSP rather
      // than relying solely on Gasket Helmet. Helmet's CSP allows
      // `'self'`, which is the recursion path. If this header ever
      // starts including `'self'`, the layer becomes inert.
      const result = await middleware(makeRequest('/develop/abc-123'));
      const csp = result.headers.get('Content-Security-Policy');
      expect(csp).toBeTruthy();
      expect(csp).not.toContain("'self'");
    });

    it('does not set frame-ancestors on non-develop routes', async () => {
      const result = await middleware(makeRequest('/explore'));
      expect(result.headers.get('Content-Security-Policy')).toBeNull();
    });

    it('does not match unrelated paths that contain "develop" mid-segment', async () => {
      // Defense against a too-loose regex matching e.g. `/developer-tools`.
      const result = await middleware(makeRequest('/developer-tools'));
      expect(result.headers.get('Content-Security-Policy')).toBeNull();
    });
  });
});
