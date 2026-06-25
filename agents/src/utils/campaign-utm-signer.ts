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

/**
 * Public-token prefixes for the Unified C2 Traffic Attribution Model. The prefix
 * namespaces the dimension the hashed id belongs to (campaign vs. content/activation)
 * so a single `(utm_source, utm_medium, utm_campaign)` row is unambiguous to the
 * clickstream warehouse and the Customer Stats API round-trip.
 *
 * `cr_` (creative dimension) is intentionally absent — M1 is one creative per
 * activation, so `utm_content` carries the `act_` token only. Add a creative token
 * here when creative-level / A-B tracking is needed in a later milestone.
 */
export const UTM_CAMPAIGN_PREFIX: string = 'cmp_';
export const UTM_CONTENT_PREFIX: string = 'act_';

/**
 * Build the opaque `utm_campaign` token (`cmp_<hash>`) from an internal campaign id.
 * The raw id never appears in the URL; the hash is deterministic + stable so the same
 * campaign always resolves to the same token (the shared warehouse/Stats-API join key).
 */
export function buildCampaignToken(campaignId: string): string {
  return `${UTM_CAMPAIGN_PREFIX}${hashWithSalt(campaignId, UTM_SALT)}`;
}

/**
 * Build the opaque `utm_content` token (`act_<hash>`) from an internal content id —
 * one stable token per carrier (social post, blog entry, …). Same id → same token.
 */
export function buildContentToken(contentId: string): string {
  return `${UTM_CONTENT_PREFIX}${hashWithSalt(contentId, UTM_SALT)}`;
}
