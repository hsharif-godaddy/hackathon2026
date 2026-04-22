/**
 * Credit grant types - re-exported from shared library
 * This ensures frontend and agent use identical type definitions
 */
import type { CreditGrant as CreditGrantType } from '@airo/shared/grants'

export type { CreditGrant, GrantContextPayload } from '@airo/shared/grants'
export { GrantFinalState, GrantType } from '@airo/shared/grants'

/**
 * Source of credit data - BMS (Budget Management Service) or legacy grants API
 */
export const CreditsSource = {
  Bms: 'bms',
  Grants: 'grants',
  /** BMS enabled but budget not configured for subscription */
  Unavailable: 'unavailable',
} as const

export type CreditsSource = (typeof CreditsSource)[keyof typeof CreditsSource]

/**
 * API response for credit grants
 */
export interface CreditGrantsResponse {
  success: boolean
  data: CreditGrantType[]
  source?: CreditsSource
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
  Suspended = 'suspended',
}

/**
 * Reasons for subscription suspension
 */
export enum SubscriptionSuspendReason {
  NonPayment = 'NON_PAYMENT',
  Legal = 'LEGAL',
  Policy = 'POLICY',
  Fraud = 'FRAUD',
  PolicyOverage = 'POLICY_OVERAGE',
}

/**
 * Term types from the Offer Graph API
 */
export enum SubscriptionTerm {
  Year = 'YEAR',
  Month = 'MONTH',
}

/**
 * Formatted price strings from Offer Graph API
 */
export interface FormattedPrice {
  full: string
  discounted: string
  renewal: string
  renewalDiscounted: string | null
}

/**
 * Pricing offer from Offer Graph API with formatted prices
 */
export interface PlanOffer {
  id: string
  currency: string
  marketId: string
  term: {
    count: number
    unit: string
  }
  price: {
    formatted: {
      listing: {
        perMonth: FormattedPrice
        perTerm: {
          renewal: string
        }
      }
    }
  }
  discountPercentage: number | null
}

/**
 * All pricing data keyed by plan
 */
export interface AllPricingData {
  [SubscriptionPlan.Starter]: PlanOffer | null
  [SubscriptionPlan.Professional]: PlanOffer | null
  [SubscriptionPlan.Ultimate]: PlanOffer | null
}
