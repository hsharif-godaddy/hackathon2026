/**
 * JWT utility functions for safe JWT token handling
 */

import { logger } from '@/lib/request-context';

/**
 * JWT payload structure
 */
export interface JWTPayload {
  /** Customer ID */
  cid?: string;
  /** Shopper ID */
  shopperId?: string;
  /** Expiration timestamp */
  exp?: number;
  /** Issued at timestamp */
  iat?: number;
  /** Subject */
  sub?: string;
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** Additional custom claims */
  [key: string]: any;
}

/**
 * Decode JWT without verification
 *
 * IMPORTANT: This only decodes the JWT structure, it does NOT verify the signature.
 * Use gdAuthService.authenticate() for validation and verification.
 *
 * @param token - JWT token string
 * @returns Decoded JWT payload or null if decode fails
 *
 * @example
 * ```typescript
 * const payload = decodeJWT(token);
 * if (payload?.cid) {
 *   console.log('Customer ID:', payload.cid);
 * }
 * ```
 */
export function decodeJWT(token: string): JWTPayload | null {
  try {
    if (!token || typeof token !== 'string') {
      logger.warn('jwt-utils.decode.invalid-input', {
        message: 'Invalid token input',
        hasToken: !!token,
        tokenType: typeof token
      });
      return null;
    }

    // JWT structure: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      logger.warn('jwt-utils.decode.invalid-structure', {
        message: 'Invalid JWT structure',
        parts: parts.length
      });
      return null;
    }

    // Decode the payload (second part)
    const payloadBase64 = parts[1];
    
    // Handle URL-safe base64 encoding
    const normalizedBase64 = payloadBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed
    const paddedBase64 = normalizedBase64 + '='.repeat((4 - (normalizedBase64.length % 4)) % 4);
    
    const payloadJson = Buffer.from(paddedBase64, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson) as JWTPayload;

    return payload;
  } catch (error) {
    logger.warn('jwt-utils.decode.error', {
      message: 'Failed to decode JWT',
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Extract customer ID from JWT token
 *
 * Handles multiple JWT formats including nested auth objects.
 * Checks in order:
 * 1. Nested auth objects (cert2s, e2s, s2s, e2s2s) - highest priority
 * 2. Root level cid
 * 3. Extract from sub field (format: "Customer:123")
 *
 * @param token - JWT token string
 * @returns Customer ID (cid) or null if not found
 *
 * @example
 * ```typescript
 * const customerId = extractCustomerId(jwt);
 * if (!customerId) {
 *   throw new Error('Failed to extract customer ID from JWT');
 * }
 * ```
 */
export function extractCustomerId(token: string): string | null {
  const payload = decodeJWT(token);
  if (!payload) {return null;}

  // Check nested auth objects first (they have priority)
  const nestedAuthTypes = ['cert2s', 'e2s', 's2s', 'e2s2s'];
  for (const authType of nestedAuthTypes) {
    if (payload[authType] && typeof payload[authType] === 'object') {
      const nestedAuth = payload[authType];
      if (nestedAuth.cid) {
        return nestedAuth.cid;
      }
    }
  }

  // Fall back to root level cid
  if (payload.cid) {
    return payload.cid;
  }

  // Final fallback to extracting from sub field (format: "Customer:123")
  if (payload.sub && typeof payload.sub === 'string' && payload.sub.includes('Customer:')) {
    return payload.sub.split(':')[1];
  }

  return null;
}

/**
 * Extract shopper ID from JWT token
 *
 * Handles multiple JWT formats including nested auth objects.
 * Checks in order:
 * 1. Nested auth objects (cert2s, e2s, s2s, e2s2s) - highest priority
 * 2. Root level shopperId
 *
 * @param token - JWT token string
 * @returns Shopper ID or null if not found
 */
export function extractShopperId(token: string): string | null {
  const payload = decodeJWT(token);
  if (!payload) {return null;}

  // Check nested auth objects first (they have priority)
  const nestedAuthTypes = ['cert2s', 'e2s', 's2s', 'e2s2s'];
  for (const authType of nestedAuthTypes) {
    if (payload[authType] && typeof payload[authType] === 'object') {
      const nestedAuth = payload[authType];
      if (nestedAuth.shopperId) {
        return nestedAuth.shopperId;
      }
    }
  }

  // Fall back to root level shopperId
  return payload.shopperId || null;
}

/**
 * Check if JWT token is expired
 *
 * @param token - JWT token string
 * @returns true if expired, false if still valid, null if cannot determine
 */
export function isJWTExpired(token: string): boolean | null {
  const payload = decodeJWT(token);
  if (!payload?.exp) {
    return null;
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  return payload.exp < nowInSeconds;
}

