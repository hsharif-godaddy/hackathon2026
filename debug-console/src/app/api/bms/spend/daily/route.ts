/**
 * GET /api/bms/spend/daily?subscriptionId=<id>&productKey=<key>
 *
 * Returns the 30-day daily spend series for the BMS budget tied to this
 * subscription. Loaded lazily by the panel on user request — kept out of the
 * main /api/bms/spend response so the default panel render only does 17 BMS
 * calls instead of 47.
 *
 * `productKey` is required and is supplied by the client from the budget
 * already fetched by /api/bms/spend, so this route does NOT re-call getBudget.
 *
 * Returns 200 with a soft `error` field on partial / total BMS failure; the
 * client renders whatever days came through. Returns 200 with empty
 * `dailySpend` when the subscription is non-BMS (caller shouldn't ask in
 * that state, but we don't 4xx for it).
 */

import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import {
    CONCURRENCY,
    buildDailyWindows,
    resolveBmsContext,
    safeAggregate,
} from '@/lib/bms-spend-helpers';
import { mapWithConcurrency } from '@/lib/concurrency';

export const dynamic = 'force-dynamic';

const PARTIAL_FAILURE_THRESHOLD = 0.2;

interface DailyAggregate {
    date: string; // YYYY-MM-DD UTC
    budgetCostTotal: number;
    productCostTotal: number;
}

interface BmsDailyResponse {
    dailySpend: DailyAggregate[];
    error?: string;
}

function emptyResponse(error: string): BmsDailyResponse {
    return { dailySpend: [], error };
}

export const GET = withAuth(async (request: NextRequest) => {
    const productKey = request.nextUrl.searchParams.get('productKey');
    if (!productKey) {
        return NextResponse.json({ error: 'productKey is required' }, { status: 400 });
    }

    const result = await resolveBmsContext(request, {
        notBms: (): BmsDailyResponse => ({ dailySpend: [] }),
        error: emptyResponse,
    });
    if (!result.ok) return result.response;
    const { bmsBudgetId, client } = result.ctx;

    const dailyWindows = buildDailyWindows();

    const dailyResults = await mapWithConcurrency(dailyWindows, CONCURRENCY, (w) =>
        safeAggregate(
            client,
            { budgetId: bmsBudgetId, productKey, from: w.from, to: w.to },
            'bms.spend.daily.aggregate_failed',
            { date: w.date }
        )
    );

    const dailySpend: DailyAggregate[] = dailyWindows.map((w, i) => {
        const r = dailyResults[i]!;
        return r.ok
            ? { date: w.date, budgetCostTotal: r.budgetCostTotal, productCostTotal: r.productCostTotal }
            : { date: w.date, budgetCostTotal: 0, productCostTotal: 0 };
    });

    const failed = dailyResults.filter((r) => !r.ok).length;
    const errorMsg =
        dailyResults.length > 0 && failed / dailyResults.length > PARTIAL_FAILURE_THRESHOLD
            ? `Partial BMS failure: ${failed}/${dailyResults.length} daily aggregates failed`
            : undefined;

    const body: BmsDailyResponse = { dailySpend, ...(errorMsg ? { error: errorMsg } : {}) };
    return NextResponse.json(body);
});
