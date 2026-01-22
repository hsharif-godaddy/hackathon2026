import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import type { CreditGrant } from '@/types/credits';
import { GrantFinalState, GrantType } from '@/types/credits';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * Mock data matching the control plane API response
 * TODO: Replace with actual control plane call:
 * GET /airo/v1/subscriptions/:subscriptionId/credits/grants?syncSpend=true
 */
const MOCK_CREDIT_GRANTS: CreditGrant[] = [
  {
    id: 'f234f23f',
    subscriptionId: 'asdfasdf',
    type: GrantType.PlanMonthly,
    llmBudgetUserId: 'airo-builder:grant:f234f23f',
    llmBudgetId: 'e22054cd-70e4-4130-af62-ec23fa816003',
    creditsMax: 1500,
    creditsSpent: 1129,
    isAvailable: true,
    finalState: null,
    useBefore: '2026-02-09T00:00:00.000Z',
    consumedAt: null,
    createdAt: '2026-01-09T00:00:00.000Z',
    updatedAt: '2026-01-14T00:00:00.000000Z',
  },
  {
    id: 'g6k4f23t',
    subscriptionId: 'asdfasdf',
    type: GrantType.CreditPack,
    llmBudgetUserId: 'airo-builder:grant:g6k4f23t',
    llmBudgetId: '54cde220-af62-70e4-4130-6003ec23fa81',
    creditsMax: 2500,
    creditsSpent: 2500,
    isAvailable: false,
    finalState: GrantFinalState.Consumed,
    useBefore: '2026-02-01T00:00:00.000000Z',
    consumedAt: '2026-01-05T00:00:00.000000Z',
    createdAt: '2026-01-01T00:00:00.000000Z',
    updatedAt: '2026-01-05T00:00:00.000000Z',
  },
  {
    id: 'er7dfgku',
    subscriptionId: 'asdfasdf',
    type: GrantType.CreditPack,
    llmBudgetUserId: 'airo-builder:grant:er7dfgku',
    llmBudgetId: '4130e220-fa81-70e4-54cd-ec236003af62',
    creditsMax: 5000,
    creditsSpent: 3491,
    isAvailable: true,
    finalState: null,
    useBefore: '2026-02-05T00:00:00.000000Z',
    consumedAt: null,
    createdAt: '2026-01-05T00:00:00.000000Z',
    updatedAt: '2026-01-05T00:00:00.000000Z',
  },
]

/**
 * GET /api/credits/grants - Get credit grants for a subscription
 *
 * Returns the credit grants (monthly plan and credit packs) for a subscription.
 * Grants are ordered by `useBefore` date to determine which should be used first.
 *
 * Query Parameters:
 * - subscriptionId: The subscription ID to get grants for (required)
 * - syncSpend: Whether to sync spend data before returning (optional, default: true)
 *
 * TODO: Implement actual control plane call:
 * GET /airo/v1/subscriptions/:subscriptionId/credits/grants?syncSpend=true
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

    // TODO: Replace mock data with actual control plane call:
    // const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    // const response = await fetch(
    //   `${baseUrl}/airo/v1/subscriptions/${subscriptionId}/credits/grants?syncSpend=${syncSpend}`,
    //   {
    //     headers: {
    //       Authorization: `Bearer ${authContext.jwt}`,
    //       'Content-Type': 'application/json',
    //     },
    //   }
    // );
    // const grants = await response.json();

    // For now, return mock data
    const grants = MOCK_CREDIT_GRANTS.map(function updateSubscriptionId(grant) {
      return { ...grant, subscriptionId };
    });

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

    return NextResponse.json(
      { error: 'Failed to fetch credit grants' },
      { status: 500 }
    );
  }
});
