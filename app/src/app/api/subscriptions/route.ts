import { NextRequest, NextResponse } from 'next/server';

import { CORS_ROUTES, createCorsOptionsHandler } from '@/lib/cors';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AIRO_OWNER_PRODUCTS, AIRO_PRODUCT_IDS, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { SubscriptionStatus } from '@/types/credits';
import { getPlanFromSubscription } from '@/utils/credits';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// CORS preflight handler
export const OPTIONS = createCorsOptionsHandler(CORS_ROUTES.GET_SUBSCRIPTIONS);

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
 *   }
 * }
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

    logger.info('subscriptions.api.start', {
      message: 'Fetching all subscriptions with best selection',
      customerId: authContext.user.customerId,
    });

    const subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);

    logger.info('subscriptions.api.fetched', {
      count: subscriptions.length,
      customerId: authContext.user.customerId
    });

    // Add derived plan field to each subscription
    const subscriptionsWithPlan = subscriptions.map(sub => ({
      ...sub,
      plan: getPlanFromSubscription(sub)
    }));

    // Find AAB subscriptions, preferring active over suspended. Accept both
    // the self-serve `aab-v1` productId and the enterprise `aab-ent-v1`
    // productId so enterprise members get a non-null `active` once
    // mhp-core#749 (airo-go SubscriptionHandler.List entMode override)
    // surfaces their enterprise sub. Until that ships, only `aab-v1` is
    // ever returned for ent members (their personal sub) and the existing
    // selection logic is unchanged; once #749 deploys, the ent sub appears
    // in `subscriptions` and is preferred below if active.
    const aabSubscriptions = subscriptionsWithPlan.filter(
      sub => sub.productId === AIRO_PRODUCT_IDS.AAB_V1 ||
             sub.productId === AIRO_PRODUCT_IDS.AAB_ENT_V1
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
      customerId: authContext.user.customerId
    });

    return NextResponse.json({
      success: true,
      data: { subscriptions: subscriptionsWithPlan, active: bestSubscription },
    });

  } catch (error) {
    // mgmt-airo returns 403 for unregistered customers ("Customer not registered
    // with Airo") and 404 when a subscription doesn't exist yet (e.g. first app
    // creation while provisioning). Both are treated as empty subscriptions.
    // During the 403→404 migration we must support both. See PR #2665.
    // TODO: Remove 403 once the 403 -> 404 migration is complete.
    if (error instanceof AiroHttpError && (error.status === 403 || error.status === 404)) {
      logger.info('subscriptions.api.not-registered', {
        message: 'Customer not registered or subscription not found - returning empty subscriptions',
        customerId: authContext.user.customerId,
        errorMessage: error.message,
        statusCode: error.status,
      });
      return NextResponse.json({ success: true, data: { subscriptions: [], active: null } });
    }

    const isAuthError = error instanceof AiroHttpError && error.status === 401;
    logger[isAuthError ? 'warn' : 'error']('subscriptions.api.error', {
      message: 'Failed to fetch subscriptions',
      customerId: authContext.user.customerId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof AiroHttpError) {
      return NextResponse.json(
        { error: 'Failed to fetch subscriptions' },
        { status: error.status ?? 500 }
      );
    }

    return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 });
  }
}, { addCorsHeaders: true, corsRoute: CORS_ROUTES.GET_SUBSCRIPTIONS });
