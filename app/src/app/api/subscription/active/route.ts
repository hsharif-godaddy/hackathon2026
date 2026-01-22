import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AIRO_OWNER_PRODUCTS,AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/subscription/active - Get all subscriptions for the user
 *
 * Returns all subscriptions for the authenticated user.
 * This is useful for pages that need subscription info without an app context.
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

    logger.info('subscriptions.api.start', {
      message: 'Fetching all subscriptions via API route'
    });

    // Get all subscriptions
    const subscriptions = await client.getSubscriptions(AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER);

    logger.info('subscriptions.api.success', {
      count: subscriptions.length
    });

    return NextResponse.json({
      success: true,
      data: subscriptions
    });

  } catch (error) {
    logger.error('subscriptions.api.error', {
      message: 'Failed to fetch subscriptions',
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
