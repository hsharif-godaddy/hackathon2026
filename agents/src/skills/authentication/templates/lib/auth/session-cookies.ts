/**
 * BetterAuth session-cookie clearing.
 *
 * A stale `better-auth.session_token` cookie (e.g. left over after the server
 * DB was reset or `BETTER_AUTH_SECRET` rotated) makes `useSession()` resolve to
 * a permanent error/pending state: the app renders nothing and no error
 * boundary fires, because a failed session lookup is a returned value, not a
 * thrown exception. The cookie is `HttpOnly`, so client JS can't delete it —
 * the server must expire it on a `Set-Cookie` response.
 *
 * `buildClearCookieHeaders` produces the expiry `Set-Cookie` values for every
 * BetterAuth cookie present on the request. The attributes must be compatible
 * with how the cookie was originally set or the browser won't overwrite it:
 * preview runs cross-site in the builder iframe (`SameSite=None; Secure;
 * Partitioned`), published apps run first-party (`SameSite=Lax`). Mirrors the
 * `defaultCookieAttributes` branch in `auth.ts`.
 */

const EXPIRY = 'Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly';

interface ClearCookieOptions {
  /** True when the app is served inside the builder's cross-site preview iframe. */
  preview: boolean;
}

/**
 * Cookie names BetterAuth issues are prefixed with `better-auth` and, in secure
 * contexts, additionally carry the `__Secure-`/`__Host-` cookie prefix. Match on
 * the substring so every variant the browser actually holds is cleared.
 */
function isBetterAuthCookie(name: string): boolean {
  return name.includes('better-auth');
}

/** Extract the cookie names from a request `Cookie` header, ignoring empty segments. */
function parseCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(';')
    .map((segment) => segment.trim().split('=')[0].trim())
    .filter((name) => name.length > 0);
}

export function buildClearCookieHeaders(
  cookieHeader: string | undefined,
  options: ClearCookieOptions,
): string[] {
  if (!cookieHeader) return [];

  // `Secure` is set in both modes: preview is cross-site (requires it), and
  // published apps are first-party HTTPS where BetterAuth issues `__Secure-`
  // prefixed cookies — a Set-Cookie for a `__Secure-` name without `Secure` is
  // rejected by the browser, so omitting it would silently no-op the clear.
  const attributes = options.preview
    ? `${EXPIRY}; SameSite=None; Secure; Partitioned`
    : `${EXPIRY}; SameSite=Lax; Secure`;

  return parseCookieNames(cookieHeader)
    .filter(isBetterAuthCookie)
    .map((name) => `${name}=; ${attributes}`);
}

/** Minimal Express request shape needed to handle the clear-session request. */
interface ClearSessionRequest {
  query: Record<string, unknown>;
  headers: { cookie?: string };
}

/** Minimal Express response shape needed to answer the clear-session request. */
interface ClearSessionResponse {
  setHeader(name: string, value: string | readonly string[]): unknown;
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Handle the `?clearCookies=1` stale-session escape hatch.
 *
 * Returns `true` when it owned the request (the caller must return early), and
 * `false` when the request should fall through to BetterAuth. Deliberately free
 * of `getAuth()`/db so it still recovers a session when auth itself is the thing
 * that's broken.
 */
export function tryClearStaleSession(
  req: ClearSessionRequest,
  res: ClearSessionResponse,
  options: ClearCookieOptions,
): boolean {
  if (req.query.clearCookies !== '1') return false;

  const cleared = buildClearCookieHeaders(req.headers.cookie, options);
  if (cleared.length > 0) {
    res.setHeader('set-cookie', cleared);
  }
  console.info(JSON.stringify({ event: 'auth.session.cleared', count: cleared.length }));
  res.status(200).json({ cleared: true });
  return true;
}
