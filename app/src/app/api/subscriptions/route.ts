import { NextRequest, NextResponse } from 'next/server';

import { createCorsOptionsHandler, withCorsHeaders } from '@/lib/cors';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AIRO_OWNER_PRODUCTS, AIRO_PRODUCT_IDS, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { SubscriptionStatus } from '@/types/credits';
import { getPlanFromSubscription } from '@/utils/credits';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// CORS preflight handler
export const OPTIONS = createCorsOptionsHandler();

/**
 * GET /api/subscriptions - Get all subscriptions with best subscription selection
 *
 * Returns all subscriptions for the authenticated user with derived plan fields,
 * plus the aab-v1 subscription (preferring active over suspended status).
 *
 * Response format:
 * {
 *   success: true,
 *   data: {
 *     subscriptions: [...],  // All subscriptions with plan field
 *     active: {...},         // Best/active subscription
 *     meta: {
 *       grantsEnabled: boolean
 *     }
 *   }
 * }
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  const origin = request.headers.get('origin');

  try {
    // JWT required
    if (!authContext.jwt) {
      return withCorsHeaders(NextResponse.json({ error: 'Authentication token required' }, { status: 401 }), origin);
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('subscriptions.api.start', {
      message: 'Fetching all subscriptions with best selection',
      customerId: authContext.user.customerId,
    });

    // Fetch grants flag and subscriptions in parallel (independent lookups)
    const [isGrantsEnabled, subscriptions] = await Promise.all([
      checkSwitchboardFlag('app-builder-grants', authContext.jwt, request.headers),
      client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER),
    ]);

    logger.info('subscriptions.api.fetched', {
      count: subscriptions.length,
      customerId: authContext.user.customerId
    });

    // Add derived plan field to each subscription
    const subscriptionsWithPlan = subscriptions.map(sub => ({
      ...sub,
      plan: getPlanFromSubscription(sub)
    }));

    // Find the aab-v1 subscription, preferring active over suspended
    const aabSubscriptions = subscriptionsWithPlan.filter(
      sub => sub.productId === AIRO_PRODUCT_IDS.AAB_V1
    );

    // Prefer active, then suspended, then any other status
    const bestSubscription =
      aabSubscriptions.find(sub => sub.status === SubscriptionStatus.Active) ||
      aabSubscriptions.find(sub => sub.status === SubscriptionStatus.Suspended) ||
      aabSubscriptions[0] ||
      null;

    logger.info('subscriptions.api.success', {
      count: subscriptionsWithPlan.length,
      bestPlan: bestSubscription?.plan,
      grantsEnabled: isGrantsEnabled,
      customerId: authContext.user.customerId
    });

    return withCorsHeaders(NextResponse.json({
      success: true,
      data: {
        subscriptions: subscriptionsWithPlan,
        active: bestSubscription,
        meta: {
          grantsEnabled: isGrantsEnabled
        }
      }
    }), origin);

  } catch (error) {
    // Auth failures (401/403) are expected for unregistered/expired users — log at warn, not error
    const isAuthError = error instanceof AiroHttpError && (error.status === 401 || error.status === 403);
    logger[isAuthError ? 'warn' : 'error']('subscriptions.api.error', {
      message: 'Failed to fetch subscriptions',
      customerId: authContext.user.customerId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    if (error instanceof AiroHttpError) {
      return withCorsHeaders(NextResponse.json(
        { error: error.status === 404 ? 'No subscriptions found' : 'Failed to fetch subscriptions' },
        { status: error.status ?? 500 }
      ), origin);
    }

    return withCorsHeaders(NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    ), origin);
  }
});
