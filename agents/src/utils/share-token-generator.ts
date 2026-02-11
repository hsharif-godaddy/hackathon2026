import crypto from 'crypto';

/**
 * Generate a cryptographically secure share token.
 *
 * Tokens are base64url encoded (URL-safe: no +, /, =)
 * Default length: 12 characters = 72 bits of entropy (2^72 ≈ 4.7 × 10^21, about 4.7 sextillion, combinations)
 *
 * @param length Token length (default: 12)
 * @returns Base64url-encoded token
 */
export function generateShareToken(length: number = 12): string {
  // Generate enough random bytes (base64 encoding uses 4 chars for 3 bytes)
  const bytes = crypto.randomBytes(Math.ceil((length * 3) / 4));

  return bytes
    .toString('base64')
    .replace(/\+/g, '-')  // URL-safe: + → -
    .replace(/\//g, '_')  // URL-safe: / → _
    .replace(/=/g, '')    // Remove padding
    .slice(0, length);    // Trim to exact length
}

/**
 * Validate share token format.
 *
 * Accepts tokens between 8-16 characters containing only:
 * - Letters (A-Z, a-z)
 * - Numbers (0-9)
 * - URL-safe characters (-, _)
 *
 * @param token Token to validate
 * @returns true if format is valid
 */
export function isValidShareTokenFormat(token: string): boolean {
  if (typeof token !== 'string') {
    return false;
  }
  return /^[A-Za-z0-9_-]{8,16}$/.test(token);
}
