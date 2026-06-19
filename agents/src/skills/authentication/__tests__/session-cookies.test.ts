import { describe, expect, it, vi } from 'vitest';

import {
  buildClearCookieHeaders,
  tryClearStaleSession,
} from '../templates/lib/auth/session-cookies';

/**
 * The helper lives under `templates/` so it ships into the generated app, but
 * its imports are dependency-free (no `@/` / `#airo/` aliases), so it resolves
 * directly here. The test itself stays OUTSIDE `templates/` — the skill loader
 * copies every file under `templates/` verbatim into the customer app, and we
 * don't want test files shipped.
 */
describe('buildClearCookieHeaders', () => {
  const EXPIRED = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT';

  it('expires the BetterAuth session token present on the request', () => {
    const headers = buildClearCookieHeaders('better-auth.session_token=abc.def', {
      preview: false,
    });

    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('better-auth.session_token=;');
    expect(headers[0]).toContain('Path=/');
    expect(headers[0]).toContain('Max-Age=0');
    expect(headers[0]).toContain(EXPIRED);
  });

  it('uses cross-site partitioned attributes in preview mode', () => {
    const [header] = buildClearCookieHeaders('better-auth.session_token=abc', {
      preview: true,
    });

    expect(header).toContain('SameSite=None');
    expect(header).toContain('Secure');
    expect(header).toContain('Partitioned');
  });

  it('uses SameSite=Lax (no Partitioned) in publish mode', () => {
    const [header] = buildClearCookieHeaders('better-auth.session_token=abc', {
      preview: false,
    });

    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('Partitioned');
  });

  it('always sets Secure so __Secure-/__Host- prefixed cookies clear in publish mode', () => {
    // Published apps are first-party HTTPS, where BetterAuth issues secure
    // cookies named `__Secure-better-auth.session_token`. A Set-Cookie for a
    // `__Secure-`-prefixed name without `Secure` is rejected by the browser,
    // so the clear would silently no-op. Publish runs over HTTPS, so Secure is
    // always safe to set.
    const [header] = buildClearCookieHeaders('__Secure-better-auth.session_token=abc', {
      preview: false,
    });

    expect(header).toContain('Secure');
  });

  it('clears every BetterAuth cookie present, not only the session token', () => {
    const headers = buildClearCookieHeaders(
      'better-auth.session_token=abc; better-auth.dont_remember=1; theme=dark',
      { preview: false },
    );

    const names = headers.map((h) => h.split('=')[0]);
    expect(names).toContain('better-auth.session_token');
    expect(names).toContain('better-auth.dont_remember');
    expect(names).not.toContain('theme');
  });

  it('preserves the exact cookie name including __Secure- / __Host- prefixes', () => {
    const [header] = buildClearCookieHeaders('__Secure-better-auth.session_token=abc', {
      preview: true,
    });

    expect(header.startsWith('__Secure-better-auth.session_token=;')).toBe(true);
  });

  it('ignores non-BetterAuth cookies', () => {
    expect(buildClearCookieHeaders('theme=dark; sid=xyz', { preview: false })).toEqual([]);
  });

  it('returns nothing when there is no cookie header', () => {
    expect(buildClearCookieHeaders(undefined, { preview: false })).toEqual([]);
    expect(buildClearCookieHeaders('', { preview: true })).toEqual([]);
  });

  it('tolerates whitespace and empty segments in the cookie header', () => {
    const headers = buildClearCookieHeaders('  better-auth.session_token=abc ;; ', {
      preview: false,
    });

    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('better-auth.session_token=;');
  });
});

/** Minimal Express-shaped req/res stubs for the clear-session handler. */
function stubReqRes(req: { query?: Record<string, unknown>; cookie?: string }) {
  const json = vi.fn();
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(() => ({ json })),
  };
  return {
    req: { query: req.query ?? {}, headers: { cookie: req.cookie } },
    res,
    json,
  };
}

describe('tryClearStaleSession', () => {
  it('expires the cookie with preview attributes and answers 200 {cleared:true}', () => {
    const { req, res, json } = stubReqRes({
      query: { clearCookies: '1' },
      cookie: 'better-auth.session_token=abc',
    });

    const handled = tryClearStaleSession(req, res, { preview: true });

    expect(handled).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('set-cookie', [
      expect.stringContaining('Partitioned'),
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ cleared: true });
  });

  it('still answers 200 {cleared:true} without a Set-Cookie when no cookie is present', () => {
    const { req, res, json } = stubReqRes({ query: { clearCookies: '1' } });

    const handled = tryClearStaleSession(req, res, { preview: false });

    expect(handled).toBe(true);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ cleared: true });
  });

  it('falls through (returns false, touches nothing) when clearCookies is absent', () => {
    const { req, res } = stubReqRes({
      query: {},
      cookie: 'better-auth.session_token=abc',
    });

    const handled = tryClearStaleSession(req, res, { preview: true });

    expect(handled).toBe(false);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
