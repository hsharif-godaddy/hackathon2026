import { createHmac } from 'node:crypto';
import { getEncryptionKey } from '../services/token-crypto.js';

/**
 * ID obfuscation for public `utm_campaign` values (and other IDs we expose in URLs).
 *
 * A raw internal id must not leak into outbound URLs (it would advertise internal
 * system structure). Instead we publish a salted HMAC of it. This mirrors the
 * HMAC-SHA256 + getEncryptionKey pattern already used by file-url-signer.ts.
 *
 * The salt is a SINGLE GLOBAL STATIC value (UTM_SALT below), not per-campaign: the same
 * id always hashes to the same public token, so the analytics warehouse can reverse-look
 * up an id by recomputing the hash with the same salt. Reverse lookup never inverts the
 * HMAC — both sides just recompute it. The HMAC key (getEncryptionKey) supplies the
 * cryptographic strength; the salt only domain-separates this use from other hashes.
 */

/**
 * Static, offline-generated salt — hardcoded so the analytics system can use the exact
 * same value for reverse lookups. Not a secret (the HMAC key is); it only namespaces.
 */
export const UTM_SALT = 'Hq3Nv8Kp2Lm9Rt4Wx7Zb1A';

/**
 * Deterministically hash a value with a salt into a url-safe public token.
 * The same (value, salt) always yields the same output.
 */
export function hashWithSalt(value: string, salt: string): string {
  return createHmac('sha256', getEncryptionKey())
    .update(`${value}:${salt}`)
    .digest('base64url');
}
