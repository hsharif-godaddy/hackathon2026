import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * Token budget response for the frontend
 */
export interface TokenBudgetResponse {
  percentage: number;
  spend: number;
  maxBudget: number;
  budgetDuration: string;
  resetTime: string | null;
}

/**
 * Calculate reset time based on budget duration
 * For "1d" (daily), reset is at 00:00 UTC next day
 */
function calculateResetTime(budgetDuration: string): string | null {
  if (budgetDuration === '1d') {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.toISOString();
  }
  return null;
}

interface RouteParams {
  params: Promise<{ subscriptionId: string }>;
}

/**
 * GET /api/token-budget/:subscriptionId - Get token budget for a subscription
 *
 * Returns the current spend and budget limits from mgmt-airo.
 * Calculates percentage for progress bar display.
 *
 * Route Parameters:
 * - subscriptionId: The subscription ID (required)
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext, { params }: RouteParams): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { subscriptionId } = await params;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    // Validate subscription ownership before fetching budget data
    // This provides defense-in-depth and prevents information leakage
    const subscriptions = await client.getSubscriptions();
    if (!subscriptions.some(sub => sub.id === subscriptionId)) {
      logger.warn('token-budget.api.unauthorized', {
        message: 'User attempted to access token budget for subscription they do not own',
        subscriptionId,
        customerId: authContext.user.customerId
      });
      // Return 404 to prevent subscription ID enumeration
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    logger.info('token-budget.api.start', {
      message: 'Fetching token budget via API route',
      subscriptionId
    });

    const budgetData = await client.getTokenBudget(subscriptionId);

    // Percentage is for progress bar display, clamped to 100% max.
    // Overspending is reflected by spend > maxBudget, not percentage > 100.
    const percentage = budgetData.budget.maxBudget > 0
      ? Math.min((budgetData.spend / budgetData.budget.maxBudget) * 100, 100)
      : 0;

    const response: TokenBudgetResponse = {
      percentage,
      spend: budgetData.spend,
      maxBudget: budgetData.budget.maxBudget,
      budgetDuration: budgetData.budget.budgetDuration,
      resetTime: calculateResetTime(budgetData.budget.budgetDuration)
    };

    logger.info('token-budget.api.success', {
      subscriptionId,
      percentage: response.percentage,
      spend: response.spend,
      maxBudget: response.maxBudget
    });

    return NextResponse.json(response);

  } catch (error) {
    if (error instanceof AiroHttpError) {
      if (error.status === 403) {
        logger.warn('token-budget.api.forbidden', {
          message: 'Access denied to token budget',
          error: error.message
        });
        return NextResponse.json(
          { error: 'Access denied to this subscription' },
          { status: 403 }
        );
      }
      if (error.status === 404) {
        return NextResponse.json(
          { error: 'Subscription not found' },
          { status: 404 }
        );
      }
    }

    logger.error('token-budget.api.error', {
      message: 'Failed to fetch token budget',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Failed to fetch token budget' },
      { status: 500 }
    );
  }
});
