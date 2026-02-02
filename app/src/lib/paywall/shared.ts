/**
 * Shared Paywall Configuration and Types
 *
 * This module contains shared constants, types, and helper functions
 * used by both client-side and server-side paywall implementations.
 */

import type { AiroSubscription } from '@/lib/mgmt-airo';
import { SubscriptionPlan } from '@/types/credits';
import { getPlanFromSubscription } from '@/utils/credits';

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
}

/**
 * Result of paywall eligibility check
 */
export interface PaywallCheckResult {
  /** Whether user has access to publish */
  hasAccess: boolean;
  /** Human-readable reason for denial (if applicable) */
  reason?: string;
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
 * Valid subscription plans configuration
 */
export const SUBSCRIPTION_PLAN_CONFIG = {
  /**
   * Valid plans when new paid plans feature is enabled (appbuilder-manage-plan flag)
   * Includes free, starter, and airoPlus plans
   */
  NEW_VALID_PLANS: [SubscriptionPlan.Free, SubscriptionPlan.Starter, SubscriptionPlan.AiroPlus] as const,

  /**
   * Valid plans when new paid plans feature is disabled (legacy behavior)
   * Only includes airoPlus plan
   */
  LEGACY_VALID_PLANS: [SubscriptionPlan.AiroPlus] as const,
} as const;

/**
 * Plan priority ranking for selecting the best subscription
 *
 * Higher numbers indicate higher priority plans. Used when a user has
 * multiple subscriptions to determine which one to use.
 *
 * Priority order: Starter > AiroPlus > Free > None
 */
export const PLAN_PRIORITY: Record<SubscriptionPlan, number> = {
  [SubscriptionPlan.Starter]: 4,
  [SubscriptionPlan.AiroPlus]: 3,
  [SubscriptionPlan.Free]: 2,
  [SubscriptionPlan.None]: 1,
};

/**
 * Check if a subscription has a valid builder plan
 *
 * Uses the explicit plan field if set, otherwise derives the plan from
 * productId/isTrial for legacy subscriptions.
 *
 * @param subscription - Subscription object with optional plan property
 * @param validPlans - Array of valid plans to check against
 * @returns True if subscription has a valid plan
 */
export function hasValidPlan(
  subscription: AiroSubscription,
  validPlans: readonly SubscriptionPlan[],
): boolean {
  const plan = subscription.plan ?? getPlanFromSubscription(subscription) ?? SubscriptionPlan.None;
  return (validPlans as readonly SubscriptionPlan[]).includes(plan);
}

/**
 * Get the appropriate valid plans based on feature flag state
 *
 * @param isManagePlanEnabled - Whether the appbuilder-manage-plan flag is enabled
 * @returns Array of valid subscription plans
 */
export function getValidPlans(isManagePlanEnabled: boolean): readonly SubscriptionPlan[] {
  return isManagePlanEnabled
    ? SUBSCRIPTION_PLAN_CONFIG.NEW_VALID_PLANS
    : SUBSCRIPTION_PLAN_CONFIG.LEGACY_VALID_PLANS;
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
