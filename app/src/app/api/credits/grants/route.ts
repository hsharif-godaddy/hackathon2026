import { NextRequest, NextResponse } from 'next/server';
import {
  BudgetServiceAuthError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
} from '@airo/shared/budget';

import { checkBmsMigration, shouldCheckBmsMigration } from '@/lib/bms-migration';
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
  const { searchParams } = new URL(request.url);
  const subscriptionId = searchParams.get('subscriptionId');

  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

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

    // Four-lever BMS migration check (same logic as agent-token route):
    // 1. app-builder-budget-service flag (for NEW users)
    // 2. app-builder-bms-existing flag (for EXISTING migrated users)
    // 3. bmsBudgetId present on subscription
    // 4. bms-migration attribute with migrationDate (distinguishes existing from new)
    // Soft-fail flag lookups so a switchboard outage doesn't deny this read-only endpoint.
    let isBudgetFlagEnabled = false;
    let isBmsExistingEnabled = false;
    try {
      const [budgetFlag, bmsExistingFlag] = await Promise.all([
        checkSwitchboardFlag('app-builder-budget-service', request),
        checkSwitchboardFlag('app-builder-bms-existing', request),
      ]);
      isBudgetFlagEnabled = budgetFlag;
      isBmsExistingEnabled = bmsExistingFlag;
    } catch (error) {
      logger.warn('credits.grants.api.bms-flag-lookup.failed', {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const budgetClient = getBudgetServiceClient(request.headers);

    let grants;
    let source: CreditsSource;

    // Only fetch subscription when BMS path is possible (either flag enabled + client available)
    // budgetServiceEnabled: for NEW users created with BMS budgets
    // bmsExistingEnabled: for EXISTING users being migrated to BMS
    const bmsMigrationFlags = { budgetServiceEnabled: isBudgetFlagEnabled, bmsExistingEnabled: isBmsExistingEnabled };
    if (shouldCheckBmsMigration(bmsMigrationFlags) && budgetClient) {
      const subscription = await mgmtClient.getSubscription(subscriptionId, { includeAttributes: true });

      const migrationResult = checkBmsMigration(subscription, bmsMigrationFlags);

      if (!migrationResult.useBms) {
        // Migration not complete — fall back to legacy grants
        logger.info('credits.grants.api.bms-migration-not-ready', {
          subscriptionId,
          reason: migrationResult.reason,
        });
      } else {
        // BMS path: fetch from budget service and adapt to CreditGrant[] format
        const bmsBudgetId = migrationResult.bmsBudgetId!;
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
      }
    } else {
      logger.info('credits.grants.api.sourceSelection', {
        subscriptionId,
        source: 'grants',
        reason: !budgetClient ? 'no budget client' : 'both flags disabled',
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
      subscriptionId,
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
