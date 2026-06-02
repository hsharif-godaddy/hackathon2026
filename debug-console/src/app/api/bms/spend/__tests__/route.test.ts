import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { BudgetResponse } from '@airo/shared/budget';
import type { ReportAggregateResponse } from '@airo/ai-lib/budget';

import { ALL_REPORT_LABELS } from '@/lib/bms-categories';

// ── Mocks (must be set up before importing the route) ─────────────────────

vi.mock('@/lib/api-auth', () => ({
    withAuth: <P,>(
        handler: (
            request: NextRequest,
            auth: { authenticated: true },
            context: P
        ) => Promise<Response>
    ) =>
        async (request: NextRequest, context: P): Promise<Response> =>
            handler(request, { authenticated: true }, context),
}));

const getSubscriptionMock = vi.fn();
vi.mock('@/lib/mgmt-control-plane-adapter', () => ({
    default: {
        getSubscription: (...args: unknown[]) => getSubscriptionMock(...args),
    },
}));

const getBudgetMock = vi.fn();
const getReportsAggregateMock = vi.fn();
vi.mock('@airo/ai-lib/budget', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@airo/ai-lib/budget')>();
    return {
        ...actual,
        BudgetServiceClient: class {
            constructor(_: unknown) {}
            getBudget = (...args: unknown[]) => getBudgetMock(...args);
            getReportsAggregate = (...args: unknown[]) => getReportsAggregateMock(...args);
        },
    };
});

vi.mock('@/lib/getRootDomain', () => ({
    getRootDomainFromHeaders: () => 'test-godaddy.com',
}));

// Use a module-level `let` for the imported route so reset between tests.
type GetHandler = (request: NextRequest) => Promise<Response>;
let GET: GetHandler;

// ── Fixtures ──────────────────────────────────────────────────────────────

const SUBSCRIPTION_ID = 'sub12345abc';
const BUDGET_ID = 'budget-1';
const PRODUCT_KEY = 'airo-builder';

function makeBudget(overrides: Partial<BudgetResponse> = {}): BudgetResponse {
    return {
        budgetId: BUDGET_ID,
        productKey: PRODUCT_KEY,
        creditsTotal: '1000',
        creditsUsed: '250',
        creditsPending: '0',
        items: [
            {
                budgetItemId: 'item-1',
                creditsTotal: '1000',
                creditsUsed: '250',
                costToCreditRatio: '1.0',
                startsAt: '2026-04-01T00:00:00.000Z',
                expiresAt: null,
                resetInterval: null,
                resetsAt: null,
                label: null,
            },
        ],
        ...overrides,
    };
}

function aggregateResponse(budget: number, product: number): ReportAggregateResponse {
    return {
        from: '',
        to: '',
        budgetCostTotal: budget,
        productCostTotal: product,
        reportLineCount: 0,
    };
}

