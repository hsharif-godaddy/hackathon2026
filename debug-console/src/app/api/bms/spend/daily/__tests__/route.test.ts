import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ReportAggregateResponse } from '@airo/ai-lib/budget';

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

type GetHandler = (request: NextRequest) => Promise<Response>;
let GET: GetHandler;

const SUBSCRIPTION_ID = 'sub12345abc';
const BUDGET_ID = 'budget-1';
const PRODUCT_KEY = 'airo-builder';

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
    return new NextRequest(`https://local.gasket.dev-godaddy.com/api/bms/spend/daily?${query}`);
}

function defaultQuery(): string {
    return `subscriptionId=${SUBSCRIPTION_ID}&productKey=${encodeURIComponent(PRODUCT_KEY)}`;
}

describe('GET /api/bms/spend/daily', () => {
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
        const res = await GET(makeRequest(`productKey=${PRODUCT_KEY}`));
        expect(res.status).toBe(400);
    });

    it('returns 400 when productKey is missing', async () => {
        const res = await GET(makeRequest(`subscriptionId=${SUBSCRIPTION_ID}`));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/productKey/i);
    });

    it('returns empty dailySpend when subscription is not BMS', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: null });
        const res = await GET(makeRequest(defaultQuery()));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ dailySpend: [] });
        expect(getReportsAggregateMock).not.toHaveBeenCalled();
    });

    it('does NOT call getBudget — productKey comes from the query', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getReportsAggregateMock.mockResolvedValue(aggregateResponse(0, 0));

        await GET(makeRequest(defaultQuery()));

        expect(getBudgetMock).not.toHaveBeenCalled();
        expect(getReportsAggregateMock).toHaveBeenCalledTimes(30);
    });

    it('fans out 30 daily aggregate calls when useBms', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getReportsAggregateMock.mockResolvedValue(aggregateResponse(1.5, 2.5));

        const res = await GET(makeRequest(defaultQuery()));
        expect(res.status).toBe(200);
        const json = await res.json();

        expect(json.dailySpend).toHaveLength(30);
        expect(json.dailySpend[0].budgetCostTotal).toBe(1.5);
        expect(json.dailySpend[0].productCostTotal).toBe(2.5);
        expect(getReportsAggregateMock).toHaveBeenCalledTimes(30);
        expect(json.error).toBeUndefined();
    });

    it('passes UTC half-open daily windows and productKey through to BMS', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getReportsAggregateMock.mockResolvedValue(aggregateResponse(0, 0));

        await GET(makeRequest(defaultQuery()));

        const calls = getReportsAggregateMock.mock.calls;
        expect(calls).toHaveLength(30);
        for (const [params] of calls) {
            expect(params.productKey).toBe(PRODUCT_KEY);
            expect(params.budgetId).toBe(BUDGET_ID);
            const from = params.from as Date;
            const to = params.to as Date;
            expect(from.getUTCHours()).toBe(0);
            expect(to.getTime() - from.getTime()).toBe(86_400_000);
        }
        const today = new Date(Date.UTC(2026, 4, 13));
        const expectedFirst = new Date(today.getTime() - 29 * 86_400_000);
        expect((calls[0]![0].from as Date).toISOString()).toBe(expectedFirst.toISOString());
    });

    it('returns dailySpend filled with zeros and a soft error past the failure threshold', async () => {
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getReportsAggregateMock.mockRejectedValue(new Error('timeout'));

        const res = await GET(makeRequest(defaultQuery()));
        const json = await res.json();
        expect(json.dailySpend).toHaveLength(30);
        expect(json.dailySpend.every((d: { budgetCostTotal: number }) => d.budgetCostTotal === 0)).toBe(true);
        expect(json.error).toMatch(/Partial BMS failure/);
    });
});
