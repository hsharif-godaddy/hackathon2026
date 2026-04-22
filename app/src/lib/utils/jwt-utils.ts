/**
 * JWT utility functions for offline claim extraction (no signature verification).
 * Use gdAuthService.authenticate() for validated auth decisions.
 */

/**
 * Decode JWT payload without verification.
 */
function decodeJWT(token: string): Record<string, any> | null {
  try {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

/**
 * Extract customer ID from JWT token.
 * Checks delegation chain nested objects (e2s, s2s, etc.) before top-level cid.
 */
export function extractCustomerId(token: string): string | null {
  const payload = decodeJWT(token);
  if (!payload) return null;

  const nestedAuthTypes = ['cert2s', 'e2s', 's2s', 'e2s2s'];
  for (const authType of nestedAuthTypes) {
    if (payload[authType] && typeof payload[authType] === 'object') {
      const nestedAuth = payload[authType];
      if (nestedAuth.cid) {
        return nestedAuth.cid;
      }
    }
  }

  if (payload.cid) {
    return payload.cid;
  }

  if (payload.sub && typeof payload.sub === 'string' && payload.sub.includes('Customer:')) {
    return payload.sub.split(':')[1];
  }

  return null;
}
