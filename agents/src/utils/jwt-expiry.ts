/**
 * GoDaddy SSO tokens (typ=jomax|idp|cert) often ship with `iat` + `vat` but
 * no `exp`; ai-lib treats these as 30-min TTL and we match so the two caches
 * agree on when a refresh is needed.
 */
const NO_EXP_TTL_SECONDS = 30 * 60;

/**
 * Decode the effective expiry (unix seconds) from a JWT without verifying
 * the signature. Returns null if the token is unparseable OR if neither
 * `exp` nor `iat` is present.
 *
 * Precedence: standard `exp` → `iat + NO_EXP_TTL_SECONDS`. We do NOT use
 * GoDaddy-specific `vat` because ai-lib's cache ignores it too; using
 * different expiry sources would cause the two layers to disagree.
 *
 * Signature verification is the server's job at the other end of the
 * request. We only care about WHEN to proactively refetch.
 */
export function decodeJwtExp(
  jwt: string,
  onDecodeFailed?: (error: unknown) => void,
): number | null {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const claims = JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf-8')) as {
      exp?: number;
      iat?: number;
    };
    if (typeof claims.exp === 'number') return claims.exp;
    if (typeof claims.iat === 'number') return claims.iat + NO_EXP_TTL_SECONDS;
    return null;
  } catch (error) {
    onDecodeFailed?.(error);
    return null;
  }
}
