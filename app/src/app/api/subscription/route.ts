import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AIRO_OWNER_PRODUCTS, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { SubscriptionPlan } from '@/types/credits';
import { getPlanFromSubscription } from '@/utils/credits';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/subscription - Get account-level subscription data
 *
 * Returns the subscription information for the authenticated customer.
 * This is app-agnostic and returns the subscription that applies to all apps.
 *
 * Response includes:
 * - plan: none|airoPlus|free|starter
 * - builderEntitlementId: Airo Builder entitlement ID
 * - renewsAt: Renewal date when builderEntitlementId exists
 */
export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('subscription.account.api.start', {
      message: 'Fetching account subscription data',
      customerId: authContext.user.customerId
    });

    // Get all subscriptions for the customer
    const subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);

    // For account-level subscription, we'll prioritize active paid subscriptions
    // Order of precedence: airoPlus > starter > free > none
    let bestSubscription = null;
    const planPriority: Record<SubscriptionPlan, number> = {
      [SubscriptionPlan.AiroPlus]: 4,
      [SubscriptionPlan.Starter]: 3,
      [SubscriptionPlan.Free]: 2,
      [SubscriptionPlan.None]: 1
    };

    for (const subscription of subscriptions) {
      // Skip inactive subscriptions unless we have nothing else
      if (subscription.status !== 'active' && bestSubscription) {
        continue;
      }

      // Determine plan from subscription data
      const plan = getPlanFromSubscription(subscription);

      // Keep the subscription with the highest priority plan
      if (!bestSubscription ||
          (planPriority[plan] || 0) > (planPriority[bestSubscription.plan] || 0)) {
        bestSubscription = {
          ...subscription,
          plan
        };
      }
    }

    if (!bestSubscription) {
      // No subscription found - return a default free plan
      logger.info('subscription.account.api.no-subscription', {
        customerId: authContext.user.customerId
      });

      return NextResponse.json({
        success: true,
        data: {
          subscription: {
            plan: SubscriptionPlan.Free,
            status: 'active',
            isTrial: false,
            customerId: authContext.user.customerId
          }
        }
      });
    }

    logger.info('subscription.account.api.found', {
      customerId: authContext.user.customerId,
      subscriptionId: bestSubscription.id,
      plan: bestSubscription.plan
    });

    // Fetch the full subscription details via entitlements endpoint
    try {
      const fullSubscription = await client.getEntitlements(bestSubscription.id);

      return NextResponse.json({
        success: true,
        data: {
          subscription: {
            id: fullSubscription.id,
            productId: fullSubscription.productId,
            customerId: fullSubscription.customerId,
            status: fullSubscription.status,
            isTrial: fullSubscription.isTrial,
            entitlementId: fullSubscription.entitlementId, // Airo Plus entitlement
            builderEntitlementId: fullSubscription.builderEntitlementId, // Airo Builder entitlement
            plan: fullSubscription.plan || bestSubscription.plan,
            renewsAt: fullSubscription.renewsAt,
            createdAt: fullSubscription.createdAt,
            updatedAt: fullSubscription.updatedAt
          }
        }
      });
    } catch (detailError) {
      // If we can't fetch full details, return what we have
      logger.warn('subscription.account.api.detail-error', {
        subscriptionId: bestSubscription.id,
        error: detailError instanceof Error ? detailError.message : 'Unknown error'
      });

      return NextResponse.json({
        success: true,
        data: {
          subscription: bestSubscription
        }
      });
    }

  } catch (error) {
    logger.error('subscription.account.api.error', {
      message: 'Failed to fetch account subscription data',
      customerId: authContext.user.customerId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Failed to fetch subscription data' },
      { status: 500 }
    );
  }
});