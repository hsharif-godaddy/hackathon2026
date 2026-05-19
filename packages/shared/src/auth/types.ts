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
 * - cert2s: Certificate-to-shopper (service caller acting on behalf of a shopper,
 *   e.g. mhp-core hosting minting a token for archive screenshot capture)
 */
export type AuthType = 'basic' | 'e2s' | 's2s' | 'cert2s'

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

/**
 * Message origin indicating whether the session is from support (care agent) or customer.
 * Used for visual styling of messages in the chat UI.
 *
 * - 'support': e2s/e2s2s sessions (care agent impersonation)
 * - 'customer': Regular customer sessions
 */
export type MessageOrigin = 'support' | 'customer'

/**
 * Default message origin for new sessions.
 */
export const DEFAULT_MESSAGE_ORIGIN: MessageOrigin = 'customer'

/**
 * Derive message origin from auth type.
 */
export function getMessageOriginForAuthType(authType: SupportedAuthType | AuthType | string | undefined): MessageOrigin {
  return isEmployeeAuthType(authType) ? 'support' : DEFAULT_MESSAGE_ORIGIN
}
