/**
 * Browser-safe auth utilities.
 * These functions do NOT depend on @godaddy/gd-auth-lib (NAPI native module)
 * and can be safely bundled into the client-side webpack build.
 */

/**
 * Extract auth token from request headers or cookies.
 * Lightweight - no service instantiation needed.
 */
export function extractTokenFromRequest(request: any): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  } else if (authHeader?.includes('sso-jwt ')) {
    return authHeader.split('sso-jwt ')[1];
  }

  const cookieToken = request.cookies?.get('auth_idp')?.value;
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

/**
 * Decode JWT payload without validation (for APM labeling only)
 *
 * SECURITY EXCEPTION: This function intentionally bypasses gd-auth validation.
 * Used ONLY for APM observability labels, never for authorization.
 * Full gd-auth validation still happens before any business logic.
 * WARNING: Do NOT use this function for authorization decisions.
 */
export function decodeTokenPayload(token: string): { cid?: string; shopperId?: string; auth?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(decoded);

    const cid = claims.cid || claims.customerId || claims.e2s?.cid;
    const shopperId = claims.shopperId || claims.sub || claims.e2s?.shopperId;

    return { cid, shopperId, auth: claims.auth };
  } catch {
    return null;
  }
}
