/**
 * Credit grant types - re-exported from shared library
 * This ensures frontend and agent use identical type definitions
 */
import type { CreditGrant as CreditGrantType } from '@airo/ai-lib/grants/client'

export type { CreditGrant, GrantContextPayload } from '@airo/ai-lib/grants/client'
export { GrantFinalState, GrantType } from '@airo/ai-lib/grants/client'

/**
 * API response for credit grants
 */
export interface CreditGrantsResponse {
  success: boolean
  data: CreditGrantType[]
}

/**
 * Subscription plan types
 */
export enum SubscriptionPlan {
  None = 'none',
  AiroPlus = 'airoPlus',
  Free = 'free',
  Starter = 'starter',
  Professional = 'professional',
  Ultimate = 'ultimate',
}

/**
 * Subscription status types
 */
export enum SubscriptionStatus {
  Active = 'active',
  Inactive = 'inactive',
  Cancelled = 'cancelled',
}