function makeRequest(query: string): NextRequest {
    return new NextRequest(`https://local.gasket.dev-godaddy.com/api/bms/spend?${query}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/bms/spend', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-13T15:00:00.000Z'));
        getSubscriptionMock.mockReset();
        getBudgetMock.mockReset();
        getReportsAggregateMock.mockReset();

        const mod = await import('../route');
        GET = mod.GET as GetHandler;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.resetModules();
    });

    it('returns 400 when subscriptionId is missing', async () => {
        const res = await GET(makeRequest(''));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/required/i);
    });

    it('returns 400 when subscriptionId is malformed', async () => {
        const res = await GET(makeRequest('subscriptionId=!!'));
        expect(res.status).toBe(400);
    });

    it('returns useBms:false when subscription has no bmsBudgetId', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: null });
        const res = await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ useBms: false, reason: 'no-bms-budget-id' });
        expect(getBudgetMock).not.toHaveBeenCalled();
    });

    it('returns useBms:false when migration is in progress', async () => {
        getSubscriptionMock.mockResolvedValue({
            id: SUBSCRIPTION_ID,
            bmsBudgetId: BUDGET_ID,
            attributes: [{ key: 'bms-migration', value: { migrationDate: null } }],
        });
        const res = await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));
        const json = await res.json();
        expect(json).toEqual({ useBms: false, reason: 'migration-in-progress' });
        expect(getBudgetMock).not.toHaveBeenCalled();
    });

    it('aggregates 1 rollup + 15 category calls when useBms', async () => {
        getSubscriptionMock.mockResolvedValue({
            id: SUBSCRIPTION_ID,
            bmsBudgetId: BUDGET_ID,
        });
        getBudgetMock.mockResolvedValue(makeBudget());
        getReportsAggregateMock.mockImplementation(function ({ label }: { label?: string }) { return label
                ? Promise.resolve(aggregateResponse(7, 14))
                : Promise.resolve(aggregateResponse(45, 75)); } // 30-day rollup
        );

        const res = await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));
        expect(res.status).toBe(200);
        const json = await res.json();

        expect(json.useBms).toBe(true);
        expect(json.budget.budgetId).toBe(BUDGET_ID);
        expect(json.grants).toHaveLength(1);
        expect(json.rollup).toEqual({ budgetCostTotal: 45, productCostTotal: 75 });
        expect(json.categoryBreakdown).toHaveLength(ALL_REPORT_LABELS.length);
        expect(json.categoryBreakdown[0].budgetCostTotal).toBe(7);
        expect(json.categoryBreakdown[0].productCostTotal).toBe(14);
        // 1 rollup + 15 category — no daily fan-out
        expect(getReportsAggregateMock).toHaveBeenCalledTimes(1 + ALL_REPORT_LABELS.length);
        expect(json.error).toBeUndefined();
        expect(json.dailySpend).toBeUndefined();
    });

    it('passes the full 30-day window to the rollup call', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockResolvedValue(makeBudget());
        getReportsAggregateMock.mockResolvedValue(aggregateResponse(0, 0));

        await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));

        const rollupCall = getReportsAggregateMock.mock.calls.find((args) => !args[0].label);
        expect(rollupCall).toBeDefined();
        const params = rollupCall![0];
        expect(params.productKey).toBe(PRODUCT_KEY);
        expect(params.budgetId).toBe(BUDGET_ID);
        const from = params.from as Date;
        const to = params.to as Date;
        // 30-day window: from = startOfUtcDay(today) - 29d, to = startOfUtcDay(today) + 1d.
        expect(to.getTime() - from.getTime()).toBe(30 * 86_400_000);
        expect(from.getUTCHours()).toBe(0);
        expect(to.getUTCHours()).toBe(0);
    });

    it('drops zero-spend categories from the breakdown', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockResolvedValue(makeBudget());
        getReportsAggregateMock.mockImplementation(function ({ label }: { label?: string }) { return label === ALL_REPORT_LABELS[0]
                ? Promise.resolve(aggregateResponse(5, 7))
                : Promise.resolve(aggregateResponse(0, 0)); }
        );

        const res = await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));
        const json = await res.json();
        expect(json.categoryBreakdown).toHaveLength(1);
        expect(json.categoryBreakdown[0].category).toBe(ALL_REPORT_LABELS[0]);
    });

    it('returns the BMS-error fallback shape when getBudget fails', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockRejectedValue(new Error('boom'));

        const res = await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.useBms).toBe(true);
        expect(json.budget).toBeNull();
        expect(json.grants).toEqual([]);
        expect(json.rollup).toEqual({ budgetCostTotal: 0, productCostTotal: 0 });
        expect(json.categoryBreakdown).toEqual([]);
        expect(json.error).toMatch(/budget/i);
        expect(getReportsAggregateMock).not.toHaveBeenCalled();
    });

    it('zeros the rollup and surfaces a soft warning when most aggregate calls fail', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockResolvedValue(makeBudget());
        // Fail every aggregate (rollup + categories). 16/16 = 100% over threshold.
        getReportsAggregateMock.mockRejectedValue(new Error('timeout'));

        const res = await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));
        const json = await res.json();
        expect(json.useBms).toBe(true);
        expect(json.rollup).toEqual({ budgetCostTotal: 0, productCostTotal: 0 });
        expect(json.categoryBreakdown).toEqual([]);
        expect(json.error).toMatch(/Partial BMS failure/);
    });

    it('uses BUDGET_SERVICE_URL env override when set', async () => {
        vi.stubEnv('BUDGET_SERVICE_URL', 'https://override.example.com');
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockResolvedValue(makeBudget());
        getReportsAggregateMock.mockResolvedValue(aggregateResponse(0, 0));

        const res = await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));
        expect(res.status).toBe(200);
        // Just confirm no env-driven failure path was hit.
        const json = await res.json();
        expect(json.useBms).toBe(true);
        vi.unstubAllEnvs();
    });
});
