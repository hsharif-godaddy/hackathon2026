/**
 * Helpers for propagating the Katana artifact selector (`x-katana-version`) from an
 * incoming request onto specific outbound mgmt-airo ("hosting") calls.
 *
 * Katana's `dark_release` promotion strategy deploys an artifact at 0% traffic; it is
 * only reachable by explicitly targeting it with an `x-katana-version` query param,
 * header, or cookie. When the builder app is dark-released and reached via this
 * selector, we forward the same value downstream so the matching flows exercise the
 * intended artifact end-to-end.
 *
 * See the Katana "Canary Deployment Strategy" and "L4 Ingress" Confluence docs.
 */

/** Header / query-param name Katana uses to target a specific artifact (hyphenated). */
export const KATANA_VERSION_HEADER = 'x-katana-version';

/**
 * Cookie name set by Katana's "playground-picker" lambda when a request hits
 * `?x-katana-version=<id>&cookie=1`. NOTE: the cookie uses UNDERSCORES, unlike the
 * hyphenated header / query-param form — confirmed via Set-Cookie on the live ingress:
 *   set-cookie: x_katana_version=<id>; path=/; SameSite=None; Secure; Max-Age=86400
 */
export const KATANA_VERSION_COOKIE = 'x_katana_version';

/**
 * Read the Katana artifact selector from an incoming request: the `x-katana-version`
 * header first, then the `x_katana_version` cookie (underscores — what the picker
 * lambda sets), then a hyphenated cookie as a defensive fallback. Returns a sanitized
 * value, or `undefined` when absent/invalid.
 *
 * Accepts a `Headers` object (not `NextRequest`) so it works both in route handlers
 * (`request.headers`) and in the control-plane adapter (`CreateSiteParams.headers`),
 * which only receives `Headers`.
 */
export function extractKatanaVersion(headers: Headers): string | undefined {
  const cookieHeader = headers.get('cookie');
  const raw =
    headers.get(KATANA_VERSION_HEADER)
    ?? readCookie(cookieHeader, KATANA_VERSION_COOKIE)
    ?? readCookie(cookieHeader, KATANA_VERSION_HEADER);
  return sanitizeKatanaVersion(raw);
}

/**
 * Validate a candidate selector. Katana artifact selectors are short id/version-style
 * tokens; restrict to a conservative charset (alphanumerics, `_`, `.`, `-`, max 64
 * chars) to avoid forwarding junk and to prevent header injection (CR/LF).
 */
export function sanitizeKatanaVersion(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^[\w.-]{1,64}$/.test(trimmed) ? trimmed : undefined;
}

/** Extract a single cookie value from a `Cookie` header string. */
function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}
