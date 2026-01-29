/**
 * Subscription Export Status API
 *
 * Checks refund eligibility status for the customer's subscription.
 * Automatically looks up the subscription internally.
 *
 * GET /api/subscription/exports/status
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AIRO_OWNER_PRODUCTS, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/subscription/exports/status
 *
 * Returns the export status for the customer's subscription, including refund eligibility.
 * Automatically looks up the subscription internally (no subscriptionId param needed).
 *
 * Response: {
 *   eligibleForRefund: boolean,
 *   lastExportedAt: string | null,
 *   totalExports: number
 * }
 */
export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json(
        { error: 'Authentication token required' },
        { status: 401 }
      );
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    logger.info('subscription.exports.status.start', {
      customerId: authContext.user.customerId
    });

    // Get customer's subscription (same pattern as /api/subscription)
    const subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);

    // Find an active subscription
    const activeSubscription = subscriptions.find(sub => sub.status === 'active');

    if (!activeSubscription) {
      return NextResponse.json({
        eligibleForRefund: false,
        lastExportedAt: null,
        totalExports: 0,
        message: 'No active subscription found'
      });
    }

    // Fetch exports status for this subscription
    const status = await client.getExportsStatus(activeSubscription.id);

    logger.info('subscription.exports.status.success', {
      customerId: authContext.user.customerId,
      subscriptionId: activeSubscription.id,
      eligibleForRefund: status.eligibleForRefund,
      totalExports: status.totalExports
    });

    return NextResponse.json(status);

  } catch (error) {
    logger.error('subscription.exports.status.error', {
      customerId: authContext.user.customerId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Failed to fetch export status' },
      { status: 500 }
    );
  }
});
