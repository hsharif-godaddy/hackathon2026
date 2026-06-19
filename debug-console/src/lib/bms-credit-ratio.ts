/**
 * Resolve an app's BMS cost-to-credit ratio (USD per credit) from just an appId:
 *   appId → subscriptionId → BMS budget → items[].costToCreditRatio.
 *
 * Shared by GET /api/bms/credit-ratio and the EB sessions route (which stamps
 * credits onto each trace's cost summary). Best-effort: any non-BMS / failure
 * path resolves to { useBms: false, ratio: null, mixedRatios: false } so callers
 * just omit credits rather than erroring.
 */

import type { NextRequest } from 'next/server';

import { shouldUseBms } from '@/lib/bms-migration';
import { createBudgetServiceClient, getBudgetServiceUrl } from '@/lib/bms-spend-helpers';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';

export interface CreditRatioResult {
    useBms: boolean;
    /** USD per credit; null when unavailable. credits = usd / ratio. */
    ratio: number | null;
    /** True when budget items carry differing ratios (single-ratio conversion is approximate). */
    mixedRatios: boolean;
}

export const NOT_BMS_RATIO: CreditRatioResult = { useBms: false, ratio: null, mixedRatios: false };

export async function resolveCreditRatio(appId: string, request: NextRequest): Promise<CreditRatioResult> {
    // 1. appId → subscriptionId
    let subscriptionId: string;
    try {
        const app = await mgmtControlPlaneAdapter.getAppDetails(appId);
        subscriptionId = app.subscriptionId;
    } catch (err) {
        logger.warn('bms.credit_ratio.app_lookup_failed', {
            appId,
            error: err instanceof Error ? err.message : String(err),
        });
        return NOT_BMS_RATIO;
    }
    if (!subscriptionId) return NOT_BMS_RATIO;

    // 2. subscription → BMS gate → bmsBudgetId
    let bmsBudgetId: string;
    try {
        const subscription = await mgmtControlPlaneAdapter.getSubscription(subscriptionId, {
            includeAttributes: true,
        });
        const decision = shouldUseBms(subscription);
        if (!decision.useBms) return NOT_BMS_RATIO;
        bmsBudgetId = decision.bmsBudgetId;
    } catch (err) {
        logger.warn('bms.credit_ratio.subscription_lookup_failed', {
            appId,
            subscriptionId,
            error: err instanceof Error ? err.message : String(err),
        });
        return NOT_BMS_RATIO;
    }

    // 3. budget → costToCreditRatio
    const baseUrl = getBudgetServiceUrl(request);
    if (!baseUrl) {
        logger.warn('bms.credit_ratio.no_base_url', { appId, subscriptionId });
        return NOT_BMS_RATIO;
    }
    try {
        const client = createBudgetServiceClient(baseUrl);
        const budget = await client.getBudget(bmsBudgetId);

        const distinctRatios = Array.from(
            new Set(
                budget.items
                    .map((item) => parseFloat(item.costToCreditRatio))
                    .filter((n) => Number.isFinite(n) && n > 0),
            ),
        );
        if (distinctRatios.length === 0) {
            return { useBms: true, ratio: null, mixedRatios: false };
        }
        // Prefer the recurring plan-monthly item's ratio (resetInterval set) as the
        // representative rate; fall back to the first valid ratio.
        const planItem = budget.items.find(
            (item) => item.resetInterval != null && parseFloat(item.costToCreditRatio) > 0,
        );
        const ratio = planItem ? parseFloat(planItem.costToCreditRatio) : distinctRatios[0]!;
        return { useBms: true, ratio, mixedRatios: distinctRatios.length > 1 };
    } catch (err) {
        logger.error('bms.credit_ratio.get_budget_failed', {
            appId,
            subscriptionId,
            bmsBudgetId,
            error: err instanceof Error ? err.message : String(err),
        });
        return { useBms: true, ratio: null, mixedRatios: false };
    }
}
