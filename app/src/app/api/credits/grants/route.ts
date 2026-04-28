import { NextRequest, NextResponse } from 'next/server';
import {
  BudgetServiceAuthError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
} from '@airo/shared/budget';

import { getBudgetServiceClient } from '@/lib/budget-service/client';
import { adaptBudgetToGrants } from '@/lib/credit-adapter';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { CreditsSource } from '@/types/credits';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/credits/grants - Get credit grants for a subscription
 *
 * Returns credit grants (monthly plan and credit packs) for a subscription.
 * When BMS is enabled (flag ON + subscription.bmsBudgetId present + budget client
 * available), data comes from BMS and is adapted to CreditGrant[] format for
 * backwards compatibility. Otherwise, data comes from the legacy mgmt-airo grants API.
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
      subscriptionId,
      syncSpend,
    });

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const mgmtClient = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

    // Check if BMS flag is enabled first (avoids subscription fetch on legacy path).
    // Soft-fail so a switchboard outage doesn't deny this read-only endpoint;
    // the legacy path below always works and a missed BMS routing decision is
    // benign compared to a 500.
    let isBudgetFlagEnabled = false;
    try {
      isBudgetFlagEnabled = await checkSwitchboardFlag('app-builder-budget-service', request);
    } catch (error) {
      logger.warn('credits.grants.api.bms-flag-lookup.failed', {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const budgetClient = getBudgetServiceClient(request.headers);

    let grants;
    let source: CreditsSource;

    // Only fetch subscription when BMS path is possible (flag enabled + client available)
    if (isBudgetFlagEnabled && budgetClient) {
      const subscription = await mgmtClient.getSubscription(subscriptionId);
      const bmsBudgetId = subscription.bmsBudgetId;

      if (!bmsBudgetId) {
        // BMS enabled but subscription has no bmsBudgetId - return empty grants with unavailable source
        logger.error('credits.grants.api.missingBmsBudgetId', {
          subscriptionId,
          reason: 'BMS enabled but subscription has no bmsBudgetId',
        });
        return NextResponse.json({
          success: true,
          data: [],
          source: CreditsSource.Unavailable,
        });
      }

      // BMS path: fetch from budget service and adapt to CreditGrant[] format
      logger.info('credits.grants.api.sourceSelection', {
        subscriptionId,
        source: 'bms',
        bmsBudgetId,
      });

      const budget = await budgetClient.getBudget(bmsBudgetId);
      grants = adaptBudgetToGrants(budget, subscriptionId);
      source = CreditsSource.Bms;

      logger.info('credits.grants.api.success', {
        subscriptionId,
        source,
        budgetId: bmsBudgetId,
        grantCount: grants.length,
      });

      return NextResponse.json({
        success: true,
        data: grants,
        source,
      });
    } else {
      logger.info('credits.grants.api.sourceSelection', {
        subscriptionId,
        source: 'grants',
        reason: !isBudgetFlagEnabled ? 'flag disabled' : 'no budget client',
      });
    }

    // Legacy grants path
    grants = await mgmtClient.getCreditGrants(subscriptionId, syncSpend);
    source = CreditsSource.Grants;

    logger.info('credits.grants.api.success', {
      subscriptionId,
      source,
      grantCount: grants.length,
    });

    return NextResponse.json({
      success: true,
      data: grants,
      source,
    });

  } catch (error) {
    logger.error('credits.grants.api.error', {
      message: 'Failed to fetch credit grants',
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType: error instanceof Error ? error.constructor.name : 'Unknown',
    });

    // Handle BMS-specific errors
    if (error instanceof BudgetServiceAuthError) {
      return NextResponse.json(
        { error: 'Budget service authentication failed' },
        { status: 401 }
      );
    }

    if (error instanceof BudgetServiceTimeoutError) {
      return NextResponse.json(
        { error: 'Budget service request timed out' },
        { status: 504 }
      );
    }

    if (error instanceof BudgetServiceUnavailableError) {
      return NextResponse.json(
        { error: 'Budget service unavailable' },
        { status: 503 }
      );
    }

    if (error instanceof BudgetServiceError) {
      return NextResponse.json(
        { error: 'Budget service error' },
        { status: error.statusCode || 500 }
      );
    }

    // Handle mgmt-airo errors
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
