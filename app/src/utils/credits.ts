import type { CreditGrant } from '@/types/credits';
import { GrantType, SubscriptionPlan } from '@/types/credits';

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
 * Get the currently active grant (the one being used)
 * Returns the available grant with the soonest expiration date (useBefore)
 * Excludes expired, consumed, or unavailable grants
 * Returns undefined if no available grants (e.g., free plan with no credit packs)
 */
export function getActiveGrant(grants: CreditGrant[]): CreditGrant | undefined {
  const now = new Date();

  const availableGrants = grants
    .filter(function filterAvailable(grant) {
      // Must be available and not in a final state
      if (!grant.isAvailable || grant.finalState !== null) {
        return false;
      }
      // Must not be expired (useBefore must be in the future)
      return new Date(grant.useBefore) > now;
    })
    .sort(function sortByExpiration(a, b) {
      return new Date(a.useBefore).getTime() - new Date(b.useBefore).getTime();
    });

  // Return undefined if no available grants found
  if (availableGrants.length === 0) {
    return undefined;
  }

  return availableGrants[0];
}

/**
 * Format a credit date string for display using specified locale
 */
export function formatCreditDate(dateString: string, locale?: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
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
 * Get translation key for credit pack name based on credits max
 */
export function getPackName(creditsMax: number): string {
  if (creditsMax <= 2500) return 'builder_manageplan_pack_small';
  if (creditsMax <= 5000) return 'builder_manageplan_pack_medium';
  return 'builder_manageplan_pack_large';
}

/**
 * Determine subscription plan from subscription data
 * Handles both new plan field and legacy productId mapping
 */
export function getPlanFromSubscription(subscription: {
  plan?: SubscriptionPlan;
  productId?: string;
  isTrial?: boolean;
}): SubscriptionPlan {
  if (subscription.plan) {
    return subscription.plan;
  }

  // Legacy product ID mapping
  if (subscription.productId === 'aab-v1') {
    return subscription.isTrial ? SubscriptionPlan.Free : SubscriptionPlan.AiroPlus;
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
    case SubscriptionPlan.Free:
      return 'builder_manageplan_plan_free';
    case SubscriptionPlan.None:
    default:
      return '';
  }
}
