import { NextRequest, NextResponse } from 'next/server';
import type { BudgetItem, BudgetResponse } from '@airo/shared/budget';
import {
  BudgetServiceAuthError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
} from '@airo/shared/budget';

import { getBudgetServiceClient } from '@/lib/budget-service/client';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { type AiroCreditGrant, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/credits/status - Get credit status from Budget Service
 *
 * Parallel to /api/credits/grants (legacy mgmt-airo path).
 * When budget-service flag ON, frontend calls this instead.
 *
 * Fetches BMS budget data and joins with mgmt-airo grants to add
 * type labels and numeric credit amounts for frontend consumption.
 *
 * Query Parameters:
 * - subscriptionId: The subscription ID (required, also used as budgetId)
 */
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscriptionId');

    if (!subscriptionId?.trim()) {
      return NextResponse.json({ error: 'subscriptionId query parameter is required' }, { status: 400 });
    }

    logger.info('credits.status.api.start', { subscriptionId });

    // Validate subscription ownership via singular getSubscription.
    // mgmt-airo scopes by user JWT and returns 404 if not owned.
    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const mgmtClient = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    try {
      await mgmtClient.getSubscription(subscriptionId);
    } catch (err) {
      if (err instanceof AiroHttpError && err.status === 404) {
        logger.warn('credits.status.api.ownershipCheckFailed', {
          subscriptionId,
          customerId: authContext.user.customerId,
        });
        return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
      }
      logger.error('credits.status.api.error', {
        message: 'Failed to verify subscription ownership',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return NextResponse.json({ error: 'Failed to verify subscription' }, { status: 502 });
    }

    const budgetClient = getBudgetServiceClient();
    if (!budgetClient) {
      return NextResponse.json({ error: 'Budget service unavailable' }, { status: 503 });
    }

    // Parallel-fetch: grants (for type labels) + budget (for credit amounts).
    // subscriptionId === budgetId (1:1 mapping).
    // Grants are enrichment only; if getCreditGrants fails, continue with
    // empty grants (items get type: null). Budget data still returns.
    const [grants, budget] = await Promise.all([
      mgmtClient.getCreditGrants(subscriptionId, false).catch((err: unknown) => {
        logger.error('credits.status.api.grantsFetchFailed', {
          subscriptionId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        return [] as AiroCreditGrant[];
      }),
      budgetClient.getBudget(subscriptionId),
    ]);

    const enriched = enrichBudgetResponse(budget, grants);

    logger.info('credits.status.api.success', {
      subscriptionId,
      creditsTotal: budget.creditsTotal,
      creditsUsed: budget.creditsUsed,
      itemCount: budget.items.length,
      grantCount: grants.length,
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    if (error instanceof BudgetServiceAuthError) {
      logger.error('credits.status.api.bmsAuthFailed', {
        message: 'Budget Service S2S auth failed',
        statusCode: error.statusCode,
      });
      return NextResponse.json({ error: 'Budget service auth failed' }, { status: 502 });
    }

    if (error instanceof BudgetServiceTimeoutError) {
      logger.error('credits.status.api.error', {
        message: 'Budget Service timeout',
        error: error.message,
      });
      return NextResponse.json({ error: 'Budget service timeout' }, { status: 502 });
    }

    if (error instanceof BudgetServiceUnavailableError) {
      logger.error('credits.status.api.error', {
        message: 'Budget Service unreachable',
        error: error.message,
      });
      return NextResponse.json({ error: 'Budget service unavailable' }, { status: 502 });
    }

    if (error instanceof BudgetServiceError) {
      if (error.statusCode === 404) {
        return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
      }
      logger.error('credits.status.api.error', {
        message: 'Failed to fetch credit status',
        statusCode: error.statusCode,
        error: error.message,
      });
      return NextResponse.json({ error: 'Failed to fetch credit status' }, { status: 502 });
    }

    logger.error('credits.status.api.error', {
      message: 'Failed to fetch credit status',
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json({ error: 'Failed to fetch credit status' }, { status: 500 });
  }
});

// ── Response enrichment ──

function toNumeric(decimalString: string): number {
  const n = parseFloat(decimalString);
  return Number.isFinite(n) ? n : 0;
}

function enrichBudgetResponse(budget: BudgetResponse, grants: AiroCreditGrant[]) {
  // Map llmBudgetId -> grant for O(1) lookup during join
  const grantsByBudgetItemId = new Map<string, AiroCreditGrant>();
  for (const grant of grants) {
    if (grant.llmBudgetId) grantsByBudgetItemId.set(grant.llmBudgetId, grant);
  }

  return {
    budgetId: budget.budgetId,
    productKey: budget.productKey,
    creditsTotal: budget.creditsTotal,
    creditsUsed: budget.creditsUsed,
    creditsPending: budget.creditsPending,
    creditsTotalNumeric: toNumeric(budget.creditsTotal),
    creditsUsedNumeric: toNumeric(budget.creditsUsed),
    creditsPendingNumeric: toNumeric(budget.creditsPending),
    items: budget.items.map((item: BudgetItem) => {
      const grant = grantsByBudgetItemId.get(item.budgetItemId);
      return {
        ...item,
        creditsTotalNumeric: toNumeric(item.creditsTotal),
        creditsUsedNumeric: toNumeric(item.creditsUsed),
        type: grant?.type ?? null,
      };
    }),
  };
}
