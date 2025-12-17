import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * PUT /api/entitlements/[subscriptionId]/update - Update entitlement for a subscription
 *
 * Updates the entitlement for a specific subscription.
 *
 * Path Parameters:
 * - subscriptionId: The subscription ID to update (required)
 *
 * Request Body:
 * - entitlementId: The new entitlement ID (required)
 */
export const PUT = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: { params: { subscriptionId: string } }): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { subscriptionId } = params;
    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId path parameter is required' }, { status: 400 });
    }

    const { entitlementId, appId } = await request.json();
    if (!entitlementId) {
      return NextResponse.json({ error: 'entitlementId is required in request body' }, { status: 400 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('entitlements.api.update.start', {
      subscriptionId,
      entitlementId,
      ...(appId && { appId })
    });

    // Call updateEntitlement method
    const updatedSubscription = await client.updateEntitlement(subscriptionId, { entitlementId });

    // Validate subscription response
    if (!updatedSubscription || !updatedSubscription.id) {
      logger.warn('entitlements.api.update.failed', {
        subscriptionId,
        entitlementId,
        response: updatedSubscription
      });
      return NextResponse.json(
        { error: 'Failed to update entitlement', details: updatedSubscription },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Entitlement updated successfully',
      data: {
        subscription: updatedSubscription,
        subscriptionId: updatedSubscription.id,
        entitlementId: updatedSubscription.entitlementId
      }
    });

  } catch (error) {
    logger.error('entitlements.api.update.error', {
      message: 'Failed to update entitlement',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return NextResponse.json({ error: 'Failed to update entitlement' }, { status: 500 });
  }
});
