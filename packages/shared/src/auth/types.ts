/**
 * Shared authentication types for Airo App Builder
 *
 * This module provides TypeScript types for auth types used across the codebase.
 */

/**
 * Supported auth types for JWT authentication (gd-auth token validation).
 *
 * Auth types accepted by gd-auth-lib's Auths enum (gd_auth::validation::Auths).
 * The `auths` field in parseToken options filters tokens by their top-level `auth` claim.
 * Tokens whose auth type is not in this list are rejected with TOKEN_AUTH_RESTRICTED.
 *
 * - basic: Normal authentication
 * - e2s: Employee-to-shopper impersonation
 * - s2s: Shopper-to-shopper delegation
 * - e2s2s: Employee-to-shopper-to-shopper
 * - e2s2p: Employee-to-shopper-to-partner
 * - e2s2snpr: Employee-to-shopper-to-shopper (NPR)
 * - cert2s: Certificate-to-shopper
 * - e2p: Employee-to-partner
 * - s2p: Shopper-to-partner
 * - s2snpr: Shopper-to-shopper (non-personalized reseller)
 */
export const SUPPORTED_AUTH_TYPES = [
  'basic',
  'e2s',
  's2s',
  'e2s2s',
  'e2s2p',
  'e2s2snpr',
  'cert2s',
  'e2p',
  's2p',
  's2snpr',
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
 * Product IDs for Airo products.
 * Use these constants when filtering API requests by specific product version.
 */
export const AIRO_PRODUCT_IDS = {
  /** AI App Builder v1 */
  AAB_V1: 'aab-v1',
  /** PaaS Node.js v1 */
  PAAS_NODEJS_V1: 'paas-nodejs-v1',
} as const

export type AiroProductId = typeof AIRO_PRODUCT_IDS[keyof typeof AIRO_PRODUCT_IDS]

/**
 * Owner products (product families) for Airo's dual-product architecture.
 * Use ownerProduct for filtering to be forward-compatible with future versions.
 *
 * - AiroAppBuilder: Full-stack app builder (UI → BFF → Agents)
 * - PaaSNodeJS: Headless PaaS (external UI → V2 API / Agents API)
 */
export const AIRO_OWNER_PRODUCTS = {
  /** AI App Builder product family */
  AIRO_APP_BUILDER: 'AiroAppBuilder',
  /** PaaS Node.js product family */
  PAAS_NODEJS: 'PaaSNodeJS',
} as const

export type AiroOwnerProduct = typeof AIRO_OWNER_PRODUCTS[keyof typeof AIRO_OWNER_PRODUCTS]

/**
 * ProductType is the same union as AiroOwnerProduct — used in JWT claims and middleware.
 */
export type ProductType = AiroOwnerProduct

/**
 * Default owner product for the application (AI App Builder).
 * Used to filter API responses to only show AAB apps.
 */
export const DEFAULT_OWNER_PRODUCT = AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER

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
