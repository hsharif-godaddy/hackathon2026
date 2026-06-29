/**
 * Server-side enforcement: verify the app owner is on an active paid plan
 * before allowing collaborator invite operations (FGA writes, reconcile). This
 * is the backend complement to the client-side paywall banner in TeamPanel —
 * both check active status + paid plan, so that disabling the UX gate
 * (devtools, direct API call) still cannot bypass the paywall.
 */

import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { getMgmtAiroBaseUrl } from '@/lib/mgmt-airo/base-url';
import { isPaidPlanForGrants } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { getPlanFromSubscription } from '@/utils/credits';

export type OwnerPaidPlanDenialReason = 'no_subscription' | 'not_active' | 'free_tier' | 'fetch_failed';

export interface OwnerPaidPlanResult {
  allowed: boolean;
  reason?: OwnerPaidPlanDenialReason;
}

/**
 * Resolve whether the app owner's subscription is on an active paid plan that
 * allows collaborator management. Returns `{ allowed: true }` when the owner
 * has an active subscription on a paid plan (Starter/Professional/Ultimate).
 * Returns `{ allowed: false, reason }` otherwise — including on fetch errors
 * (fail-closed).
 *
 * Parity with the client-side `usePaywallEligibility`: both require
 * `status === 'active'` AND `isPaidPlanForGrants(plan)`.
 *
 * Callers should return 403 when `allowed` is false.
 */
export async function resolveOwnerPaidPlan(params: {
  jwt: string;
  subscriptionId: string | undefined;
  siteId: string;
}): Promise<OwnerPaidPlanResult> {
  const { jwt, subscriptionId, siteId } = params;

  if (!subscriptionId) {
    logger.warn('resolve-owner-paid-plan.no-subscription', { siteId });
    return { allowed: false, reason: 'no_subscription' };
  }

  try {
    const client: AiroMgmtClient = new AiroMgmtClient({ baseUrl: getMgmtAiroBaseUrl(), jwt });
    const subscription = await client.getSubscription(subscriptionId);

    if (subscription.status !== 'active') {
      logger.info('resolve-owner-paid-plan.not-active', {
        siteId,
        subscriptionId,
        status: subscription.status,
      });
      return { allowed: false, reason: 'not_active' };
    }

    const plan = getPlanFromSubscription(subscription);
    const isPaid: boolean = isPaidPlanForGrants(plan);

    if (!isPaid) {
      logger.info('resolve-owner-paid-plan.free-tier-blocked', {
        siteId,
        subscriptionId,
        plan: plan ?? 'unknown',
      });
      return { allowed: false, reason: 'free_tier' };
    }

    return { allowed: true };
  } catch (error: unknown) {
    logger.error('resolve-owner-paid-plan.fetch-failed', {
      siteId,
      subscriptionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: false, reason: 'fetch_failed' };
  }
}
