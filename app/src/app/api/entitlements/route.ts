
import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/entitlements - Get subscription with entitlements
 *
 * Returns the subscription object with entitlementId for a specific subscription.
 * This returns an AiroSubscription (with defined entitlementId) or 404s.
 *
 * Query Parameters:
 * - subscriptionId: The subscription ID to get subscription for (required)
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscriptionId');

    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId query parameter is required' }, { status: 400 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('entitlements.api.start', {
      message: 'Fetching entitlements via API route',
      subscriptionId
    });

    // Call getEntitlements method from mgmt-airo client
    const subscription = await client.getEntitlements(subscriptionId);

    logger.info('entitlements.api.success', {
      subscriptionId,
      entitlementId: subscription.entitlementId
    });

    return NextResponse.json({
      success: true,
      data: {
        subscription,
        subscriptionId: subscription.id
      }
    });

  } catch (error) {
    logger.error('entitlements.api.error', {
      message: 'Failed to fetch entitlements',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json({
      success: true,
      data: {}
    });
  }
});
