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
 * Paywall feature flag and configuration constants
 */
export const PAYWALL_CONFIG = {
  /**
   * Switchboard feature flags for paywall control
   */
  SWITCHBOARD_FLAGS: {
    PAYWALL: 'appbuilder-airoplus-paywall',
    MARKETS: 'appbuilder-airoplus-markets',
  },
  /**
   * Application identifier for switchboard
   */
  SWITCHBOARD_APP: 'airo-app-builder',
  /**
   * BFF host prefix for switchboard API calls
   */
  BFF_HOST_PREFIX: 'bff.pcx',
  /**
   * Criteria for matching Airo Plus projects
   */
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
 * Plans that grant paid-tier access (legacy - when grants is disabled)
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
 * Plans that grant paid-tier access when app-builder-grants is enabled
 *
 * When grants is enabled, AiroPlus is NOT considered a paid plan.
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
 * Check if a plan is a paid plan based on grants feature flag
 *
 * When grants is enabled, only Starter is considered a paid plan.
 * When grants is disabled (legacy), both AiroPlus and Starter are paid plans.
 *
 * @param plan - Subscription plan to check
 * @param isGrantsEnabled - Whether app-builder-grants flag is enabled
 * @returns True if plan grants paid-tier access given the grants flag state
 */
export function isPaidPlanForGrants(
  plan: SubscriptionPlan | undefined | null,
  isGrantsEnabled: boolean
): boolean {
  if (plan == null) return false;
  const paidPlans = isGrantsEnabled ? GRANTS_PAID_PLANS : PAID_PLANS;
  return (paidPlans as readonly SubscriptionPlan[]).includes(plan);
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
 * Internal Tracking Codes (ITCs) for purchase attribution
 *
 * Centralized constants to avoid duplication and typos across call sites.
 * These are passed to the unified plans and pricing library for tracking.
 */
export const PAYWALL_ITC = {
  /** ITC for publish paywall (when publish is blocked) */
  PUBLISH: 'upp_airo_ai_builder_publish',
  /** ITC for upgrade buttons (chat gauge, header, budget exceeded, manage plan, etc.) */
  UPGRADE: 'upp_airo_ai_builder_upgrade',
  /** ITC for buy credits buttons (capital 'B' in Builder is intentional per product team) */
  CREDITS: 'upp_airo_ai_Builder_credit',
} as const;

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
 * When higher plans flag is enabled: shows upgrade for all non-Ultimate users (Free→Starter→Professional→Ultimate)
 * When higher plans flag is disabled: shows upgrade only for Free/None users (legacy Starter upgrade flow)
 *
 * @param plan - Current subscription plan
 * @param isHigherPlansEnabled - Whether appbuilder-higher-plans flag is enabled
 * @returns True if user should see upgrade CTAs
 */
export function canUpgradePlan(
  plan: SubscriptionPlan | undefined | null,
  isHigherPlansEnabled: boolean
): boolean {
  if (plan == null) return true; // No plan = should show upgrade

  if (isHigherPlansEnabled) {
    // With higher plans: upgrade available for all non-Ultimate users
    return plan !== SubscriptionPlan.Ultimate;
  }

  // Legacy: only Free/None users can upgrade to Starter
  return plan === SubscriptionPlan.Free || plan === SubscriptionPlan.None;
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
 * Check if a project matches Airo Plus criteria
 *
 * @param node - Project node to check
 * @returns True if project grants Airo Plus access
 */
export function isMatchingProject(node: ProjectEdge['node']): boolean {
  const { PROJECT_MATCH_CRITERIA } = PAYWALL_CONFIG;

  return (
    node.group === PROJECT_MATCH_CRITERIA.GROUP &&
    node.status === PROJECT_MATCH_CRITERIA.STATUS &&
    node.billing?.plan === PROJECT_MATCH_CRITERIA.PLAN
  );
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
