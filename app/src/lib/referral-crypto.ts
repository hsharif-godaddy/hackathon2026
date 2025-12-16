/**
 * Referral Crypto Service
 *
 * Provides secure signed referral IDs using HMAC-SHA256 and base62 encoding.
 * The format is: {base62_shopperId}-{signature}
 * Optimized for numeric shopperIds to produce very short referral codes.
 *
 * @note This file is server-only and uses Node.js crypto module
 */

import { createHmac } from 'node:crypto';

import { logger } from './request-context';

/**
 * Base62 character set for encoding
 */
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Signature length - 6 characters (36 bits = ~68 billion combinations)
 */
const SIGNATURE_LENGTH = 6;

/**
 * Get the secret key for HMAC signing
 *
 * In production, REFERRAL_ENCRYPTION_KEY must be set. In development,
 * a default key is used for convenience.
 *
 * @returns Secret key string
 * @throws Error if REFERRAL_ENCRYPTION_KEY is not set in production
 */
function getSecretKey(): string {
  const key = process.env.REFERRAL_ENCRYPTION_KEY;

  if (key) {
    return key;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    throw new Error(
      'REFERRAL_ENCRYPTION_KEY environment variable must be set in production.');
  }

  // Only allow default key in non-production environments
  return 'airo-dev-referral-key-not-for-production';
}

/**
 * Encode a number to base62 string
 *
 * @param num - Number to encode
 * @returns Base62 encoded string
 */
function toBase62(num: bigint): string {
  if (num === 0n) return '0';

  let result = '';
  const base = BigInt(BASE62_CHARS.length);

  while (num > 0n) {
    result = BASE62_CHARS[Number(num % base)] + result;
    num = num / base;
  }

  return result;
}

/**
 * Decode a base62 string to number
 *
 * @param str - Base62 encoded string
 * @returns Decoded number
 */
function fromBase62(str: string): bigint {
  let result = 0n;
  const base = BigInt(BASE62_CHARS.length);

  for (const char of str) {
    const index = BASE62_CHARS.indexOf(char);
    if (index === -1) throw new Error('Invalid base62 character');
    result = result * base + BigInt(index);
  }

  return result;
}

/**
 * Generate HMAC signature for a shopper ID
 *
 * @param shopperId - The shopper ID to sign
 * @returns Short signature string
 */
function sign(shopperId: string): string {
  const hmac = createHmac('sha256', getSecretKey());
  hmac.update(shopperId);
  return hmac.digest('base64url').substring(0, SIGNATURE_LENGTH);
}

/**
 * Check if a string is numeric
 *
 * @param str - String to check
 * @returns True if string contains only digits
 */
function isNumeric(str: string): boolean {
  return /^\d+$/.test(str);
}

/**
 * Encode a shopper ID for use in referral links
 *
 * Creates a very short, signed referral ID.
 * For numeric IDs: base62 encoded (e.g., "dKV2-a1b2" = 9 chars)
 * For non-numeric: uses the ID directly with signature
 *
 * @param shopperId - The shopper ID to encode
 * @returns Short signed referral ID
 *
 * @example
 * ```typescript
 * const referralId = encryptReferralId('12345678');
 * // Returns something like: "dKV2-a1b2c3" (11 chars)
 * ```
 */
export function encryptReferralId(shopperId: string): string {
  try {
    let encoded: string;

    if (isNumeric(shopperId)) {
      // Numeric ID: use base62 for maximum compression
      encoded = toBase62(BigInt(shopperId));
    } else {
      // Non-numeric: use as-is (fallback for UUIDs, etc.)
      encoded = shopperId;
    }

    const signature = sign(shopperId);
    return `${encoded}-${signature}`;
  } catch (error) {
    logger.error('referral.encrypt.error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw new Error('Failed to create referral ID');
  }
}

/**
 * Decode and verify a referral ID
 *
 * Extracts the shopper ID and verifies the signature.
 * Returns null if the signature is invalid (tampered or forged).
 *
 * @param referralId - The signed referral ID to decode
 * @returns Decoded shopper ID or null if invalid
 *
 * @example
 * ```typescript
 * const shopperId = decryptReferralId('dKV2-a1b2c3');
 * if (shopperId) {
 *   // Valid referral, shopperId = '12345678'
 * }
 * ```
 */
export function decryptReferralId(referralId: string): string | null {
  try {
    // Find the last hyphen (signature is always at the end)
    const lastHyphen = referralId.lastIndexOf('-');
    if (lastHyphen === -1 || lastHyphen === referralId.length - 1) {
      logger.warn('referral.decrypt.invalid_format', { referralId: referralId.substring(0, 20) });
      return null;
    }

    const encoded = referralId.substring(0, lastHyphen);
    const providedSignature = referralId.substring(lastHyphen + 1);

    // Try to decode as base62 (numeric ID)
    let shopperId: string;
    try {
      // Check if it looks like base62 encoded number
      if (/^[0-9A-Za-z]+$/.test(encoded) && encoded.length <= 12) {
        const decoded = fromBase62(encoded);
        shopperId = decoded.toString();
      } else {
        // Non-numeric, use as-is
        shopperId = encoded;
      }
    } catch {
      // Decoding failed, use encoded value as-is
      shopperId = encoded;
    }

    // Verify signature
    const expectedSignature = sign(shopperId);
    if (providedSignature !== expectedSignature) {
      logger.warn('referral.decrypt.invalid_signature');
      return null;
    }

    return shopperId;
  } catch (error) {
    logger.warn('referral.decrypt.failed', {
      error: error instanceof Error ? error.name : 'Unknown error'
    });
    return null;
  }
}

/**
 * Validate that a referral ID is valid
 *
 * @param referralId - The referral ID to validate
 * @returns True if the ID is valid and signature matches
 */
export function isValidReferralId(referralId: string): boolean {
  return decryptReferralId(referralId) !== null;
}
