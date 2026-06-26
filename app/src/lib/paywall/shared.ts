/**
 * Shared Paywall Configuration and Types
 *
 * This module contains shared constants, types, and helper functions
 * used by both client-side and server-side paywall implementations.
 */

import { SubscriptionPlan } from '@/types/credits';

/**
 * Credit limit for freemium tier (suspended users are limited to this)
 */
export const FREEMIUM_CREDIT_LIMIT = 50;

/**
 * Days after renewsAt when published apps will be unpublished (for suspended subscriptions)
 */
export const DAYS_UNTIL_UNPUBLISH = 3;

/**
 * Calculate and format the unpublish date based on renewsAt
 *
 * @param renewsAt - ISO date string when the subscription renews
 * @returns Formatted date string (e.g., "February 1, 2027") or null if renewsAt is not provided
 */
export function getFormattedUnpublishDate(renewsAt?: string, locale: string = 'en-US'): string | null {
  if (!renewsAt) return null;

  const renewsAtDate = new Date(renewsAt);
  const unpublishDate = new Date(renewsAtDate);
  unpublishDate.setDate(unpublishDate.getDate() + DAYS_UNTIL_UNPUBLISH);

  return unpublishDate.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Criteria for matching Airo Plus projects
 */
export const PAYWALL_CONFIG = {
  PROJECT_MATCH_CRITERIA: {
    GROUP: 'aigeneratedmedia',
    STATUS: 'ACTIVE',
    PLAN: 'logoImage',
  },
} as const;

/**
 * Reasons for paywall denial
 */
export enum PaywallDenialReason {
  /** User has reached their publish limit for their plan */
  PublishLimitReached = 'publish_limit_reached',
  /** User does not have an active subscription */
  NoSubscription = 'no_subscription',
  /** User needs Airo Plus subscription */
  SubscriptionRequired = 'subscription_required',
  /** Unable to verify subscription status */
  VerificationFailed = 'verification_failed',
}

/**
 * Detailed breakdown of paywall check results
 */
export interface PaywallCheckDetails {
  /** User has an active subscription */
  hasSubscription: boolean;
  /** User has entitlements for Airo Plus */
  hasEntitlements: boolean;
  /** User has a matching project (fallback access method) */
  hasMatchingProject: boolean;
  /** Subscription ID if found */
  subscriptionId?: string;
  /** Entitlement ID if found */
  entitlementId?: string;
  /** Billing ID from matching project if found */
  billingId?: string;
  /** Publish limit for the plan (when grants enabled) */
  publishLimit?: number | null;
  /** Current published apps count (when grants enabled) */
  publishedCount?: number;
}

/**
 * Result of paywall eligibility check
 */
export interface PaywallCheckResult {
  /** Whether user has access to publish */
  hasAccess: boolean;
  /** Reason for denial (if applicable) */
  reason?: PaywallDenialReason | string;
  /** Detailed breakdown of check results */
  details: PaywallCheckDetails;
}

/**
 * Project edge from GraphQL response
 */
export interface ProjectEdge {
  node: {
    group: string;
    status: string;
    billing?: {
      id: string;
      plan: string;
    };
  };
}

/**
 * Legacy plan list (includes AiroPlus). Kept for isPaidPlan() function.
 *
 * Used throughout the codebase for feature gating and UI conditional rendering.
 * Add new paid plan types here when they are introduced.
 */
export const PAID_PLANS = [
  SubscriptionPlan.AiroPlus,
  SubscriptionPlan.Starter,
  SubscriptionPlan.Professional,
  SubscriptionPlan.Ultimate,
] as const;

/**
 * Plans that grant paid-tier access (Starter, Professional, Ultimate)
 *
 * AiroPlus is NOT considered a paid plan.
 * Starter, Professional, and Ultimate grant access; AiroPlus users need to upgrade.
 */
export const GRANTS_PAID_PLANS = [
  SubscriptionPlan.Starter,
  SubscriptionPlan.Professional,
  SubscriptionPlan.Ultimate,
] as const;

/**
 * Type representing any paid plan
 */
export type PaidPlan = typeof PAID_PLANS[number];

/**
 * Type representing paid plans when grants is enabled
 */
export type GrantsPaidPlan = typeof GRANTS_PAID_PLANS[number];

/**
 * Check if a plan is a paid plan
 *
 * @param plan - Subscription plan to check
 * @returns True if plan grants paid-tier access
 */
export function isPaidPlan(plan: SubscriptionPlan | undefined | null): plan is PaidPlan {
  return plan != null && (PAID_PLANS as readonly SubscriptionPlan[]).includes(plan);
}

/**
 * Check if a plan is a paid plan (grants-aware)
 *
 * Only Starter, Professional, and Ultimate are paid plans.
 * AiroPlus users need to upgrade.
 *
 * @param plan - Subscription plan to check
 * @returns True if plan grants paid-tier access
 */
export function isPaidPlanForGrants(
  plan: SubscriptionPlan | undefined | null
): boolean {
  if (plan == null) return false;
  return (GRANTS_PAID_PLANS as readonly SubscriptionPlan[]).includes(plan);
}

/**
 * Account-level paid eligibility: an active subscription on a grants-paid plan.
 *
 * Single source of truth for "does this subscription grant paid-tier access",
 * shared by the eligibility hook and the publish critical path so the two never
 * diverge.
 *
 * @param subscription - The active subscription (or null/undefined)
 * @returns True if the subscription is active and on a paid plan
 */
export function hasActivePaidPlan(
  subscription: { status?: string; plan?: SubscriptionPlan | null } | null | undefined
): boolean {
  return subscription?.status === 'active' && isPaidPlanForGrants(subscription.plan);
}

/**
 * Paywall modal types
 *
 * Determines which modal to show to the user.
 */
export type PaywallType = 'upgrade' | 'credits';

export const PAYWALL_TYPE = {
  UPGRADE: 'upgrade',
  CREDITS: 'credits',
} as const satisfies Record<string, PaywallType>;

/**
 * Internal Tracking Codes (ITCs) for purchase attribution.
 *
 * All ITC strings and landing-page campaign selection live here. Add a `PAYWALL_ITC`
 * entry first, then a row in `LANDING_PAGE_ITC_BY_USE_CASE`. Landing YAML
 * `route.useCase` is resolved via `landingItc` for `setItcOverride`.
 */
export const PAYWALL_ITC = {
  /** ITC for landing page / freemium signup (Airo Build-a-Thon campaign) */
  BUILD_A_THON_PROMPT_SUBMISSION: 'airo-build-a-thon-prompt-submission',
  /** ITC for publish paywall (when publish is blocked) */
  PUBLISH: 'upp_airo_ai_builder_publish',
  /** ITC for upgrade buttons (chat gauge, header, budget exceeded, manage plan, etc.) */
  UPGRADE: 'upp_airo_ai_builder_upgrade',
  /** ITC for buy credits buttons (capital 'B' in Builder is intentional per product team) */
  CREDITS: 'upp_airo_ai_Builder_credit',
  /** ITC for domain sales via the chat domain-purchase widget */
  DOMAIN_PURCHASE: 'airo_ai_builder_domain_purchase',
  /** ITC for the domain-suggestion bar expedite-purchase / Express Checkout flow (non-chat) */
  DOMAIN_EXPEDITE_PURCHASE: 'airo_ai_builder_domain_expedite_purchase',
  /** ITC for domain purchase for external domain attach purchase flow */
  ATTACH_DOMAIN: 'airo_ai_builder_attach_domain',
  /** ITC for code editor paywall (when code view is blocked) */
  CODE_EDITOR: 'upp_airo_ai_builder_code_editor',
} as const;

export type PaywallItcValue = (typeof PAYWALL_ITC)[keyof typeof PAYWALL_ITC];

const LANDING_PAGE_ITC_BY_USE_CASE = new Map<string, PaywallItcValue>([
  ['airo-build-a-thon', PAYWALL_ITC.BUILD_A_THON_PROMPT_SUBMISSION],
]);

/**
 * Campaign ITC for landing page `route.useCase` (YAML / `LandingPageData.route`), for `setItcOverride`.
 */
export function landingItc(useCase: string): PaywallItcValue | null {
  if (!useCase) {
    return null;
  }
  return LANDING_PAGE_ITC_BY_USE_CASE.get(useCase) ?? null;
}

/**
 * Plan priority ranking for selecting the best subscription
 *
 * Higher numbers indicate higher priority plans. Used when a user has
 * multiple subscriptions to determine which one to use.
 *
 * Priority order: Ultimate > Professional > Starter > Free > AiroPlus > None
 * Note: When grants is enabled, AiroPlus does NOT grant paid access.
 * Only Starter, Professional, and Ultimate grant paid access when grants is enabled.
 * The priority ranking is for subscription selection, not access control.
 */
export const PLAN_PRIORITY: Record<SubscriptionPlan, number> = {
  [SubscriptionPlan.Ultimate]: 6,
  [SubscriptionPlan.Professional]: 5,
  [SubscriptionPlan.Starter]: 4,
  [SubscriptionPlan.Free]: 3,
  [SubscriptionPlan.AiroPlus]: 2,
  [SubscriptionPlan.None]: 1,
};

/**
 * Check if a user can upgrade their plan
 *
 * Shows upgrade for all non-Ultimate users (Free→Starter→Professional→Ultimate)
 *
 * @param plan - Current subscription plan
 * @returns True if user should see upgrade CTAs
 */
export function canUpgradePlan(
  plan: SubscriptionPlan | undefined | null
): boolean {
  if (plan == null) return true; // No plan = should show upgrade

  // Upgrade available for all non-Ultimate users
  return plan !== SubscriptionPlan.Ultimate;
}

/**
 * Plans that require Starter tier or above
 */
export const STARTER_AND_ABOVE_PLANS = [
  SubscriptionPlan.Starter,
  SubscriptionPlan.Professional,
  SubscriptionPlan.Ultimate,
] as const;

/**
 * Check if a plan is Starter or above
 *
 * Used for features gated to Starter/Professional/Ultimate tiers (e.g., analytics).
 *
 * @param plan - Subscription plan to check
 * @returns True if plan is Starter, Professional, or Ultimate
 */
export function isStarterOrAbove(
  plan: SubscriptionPlan | undefined | null
): boolean {
  if (plan == null) return false;
  return (STARTER_AND_ABOVE_PLANS as readonly SubscriptionPlan[]).includes(plan);
}

/**
 * Plans that require Professional tier or above
 */
export const PROFESSIONAL_AND_ABOVE_PLANS = [
  SubscriptionPlan.Professional,
  SubscriptionPlan.Ultimate,
] as const;

/**
 * Check if a plan is Professional or above
 *
 * Used for features gated to Professional/Ultimate tiers (e.g., delegation, transfer).
 *
 * @param plan - Subscription plan to check
 * @returns True if plan is Professional or Ultimate
 */
export function isProfessionalOrAbove(
  plan: SubscriptionPlan | undefined | null
): boolean {
  if (plan == null) return false;
  return (PROFESSIONAL_AND_ABOVE_PLANS as readonly SubscriptionPlan[]).includes(plan);
}

/**
 * Legacy AiroPlus users are on the Starter plan but previously had AiroPlus.
 * They are grandfathered into AiroPlus-tier publish limits (9 apps).
 */
export function isLegacyAiroPlus(
  plan: SubscriptionPlan | undefined | null,
  hadAiroPlus: boolean | undefined
): boolean {
  return plan === SubscriptionPlan.Starter && !!hadAiroPlus;
}

/**
 * Returns the effective plan for publish limit calculations.
 * Legacy AiroPlus users (Starter + hadAiroPlus) are treated as AiroPlus
 * for limit purposes; all other users use their actual plan.
 */
export function getEffectivePlan(
  plan: SubscriptionPlan | undefined | null,
  hadAiroPlus: boolean | undefined
): SubscriptionPlan | undefined | null {
  return isLegacyAiroPlus(plan, hadAiroPlus) ? SubscriptionPlan.AiroPlus : plan;
}

/**
 * Check if a plan change is an upgrade (new plan has higher tier than old plan)
 *
 * Uses PLAN_PRIORITY to compare: Ultimate > Professional > Starter > Free > AiroPlus > None
 *
 * @param oldPlan - Current/previous subscription plan
 * @param newPlan - Target/new subscription plan
 * @returns True if newPlan is a higher tier than oldPlan
 */
export function isPlanUpgrade(
  oldPlan: SubscriptionPlan | string | undefined | null,
  newPlan: SubscriptionPlan | string | undefined | null
): boolean {
  if (oldPlan == null || newPlan == null) return false;

  const oldPriority = PLAN_PRIORITY[oldPlan as SubscriptionPlan] ?? 0;
  const newPriority = PLAN_PRIORITY[newPlan as SubscriptionPlan] ?? 0;

  return newPriority > oldPriority;
}
