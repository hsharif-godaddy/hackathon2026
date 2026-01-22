/**
 * Credit grant types from the control plane API
 * GET /airo/v1/subscriptions/:subscriptionId/credits/grants?syncSpend=true
 */

/**
 * Grant type enum from the control plane API
 */
export enum GrantType {
  PlanMonthly = 'plan-monthly',
  CreditPack = 'credit-pack',
}

/**
 * Final state of a grant
 */
export enum GrantFinalState {
  Consumed = 'consumed',
  Expired = 'expired',
}

/**
 * Credit grant from the control plane API
 */
export interface CreditGrant {
  id: string
  subscriptionId: string
  type: GrantType
  llmBudgetUserId: string
  llmBudgetId: string
  creditsMax: number
  creditsSpent: number
  isAvailable: boolean
  finalState: GrantFinalState | null
  useBefore: string
  consumedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * API response for credit grants
 */
export interface CreditGrantsResponse {
  success: boolean
  data: CreditGrant[]
}

/**
 * Subscription plan types
 */
export enum SubscriptionPlan {
  None = 'none',
  AiroPlus = 'airoPlus',
  Free = 'free',
  Starter = 'starter',
}

/**
 * Subscription data from the control plane API
 * GET /airo/v1/subscriptions/:subscriptionId
 */
export interface Subscription {
  id: string
  productId: string
  customerId: string
  status: 'active' | 'inactive' | 'cancelled'
  isTrial: boolean
  /** @deprecated Use plan instead */
  tokenBudgetId: string
  /** Airo Plus entitlement ID */
  entitlementId: string
  /** Airo Builder entitlement ID */
  builderEntitlementId: string | null
  /** Current plan type */
  plan: SubscriptionPlan
  createdAt: string
  updatedAt: string
  /** When the Airo Builder entitlement renews */
  renewsAt: string | null
}

/**
 * Extended subscription data with Airo Builder plan info
 * These fields are added when appbuilder-manage-plan feature is enabled
 */
export interface SubscriptionPlanInfo {
  /** Airo Builder entitlement ID */
  builderEntitlementId: string | null
  /** Current plan type */
  plan: SubscriptionPlan
  /** When the Airo Builder entitlement renews */
  renewsAt: string | null
}
