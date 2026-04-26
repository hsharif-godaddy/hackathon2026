/**
 * JWT utility functions for offline claim extraction (no signature verification).
 * Use gdAuthService.authenticate() for validated auth decisions.
 *
 * Always use extractCustomerId()/extractShopperId() for reading claims — never
 * read payload.cid or payload.shopperId directly. Delegated tokens (e2s, s2s,
 * cert2s, e2s2s) nest these values inside the auth-type object, so top-level
 * reads silently return undefined for those token types.
 */

const DELEGATION_CHAIN_TYPES = ['cert2s', 'e2s', 's2s', 'e2s2s'] as const;

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

  const nestedAuthTypes = DELEGATION_CHAIN_TYPES;
  for (const authType of nestedAuthTypes) {
    if (payload[authType] && typeof payload[authType] === 'object') {
      const nestedAuth = payload[authType];
      if (typeof nestedAuth.cid === 'string') return nestedAuth.cid;
    }
  }

  if (typeof payload.cid === 'string') return payload.cid;

  // sub fallback: only for non-delegated tokens. For e2s tokens the outer sub is an
  // employee identifier, not a customer ID — same guard as extractShopperId uses.
  const hasDelegationChain = nestedAuthTypes.some(t => payload[t] && typeof payload[t] === 'object');
  if (!hasDelegationChain && typeof payload.sub === 'string' && payload.sub.includes('Customer:')) {
    const extracted = payload.sub.split(':')[1];
    if (extracted) return extracted;
  }

  return null;
}

/**
 * Extract shopper ID from JWT token without verification.
 * Checks delegation chain nested objects (e2s, s2s, etc.) before top-level shopperId.
 */
export function extractShopperId(token: string): string | null {
  const payload = decodeJWT(token);
  if (!payload) return null;

  const nestedAuthTypes = DELEGATION_CHAIN_TYPES;
  for (const authType of nestedAuthTypes) {
    if (payload[authType] && typeof payload[authType] === 'object') {
      const nestedAuth = payload[authType];
      if (typeof nestedAuth.shopperId === 'string') {
        return nestedAuth.shopperId;
      }
    }
  }

  if (typeof payload.shopperId === 'string') return payload.shopperId;

  // sub fallback: only for tokens with no delegation chain object present.
  // For e2s tokens, the outer sub is an employee identifier, not a shopper ID —
  // scoping to non-delegated tokens avoids returning the wrong value for malformed
  // e2s tokens where e2s.shopperId is absent. Also excludes Customer:-prefixed values.
  const hasDelegationChain = nestedAuthTypes.some(t => payload[t] && typeof payload[t] === 'object');
  if (!hasDelegationChain && typeof payload.sub === 'string' && !payload.sub.includes('Customer:')) {
    return payload.sub;
  }

  return null;
}
