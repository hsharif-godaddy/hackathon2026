import { GrantManager } from '@airo/shared/grants'

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
const CREDIT_PACK_TYPES = new Set([GrantType.CreditPack, GrantType.StandaloneCreditPack])

export function getCreditPackGrants(grants: CreditGrant[]): CreditGrant[] {
  const now = new Date();

  return grants
    .filter(function filterPacks(grant) {
      return CREDIT_PACK_TYPES.has(grant.type);
    })
    .sort(function sortByExpiration(a, b) {
      const aExpired = !a.isAvailable || a.finalState != null || !!(a.useBefore && new Date(a.useBefore) <= now);
      const bExpired = !b.isAvailable || b.finalState != null || !!(b.useBefore && new Date(b.useBefore) <= now);

      // Non-expired grants come before expired grants
      if (aExpired !== bExpired) {
        return aExpired ? 1 : -1;
      }

      // Within same group, sort by useBefore (closest to expiration first)
      // Sort by useBefore (null = never expires, sort to end)
      if (!a.useBefore && !b.useBefore) return 0;
      if (!a.useBefore) return 1;
      if (!b.useBefore) return -1;
      const aTime = new Date(a.useBefore).getTime();
      const bTime = new Date(b.useBefore).getTime();
      if (isNaN(aTime) || isNaN(bTime)) return 0;
      return aTime - bTime;
    });
}

/**
 * Check if a grant is currently usable for LLM requests
 * Delegated to GrantManager for consistency with agent-side logic.
*/
export const isGrantUsable = GrantManager.isGrantUsable

/**
 * Get only active grants with remaining credits for UI display.
 * Used for calculating remaining credit percentages for gauge and warnings.
 *
 * Delegates to GrantManager.isGrantUsable() for consistency with agent-side logic.
 *
 * When NO grants remain with available credits, the gauge should show 100%
 * (everything is exhausted), not 0% (which would imply credits available).
 *
 * @param grants - Array of credit grants
 * @returns Array of active grants with remaining credits for display purposes
 */
export function getActiveGrants(grants: CreditGrant[]): CreditGrant[] {
  return grants.filter(GrantManager.isGrantUsable)
}

/**
 * Compute the total credits spent / max across all grants for user-facing display.
 *
 * This is the single source of truth for any UI that wants to show a user the
 * same "X / Y credits" totals — the gauge, the popover, feedback form, etc.
 * Using the same reducer everywhere guarantees the circular gauge percentage
 * stays in sync with the numbers the popover actually shows the user.
 *
 * Spent is capped per-grant via getEffectiveCreditsSpent so reported usage
 * never exceeds the grant max (billing can briefly report spent > max).
 */
export function getTotalCreditsFromGrants(
  grants: CreditGrant[] | undefined | null
): { totalCreditsSpent: number; totalCreditsMax: number } {
  const list = grants ?? []
  const totalCreditsSpent = list.reduce(
    (sum, g) => sum + getEffectiveCreditsSpent(g.creditsSpent, g.creditsMax),
    0
  )
  // `creditsMax ?? 0` is a display safety net — the actual warning about
  // malformed grants is emitted once per fetch in useCreditGrants' queryFn
  // so we don't log on every render of the gauge and popover.
  const totalCreditsMax = list.reduce((sum, g) => sum + (g.creditsMax ?? 0), 0)
  return { totalCreditsSpent, totalCreditsMax }
}

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
  subscription: Pick<AiroSubscription, 'plan' | 'productId' | 'isTrial' | 'hadAiroPlus'>
): SubscriptionPlan {
  // If plan field has a valid value, use it
  if (subscription?.plan) {
    return subscription.plan;
  }

  // Legacy product ID mapping (when plan is undefined, null, or empty).
  // hadAiroPlus is set by mgmt-airo only on subscriptions that were originally
  // Airo Plus before the new plans rollout. Subscriptions with a plan field
  // already set (e.g. Starter with builderEntitlementId) are handled by the
  // early return above and never reach this path.
  if (subscription?.productId === 'aab-v1' && subscription.hadAiroPlus) {
    return subscription.isTrial ? SubscriptionPlan.None : SubscriptionPlan.AiroPlus;
  }

  // Enterprise (`aab-ent-v1`) subscription with no `plan` field. Map to
  // Ultimate so plan-aware UI treats the ent customer as on the top tier:
  // - `isPaidPlanForGrants(Ultimate)` is true → no plan-tier paywall
  // - `canUpgradePlan(Ultimate)` is false → no Upgrade pill / banner
  // The enterprise-aware UI gates (`useEnterpriseManaged`, `useIsEnterpriseUser`)
  // still take precedence and replace upgrade CTAs with the admin-contact
  // notice; this mapping is just the safe fallback for surfaces that read
  // the plan directly. Activates only post-mhp-core#749 + the
  // AAB_ENT_V1-aware filter in /api/subscriptions, after which the ent sub
  // can appear in `active`.
  if (subscription?.productId === 'aab-ent-v1') {
    return SubscriptionPlan.Ultimate;
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
