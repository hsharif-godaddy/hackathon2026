import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/credits/grants - Get credit grants for a subscription
 *
 * Returns the credit grants (monthly plan and credit packs) for a subscription.
 * Grants are ordered by `useBefore` date to determine which should be used first.
 *
 * Query Parameters:
 * - subscriptionId: The subscription ID to get grants for (required)
 * - syncSpend: Whether to sync spend data before returning (optional, default: true)
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

    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscriptionId');
    const syncSpend = searchParams.get('syncSpend') !== 'false';

    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId query parameter is required' }, { status: 400 });
    }

    logger.info('credits.grants.api.start', {
      message: 'Fetching credit grants via API route',
      subscriptionId,
      syncSpend,
    });

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    const grants = await client.getCreditGrants(subscriptionId, syncSpend);

    logger.info('credits.grants.api.success', {
      subscriptionId,
      grantCount: grants.length,
    });

    return NextResponse.json({
      success: true,
      data: grants,
    });

  } catch (error) {
    logger.error('credits.grants.api.error', {
      message: 'Failed to fetch credit grants',
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof AiroHttpError) {
      return NextResponse.json(
        { error: error.status === 404 ? 'No grants found' : 'Failed to fetch credit grants' },
        { status: error.status ?? 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch credit grants' },
      { status: 500 }
    );
  }
});
