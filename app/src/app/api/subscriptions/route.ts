import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AIRO_OWNER_PRODUCTS, AiroHttpError, AiroMgmtClient, type AiroSubscription } from '@/lib/mgmt-airo';
import { getValidPlans, hasValidPlan, PLAN_PRIORITY } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { SubscriptionPlan, SubscriptionStatus } from '@/types/credits';
import { getPlanFromSubscription } from '@/utils/credits';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/subscriptions - Get all subscriptions with best subscription selection
 *
 * Returns all subscriptions for the authenticated user with derived plan fields,
 * plus the "best" subscription based on plan priority (Starter > AiroPlus > Free > None).
 *
 * Response format:
 * {
 *   success: true,
 *   data: {
 *     subscriptions: [...],  // All subscriptions with plan field
 *     active: {...},         // Best/active subscription
 *     meta: {
 *       hasValidPlan: boolean,
 *       grantsEnabled: boolean
 *     }
 *   }
 * }
 *
 * When app-builder-grants flag is enabled:
 * - Checks for free/starter/airoPlus plans
 * - Auto-creates free plan if subscription exists but has no valid plan
 *
 * When app-builder-grants flag is disabled (legacy):
 * - Only checks for airoPlus plans
 * - Does not auto-create plans
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    // Check if grants feature is enabled
    const isGrantsEnabled = await checkSwitchboardFlag(
      'app-builder-grants',
      authContext.jwt,
      request.headers
    );

    logger.info('subscriptions.api.start', {
      message: 'Fetching all subscriptions with best selection',
      customerId: authContext.user.customerId,
      grantsEnabled: isGrantsEnabled
    });

    // Get all customer's subscriptions
    let subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);

    logger.info('subscriptions.api.fetched', {
      count: subscriptions.length,
      customerId: authContext.user.customerId
    });

    // Use appropriate plan validation based on feature flag
    const validPlans = getValidPlans(isGrantsEnabled);
    const anyHasValidPlan = subscriptions.some(sub => hasValidPlan(sub, validPlans));

    // Only auto-create free plan if grants feature is enabled
    if (isGrantsEnabled && subscriptions.length > 0 && !anyHasValidPlan) {
      // Use the first active subscription, or fall back to first subscription
      const targetSubscription = subscriptions.find(sub => sub.status === SubscriptionStatus.Active) || subscriptions[0];

      logger.info('subscriptions.api.creating-free-plan', {
        subscriptionId: targetSubscription.id,
        customerId: authContext.user.customerId,
        message: 'No valid builder plan found, creating free plan'
      });

      try {
        // Idempotency check: verify plan still doesn't exist before creating
        // Handles race condition if another request already created the plan
        // Force fresh data by bypassing cache
        const recheckSubscription = await client.getSubscription(targetSubscription.id, { noCache: true });
        const recheckHasValidPlan = hasValidPlan(recheckSubscription, validPlans);

        if (!recheckHasValidPlan) {
          try {
            await client.createBuilderPlan(targetSubscription.id, { plan: SubscriptionPlan.Free });

            logger.info('subscriptions.api.free-plan-created', {
              subscriptionId: targetSubscription.id,
              customerId: authContext.user.customerId
            });
          } catch (createError) {
            // Handle 409 Conflict - plan was created by another request (race condition)
            if (createError instanceof AiroHttpError && createError.status === 409) {
              logger.info('subscriptions.api.plan-exists-race-condition', {
                subscriptionId: targetSubscription.id,
                customerId: authContext.user.customerId,
                message: 'Plan was created concurrently by another request'
              });
              // Treat as success - the plan exists, which is what we wanted
            } else {
              // Re-throw other errors
              throw createError;
            }
          }
        }

        // Refetch subscriptions to get updated data with the new plan
        subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);
      } catch (planError) {
        logger.error('subscriptions.api.create-plan-error', {
          subscriptionId: targetSubscription.id,
          customerId: authContext.user.customerId,
          error: planError instanceof Error ? planError.message : 'Unknown error',
          errorType: planError instanceof AiroHttpError ? `HTTP ${planError.status}` : 'Unknown'
        });

        // Always refetch to get current state, even on error
        try {
          subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);
        } catch (refetchError) {
          logger.error('subscriptions.api.refetch-error', {
            customerId: authContext.user.customerId,
            error: refetchError instanceof Error ? refetchError.message : 'Unknown error'
          });
        }
      }
    }

    // Add derived plan field to each subscription
    const subscriptionsWithPlan = subscriptions.map(sub => ({
      ...sub,
      plan: getPlanFromSubscription(sub)
    }));

    // Determine the "best" subscription based on plan priority
    // Order: Starter > AiroPlus > Free > None
    // AiroPlus is legacy but maintains paid access during transition
    let bestSubscription: (AiroSubscription & { plan: SubscriptionPlan }) | null = null;

    for (const subscription of subscriptionsWithPlan) {
      // Prioritize active subscriptions
      if (subscription.status !== SubscriptionStatus.Active && bestSubscription?.status === SubscriptionStatus.Active) {
        continue;
      }

      const plan = subscription.plan;

      // Keep the subscription with the highest priority plan
      if (!bestSubscription ||
          (PLAN_PRIORITY[plan] || 0) > (PLAN_PRIORITY[bestSubscription.plan] || 0)) {
        bestSubscription = subscription;
      }
    }

    // If no best subscription found, use the first active or first overall
    if (!bestSubscription && subscriptionsWithPlan.length > 0) {
      bestSubscription = subscriptionsWithPlan.find(sub => sub.status === SubscriptionStatus.Active) || subscriptionsWithPlan[0];
    }

    const anyWithValidPlan = subscriptionsWithPlan.some(sub => hasValidPlan(sub, validPlans));

    logger.info('subscriptions.api.success', {
      count: subscriptionsWithPlan.length,
      hasValidPlan: anyWithValidPlan,
      bestPlan: bestSubscription?.plan,
      grantsEnabled: isGrantsEnabled,
      customerId: authContext.user.customerId
    });

    return NextResponse.json({
      success: true,
      data: {
        subscriptions: subscriptionsWithPlan,
        active: bestSubscription,
        meta: {
          hasValidPlan: anyWithValidPlan,
          grantsEnabled: isGrantsEnabled
        }
      }
    });

  } catch (error) {
    logger.error('subscriptions.api.error', {
      message: 'Failed to fetch subscriptions',
      customerId: authContext.user.customerId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    if (error instanceof AiroHttpError) {
      return NextResponse.json(
        { error: error.status === 404 ? 'No subscriptions found' : 'Failed to fetch subscriptions' },
        { status: error.status ?? 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    );
  }
});
