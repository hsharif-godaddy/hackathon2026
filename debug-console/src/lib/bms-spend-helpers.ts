/**
 * Shared helpers for the /api/bms/spend and /api/bms/spend/daily routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { BudgetServiceClient, type ReportAggregateParams } from '@airo/ai-lib/budget';

import { shouldUseBms } from '@/lib/bms-migration';
import { startOfUtcDay } from '@/lib/date-utils';
import { getRootDomainFromHeaders } from '@/lib/getRootDomain';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { handleMgmtError, SUBSCRIPTION_ID_RE } from '@/lib/mgmt-helpers';
import type { MgmtSubscription } from '@/lib/mgmt-types';

export const WINDOW_DAYS = 30;
export const CONCURRENCY = 10;
export const MS_PER_DAY = 86_400_000;

const BUDGET_SERVICE_HOST_PREFIX = 'budget-service.api.int';

export function getBudgetServiceUrl(request: NextRequest): string | null {
    if (process.env.BUDGET_SERVICE_URL) return process.env.BUDGET_SERVICE_URL;
    const root = getRootDomainFromHeaders(request.headers);
    return root ? `https://${BUDGET_SERVICE_HOST_PREFIX}.${root}` : null;
}

export function createBudgetServiceClient(baseUrl: string): BudgetServiceClient {
    return new BudgetServiceClient({
        baseUrl,
        // Generous compared to BMS prod defaults — first-call S2S token mint
        // can take ~2-3s on a cold AWS SDK chain; debug-console has no SLA.
        tokenTimeoutMs: 10_000,
        getBudgetTimeoutMs: 8_000,
    });
}

export type AggregateOk = { ok: true; budgetCostTotal: number; productCostTotal: number };
export type AggregateFail = { ok: false };
export type AggregateResult = AggregateOk | AggregateFail;

export async function safeAggregate(
    client: BudgetServiceClient,
    params: ReportAggregateParams,
    logEvent: string,
    logContext: Record<string, unknown>
): Promise<AggregateResult> {
    try {
        const r = await client.getReportsAggregate(params);
        return { ok: true, budgetCostTotal: r.budgetCostTotal, productCostTotal: r.productCostTotal };
    } catch (err) {
        logger.warn(logEvent, {
            ...logContext,
            error: err instanceof Error ? err.message : String(err),
        });
        return { ok: false };
    }
}

/** 30 contiguous half-open UTC daily windows ending today (inclusive). */
export function buildDailyWindows(): Array<{ date: string; from: Date; to: Date }> {
    const today = startOfUtcDay(new Date());
    const windows: Array<{ date: string; from: Date; to: Date }> = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
        const from = new Date(today.getTime() - i * MS_PER_DAY);
        const to = new Date(from.getTime() + MS_PER_DAY);
        windows.push({ date: from.toISOString().slice(0, 10), from, to });
    }
    return windows;
}

export interface BmsContext {
    subscriptionId: string;
    subscription: MgmtSubscription;
    bmsBudgetId: string;
    client: BudgetServiceClient;
}

export type BmsContextResult =
    | { ok: true; ctx: BmsContext }
    | { ok: false; response: NextResponse };

interface ResolveCallbacks {
    /** Render-as-200 body when the subscription is not BMS-eligible. */
    notBms: (reason: string) => unknown;
    /** Render-as-200 body when the BMS pipeline cannot be initialized. */
    error: (msg: string) => unknown;
}

/**
 * Validate subscriptionId, fetch the subscription, gate via shouldUseBms,
 * resolve the BMS base URL, and construct a BudgetServiceClient. On any
 * non-success path returns a ready-to-return NextResponse so callers stay flat.
 */
export async function resolveBmsContext(
    request: NextRequest,
    callbacks: ResolveCallbacks
): Promise<BmsContextResult> {
    const subscriptionId = request.nextUrl.searchParams.get('subscriptionId');
    if (!subscriptionId) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 }),
        };
    }
    if (!SUBSCRIPTION_ID_RE.test(subscriptionId)) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Invalid subscriptionId' }, { status: 400 }),
        };
    }

    let subscription: MgmtSubscription;
    try {
        subscription = await mgmtControlPlaneAdapter.getSubscription(subscriptionId, {
            includeAttributes: true,
        });
    } catch (error) {
        return { ok: false, response: handleMgmtError(error, 'fetch subscription', { subscriptionId }) };
    }

    const decision = shouldUseBms(subscription);
    if (!decision.useBms) {
        return { ok: false, response: NextResponse.json(callbacks.notBms(decision.reason)) };
    }
    const bmsBudgetId = decision.bmsBudgetId;

    const baseUrl = getBudgetServiceUrl(request);
    if (!baseUrl) {
        logger.warn('bms.spend.no_base_url', { subscriptionId });
        return { ok: false, response: NextResponse.json(callbacks.error('BMS URL unavailable')) };
    }

    let client: BudgetServiceClient;
    try {
        client = createBudgetServiceClient(baseUrl);
    } catch (err) {
        logger.error('bms.spend.client_init_failed', {
            baseUrl,
            error: err instanceof Error ? err.message : String(err),
        });
        return { ok: false, response: NextResponse.json(callbacks.error('Failed to initialize BMS client')) };
    }

    return { ok: true, ctx: { subscriptionId, subscription, bmsBudgetId, client } };
}
