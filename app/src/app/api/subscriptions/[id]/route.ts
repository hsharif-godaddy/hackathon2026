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
    // The attributes read drives the conversion-event fire decision (free-plan
    // orderId / conversionEventDate). Bypass cache so client polling observes a
    // freshly provisioned attribute instead of a stale subscription.
    const subscription = await client.getSubscription(subscriptionId, {
      includeAttributes,
      ...(includeAttributes ? { noCache: true } : {}),
    });

    // Verify subscription belongs to the authenticated customer.
    //
    // Enterprise carve-out: for ent subscriptions (productId === 'aab-ent-v1'),
    // the subscription's `customerId` is the ENTERPRISE customer, not the
    // member's personal customerId. Comparing them would always 403 for ent
    // members. airo-go's `SubscriptionReadAuthorization` already enforces an
    // `entMode` bypass server-side (mhp-core entity_owner.go:277-280) and
    // would not return the subscription if the caller weren't authorized to
    // read it — so this BFF re-check is redundant for ent subs and is the
    // only thing producing the 403.
    //
    // The check is preserved for non-ent (`aab-v1`) subs as defence in depth.
    const isEnterpriseSubscription: boolean =
      subscription.productId === 'aab-ent-v1' ||
      subscription.ownerProduct === 'aab-ent-v1';
    if (!isEnterpriseSubscription && subscription.customerId !== authContext.user.customerId) {
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
