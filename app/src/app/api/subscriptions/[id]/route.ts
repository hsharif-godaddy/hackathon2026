import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { getPlanFromSubscription } from '@/utils/credits';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/subscriptions/:id - Get a single subscription by ID
 *
 * Returns subscription data for a specific subscription ID.
 * Includes a derived `plan` field for consistency with /api/subscriptions endpoint.
 *
 * @param id - Subscription ID
 * @returns Subscription data with derived plan field
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { id: subscriptionId } = await params;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'Subscription ID is required' }, { status: 400 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('subscription.api.get-by-id.start', {
      subscriptionId,
      customerId: authContext.user.customerId
    });

    const includeAttributes = request.nextUrl.searchParams.get('include') === 'attributes';
    const subscription = await client.getSubscription(subscriptionId, { includeAttributes });

    // Verify subscription belongs to the authenticated customer
    if (subscription.customerId !== authContext.user.customerId) {
      logger.warn('subscription.api.get-by-id.forbidden', {
        subscriptionId,
        subscriptionCustomerId: subscription.customerId,
        requestCustomerId: authContext.user.customerId,
        message: 'Subscription does not belong to customer'
      });
      return NextResponse.json(
        { error: 'Forbidden: Subscription does not belong to your account' },
        { status: 403 }
      );
    }

    // Add derived plan field for consistency
    const subscriptionWithPlan = {
      ...subscription,
      plan: getPlanFromSubscription(subscription)
    };

    logger.info('subscription.api.get-by-id.success', {
      subscriptionId,
      plan: subscriptionWithPlan.plan,
      customerId: authContext.user.customerId
    });

    return NextResponse.json({
      success: true,
      data: subscriptionWithPlan
    });

  } catch (error) {
    logger.error('subscription.api.get-by-id.error', {
      message: 'Failed to fetch subscription by ID',
      error: error instanceof Error ? error.message : 'Unknown error',
      customerId: authContext.user.customerId
    });

    if (error instanceof AiroHttpError) {
      return NextResponse.json(
        { error: error.status === 404 ? 'Subscription not found' : 'Failed to fetch subscription' },
        { status: error.status ?? 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch subscription' },
      { status: 500 }
    );
  }
});
