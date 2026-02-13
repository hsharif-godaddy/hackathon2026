import { GrantManager } from '@airo/ai-lib/grants/client'

import type { AiroSubscription } from '@/lib/mgmt-airo';
import type { CreditGrant } from '@/types/credits';
import { GrantType, SubscriptionPlan } from '@/types/credits';

/**
 * Get the effective credits spent, capped at creditsMax.
 *
 * This utility exists because the billing system can report creditsSpent > creditsMax
 * due to latency in usage tracking. For display purposes, we cap the spent value
 * to prevent showing confusing states like "1600/1500 credits used".
 *
 * @param creditsSpent - The raw credits spent value from the API
 * @param creditsMax - The maximum credits allowed for the grant
 * @returns The capped credits spent value:
 *   - Returns Math.min(spent, max) for normal cases
 *   - Returns 0 if creditsMax is null/undefined (invalid grant data)
 *   - Returns 0 if both values are null/undefined
 */
export function getEffectiveCreditsSpent(
  creditsSpent: number | null | undefined,
  creditsMax: number | null | undefined
): number {
  if (creditsSpent == null && creditsMax == null) {
    return 0;
  }
  const spent = creditsSpent ?? 0;
  const max = creditsMax ?? 0;
  return Math.min(spent, max);
}

/**
 * Get the monthly plan grant from the grants list
 */
export function getMonthlyPlanGrant(grants: CreditGrant[]): CreditGrant | undefined {
  return grants.find(function findMonthly(grant) {
    return grant.type === GrantType.PlanMonthly;
  });
}

/**
 * Get credit pack grants sorted by useBefore (closest to expiration first)
 * Expired grants are sorted after non-expired grants
 */
export function getCreditPackGrants(grants: CreditGrant[]): CreditGrant[] {
  const now = new Date();

  return grants
    .filter(function filterPacks(grant) {
      return grant.type === GrantType.CreditPack;
    })
    .sort(function sortByExpiration(a, b) {
      const aExpired = !a.isAvailable || a.finalState !== null || new Date(a.useBefore) <= now;
      const bExpired = !b.isAvailable || b.finalState !== null || new Date(b.useBefore) <= now;

      // Non-expired grants come before expired grants
      if (aExpired !== bExpired) {
        return aExpired ? 1 : -1;
      }

      // Within same group, sort by useBefore (closest to expiration first)
      return new Date(a.useBefore).getTime() - new Date(b.useBefore).getTime();
    });
}

/**
 * Check if a grant is currently usable for LLM requests
 * Delegated to GrantManager for consistency with agent-side logic.
*/
export const isGrantUsable = GrantManager.isGrantUsable

/**
 * Get the currently active grant (the one being used)
 * Returns the available grant with the soonest expiration date (useBefore)
 * Excludes expired, consumed, or unavailable grants
 * Returns undefined if no available grants (e.g., free plan with no credit packs)
 *
 * Delegated to GrantManager for consistency with agent-side logic.
 */
export function getActiveGrant(grants: CreditGrant[]): CreditGrant | undefined {
  return GrantManager.selectBestGrant(grants) ?? undefined
}

/**
 * Format a credit date string for display using specified locale
 */
export function formatCreditDate(dateString: string, locale?: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Calculate the current billing period based on the anchor day from createdAt
 * The billing period starts on the same day of each month as the original createdAt
 *
 * @param createdAt - The original grant creation date (used as anchor day)
 * @returns Object with periodStart and periodEnd dates
 */
export function getBillingPeriod(createdAt: string): { periodStart: Date; periodEnd: Date } {
  const anchorDate = new Date(createdAt);
  const anchorDay = anchorDate.getDate();
  const now = new Date();

  // Start with current month's anchor day
  const currentMonthAnchor = new Date(now.getFullYear(), now.getMonth(), anchorDay);

  let periodStart: Date;
  let periodEnd: Date;

  if (now >= currentMonthAnchor) {
    // We're past the anchor day this month, so current period started this month
    periodStart = currentMonthAnchor;
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, anchorDay);
  } else {
    // We're before the anchor day, so current period started last month
    periodStart = new Date(now.getFullYear(), now.getMonth() - 1, anchorDay);
    periodEnd = currentMonthAnchor;
  }

  return { periodStart, periodEnd };
}

/**
 * Format a date string with full month name using specified locale
 */
export function formatFullCreditDate(dateString: string, locale?: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Determine subscription plan from subscription data
 * Handles both new plan field and legacy productId mapping
 */
export function getPlanFromSubscription(
  subscription: Pick<AiroSubscription, 'plan' | 'productId' | 'builderEntitlementId' | 'isTrial' | 'entitlementId'>
): SubscriptionPlan {
  // If plan field has a valid value, use it
  if (subscription?.plan) {
    return subscription.plan;
  }

  // Legacy product ID mapping (when plan is undefined, null, or empty)
  if (subscription?.productId === 'aab-v1' && !subscription.builderEntitlementId && subscription.entitlementId) {
    // Non-trial users: return AiroPlus (legacy paid users)
    return subscription.isTrial ? SubscriptionPlan.None : SubscriptionPlan.AiroPlus;
  }

  return SubscriptionPlan.None;
}

/**
 * Get translation key for subscription plan display label
 */
export function getPlanDisplayLabelKey(plan: SubscriptionPlan): string {
  switch (plan) {
    case SubscriptionPlan.AiroPlus:
      return 'builder_manageplan_plan_airo_plus';
    case SubscriptionPlan.Starter:
      return 'builder_manageplan_plan_starter';
    case SubscriptionPlan.Professional:
      return 'builder_manageplan_plan_professional';
    case SubscriptionPlan.Ultimate:
      return 'builder_manageplan_plan_ultimate';
    case SubscriptionPlan.Free:
      return 'builder_manageplan_plan_free';
    case SubscriptionPlan.None:
    default:
      return '';
  }
}
