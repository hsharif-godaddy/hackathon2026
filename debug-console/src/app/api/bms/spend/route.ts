/**
 * GET /api/bms/spend?subscriptionId=<id>
 *
 * Returns the BMS budget header, items adapted to CreditGrant[], a single
 * 30-day spend rollup, and a per-category breakdown. Intentionally does NOT
 * include the daily series — that lives at /api/bms/spend/daily and is loaded
 * lazily on user request to keep this default fetch cheap (1 budget + 1
 * rollup + 15 categories = 17 BMS calls vs. 47 if daily were included).
 *
 * Returns { useBms: false, reason } (HTTP 200) when the subscription should
 * not use BMS — the client treats this as a signal to fall back to legacy.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { BudgetResponse } from '@airo/shared/budget';
import type { CreditGrant } from '@airo/shared/grants';

import { withAuth } from '@/lib/api-auth';
import { ALL_REPORT_LABELS } from '@/lib/bms-categories';
import {
    type AggregateOk,
    CONCURRENCY,
    MS_PER_DAY,
    WINDOW_DAYS,
    resolveBmsContext,
    safeAggregate,
} from '@/lib/bms-spend-helpers';
import { mapWithConcurrency } from '@/lib/concurrency';
import { adaptBudgetToGrants } from '@/lib/credit-adapter';
import { startOfUtcDay } from '@/lib/date-utils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const PARTIAL_FAILURE_THRESHOLD = 0.2;

interface BmsRollup {
    budgetCostTotal: number;
    productCostTotal: number;
}

interface CategoryAggregate {
    category: string;
    budgetCostTotal: number;
    productCostTotal: number;
}

type BmsSpendResponse =
    | {
          useBms: true;
          budget: BudgetResponse | null;
          grants: CreditGrant[];
          rollup: BmsRollup;
          categoryBreakdown: CategoryAggregate[];
          error?: string;
      }
    | { useBms: false; reason?: string };

const ZERO_ROLLUP: BmsRollup = { budgetCostTotal: 0, productCostTotal: 0 };

function bmsErrorBody(error: string): BmsSpendResponse {
    return {
        useBms: true,
        budget: null,
        grants: [],
        rollup: ZERO_ROLLUP,
        categoryBreakdown: [],
        error,
    };
}

export const GET = withAuth(async (request: NextRequest) => {
    const result = await resolveBmsContext(request, {
        notBms: (reason): BmsSpendResponse => ({ useBms: false, reason }),
        error: bmsErrorBody,
    });
    if (!result.ok) return result.response;
    const { subscriptionId, bmsBudgetId, client } = result.ctx;

    let budget: BudgetResponse;
    try {
        budget = await client.getBudget(bmsBudgetId);
    } catch (err) {
        logger.error('bms.spend.get_budget_failed', {
            subscriptionId,
            bmsBudgetId,
            error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json(bmsErrorBody('Failed to fetch BMS budget'));
    }

    const grants = adaptBudgetToGrants(budget, subscriptionId);
    const productKey = budget.productKey;

    const today = startOfUtcDay(new Date());
    const windowFrom = new Date(today.getTime() - (WINDOW_DAYS - 1) * MS_PER_DAY);
    const windowTo = new Date(today.getTime() + MS_PER_DAY);

    const [rollupResult, categoryResults] = await Promise.all([
        safeAggregate(
            client,
            { budgetId: bmsBudgetId, productKey, from: windowFrom, to: windowTo },
            'bms.spend.rollup_aggregate_failed',
            { subscriptionId }
        ),
        mapWithConcurrency(ALL_REPORT_LABELS, CONCURRENCY, (label) =>
            safeAggregate(
                client,
                { budgetId: bmsBudgetId, productKey, label, from: windowFrom, to: windowTo },
                'bms.spend.category_aggregate_failed',
                { category: label }
            )
        ),
    ]);

    const rollup: BmsRollup = rollupResult.ok
        ? { budgetCostTotal: rollupResult.budgetCostTotal, productCostTotal: rollupResult.productCostTotal }
        : ZERO_ROLLUP;

    const categoryBreakdown: CategoryAggregate[] = categoryResults
        .map((r, i) => ({ result: r, category: ALL_REPORT_LABELS[i]! }))
        .filter(({ result }) => result.ok && (result.budgetCostTotal > 0 || result.productCostTotal > 0))
        .map(({ result, category }) => {
            const ok = result as AggregateOk;
            return { category, budgetCostTotal: ok.budgetCostTotal, productCostTotal: ok.productCostTotal };
        })
        .sort((a, b) => b.budgetCostTotal - a.budgetCostTotal);

    const totalCalls = 1 + categoryResults.length;
    const failedCalls =
        (rollupResult.ok ? 0 : 1) + categoryResults.filter((r) => !r.ok).length;
    const errorMsg =
        totalCalls > 0 && failedCalls / totalCalls > PARTIAL_FAILURE_THRESHOLD
            ? `Partial BMS failure: ${failedCalls}/${totalCalls} aggregate calls failed`
            : undefined;

    const body: BmsSpendResponse = {
        useBms: true,
        budget,
        grants,
        rollup,
        categoryBreakdown,
        ...(errorMsg ? { error: errorMsg } : {}),
    };
    return NextResponse.json(body);
});
