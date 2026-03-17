/**
 * Shared authentication types for Airo App Builder
 *
 * This module provides TypeScript types for auth types used across the codebase.
 */

/**
 * Supported auth types for JWT authentication (gd-auth token validation).
 *
 * IMPORTANT: gd-auth validates tokens against this list. If a token's auth type
 * is not in this array, gd-auth will throw TokenAuthMismatchError and reject it.
 * This list must include ALL auth types we want to support.
 *
 * Auth types (from gd-auth source):
 * - basic: Normal authentication
 * - e2s: Employee-to-shopper impersonation
 * - s2s: Shopper-to-shopper delegation
 * - e2s2s: Employee-to-shopper-to-shopper
 * - e2s2p: Employee-to-shopper-to-partner
 * - e2s2snpr: Employee-to-shopper-to-shopper (NPR)
 * - e2s2s2p: Employee-to-shopper-to-shopper-to-partner
 * - cert2s: Certificate-to-shopper
 * - e2p: Employee-to-partner
 * - s2p: Shopper-to-partner
 * - s2snpr: Shopper-to-shopper (non-personalized reseller)
 * - s2s2p: Shopper-to-shopper-to-partner
 */
export const SUPPORTED_AUTH_TYPES = [
  'basic',
  'e2s',
  's2s',
  'e2s2s',
  'e2s2p',
  'e2s2snpr',
  'e2s2s2p',
  'cert2s',
  'e2p',
  's2p',
  's2snpr',
  's2s2p',
] as const

/**
 * All auth types supported by gd-auth token validation.
 * Derived from SUPPORTED_AUTH_TYPES const array.
 */
export type SupportedAuthType = (typeof SUPPORTED_AUTH_TYPES)[number]

/**
 * Auth types used in custom JWT claims (agents service tokens).
 *
 * - basic: Normal customer authentication
 * - e2s: Employee-to-shopper (care agent impersonation)
 * - s2s: Shopper-to-shopper delegation
 */
export type AuthType = 'basic' | 'e2s' | 's2s'

/**
 * Check if an auth type represents an employee session.
 *
 * Employee auth types allowed for use within app:
 * - e2s: Employee-to-shopper
 * - e2s2s: Employee-to-shopper-to-shopper
 *
 * @param authType - The auth type to check
 * @returns true if the auth type represents an employee session
 */
export function isEmployeeAuthType(authType: SupportedAuthType | AuthType | string | undefined): boolean {
  return authType === 'e2s' || authType === 'e2s2s';
}
