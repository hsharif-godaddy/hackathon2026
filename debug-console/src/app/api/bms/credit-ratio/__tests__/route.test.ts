import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { BudgetResponse, BudgetItem } from '@airo/shared/budget';

// ── Mocks (must be set up before importing the route) ─────────────────────

vi.mock('@/lib/api-auth', () => ({
    withAuth: <P,>(
        handler: (request: NextRequest, auth: { authenticated: true }, context: P) => Promise<Response>
    ) =>
        async (request: NextRequest, context: P): Promise<Response> =>
            handler(request, { authenticated: true }, context),
}));

const getAppDetailsMock = vi.fn();
const getSubscriptionMock = vi.fn();
vi.mock('@/lib/mgmt-control-plane-adapter', () => ({
    default: {
        getAppDetails: (...args: unknown[]) => getAppDetailsMock(...args),
        getSubscription: (...args: unknown[]) => getSubscriptionMock(...args),
    },
}));

const getBudgetMock = vi.fn();
vi.mock('@airo/ai-lib/budget', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@airo/ai-lib/budget')>();
    return {
        ...actual,
        BudgetServiceClient: class {
            constructor(_: unknown) {}
            getBudget = (...args: unknown[]) => getBudgetMock(...args);
        },
    };
});

vi.mock('@/lib/getRootDomain', () => ({
    getRootDomainFromHeaders: () => 'test-godaddy.com',
}));

type GetHandler = (request: NextRequest) => Promise<Response>;
let GET: GetHandler;

// ── Fixtures ──────────────────────────────────────────────────────────────

const APP_ID = 'app123456';
const SUBSCRIPTION_ID = 'sub12345abc';
const BUDGET_ID = 'budget-1';

function item(overrides: Partial<BudgetItem>): BudgetItem {
    return {
        budgetItemId: 'item-1',
        creditsTotal: '1000',
        creditsUsed: '0',
        costToCreditRatio: '0.1',
        startsAt: null,
        expiresAt: null,
        resetInterval: null,
        resetsAt: null,
        label: null,
        ...overrides,
    };
}

function makeBudget(items: BudgetItem[]): BudgetResponse {
    return {
        budgetId: BUDGET_ID,
        productKey: 'airo-builder',
        creditsTotal: '1000',
        creditsUsed: '0',
        creditsPending: '0',
        items,
    };
}

function makeRequest(query: string): NextRequest {
    return new NextRequest(`https://local.gasket.dev-godaddy.com/api/bms/credit-ratio?${query}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/bms/credit-ratio', () => {
    beforeEach(async () => {
        getAppDetailsMock.mockReset();
        getSubscriptionMock.mockReset();
        getBudgetMock.mockReset();
        const mod = await import('../route');
        GET = mod.GET as GetHandler;
    });

    afterEach(() => {
        vi.resetModules();
    });

    it('returns 400 when appId is missing', async () => {
        const res = await GET(makeRequest(''));
        expect(res.status).toBe(400);
    });

    it('returns 400 when appId is malformed', async () => {
        const res = await GET(makeRequest('appId=!!'));
        expect(res.status).toBe(400);
    });

    it('returns useBms:false when the subscription has no bmsBudgetId', async () => {
        getAppDetailsMock.mockResolvedValue({ subscriptionId: SUBSCRIPTION_ID });
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: null });
        const res = await GET(makeRequest(`appId=${APP_ID}`));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ useBms: false, ratio: null, mixedRatios: false });
        expect(getBudgetMock).not.toHaveBeenCalled();
    });

    it('returns the single ratio with mixedRatios:false', async () => {
        getAppDetailsMock.mockResolvedValue({ subscriptionId: SUBSCRIPTION_ID });
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockResolvedValue(makeBudget([item({ costToCreditRatio: '0.1' })]));
        const res = await GET(makeRequest(`appId=${APP_ID}`));
        expect(await res.json()).toEqual({ useBms: true, ratio: 0.1, mixedRatios: false });
    });

    it('flags mixedRatios and prefers the plan-monthly (resetInterval) ratio', async () => {
        getAppDetailsMock.mockResolvedValue({ subscriptionId: SUBSCRIPTION_ID });
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockResolvedValue(
            makeBudget([
                item({ budgetItemId: 'pack', costToCreditRatio: '0.25', resetInterval: null }),
                item({ budgetItemId: 'plan', costToCreditRatio: '0.1', resetInterval: 'P1M' }),
            ]),
        );
        const res = await GET(makeRequest(`appId=${APP_ID}`));
        expect(await res.json()).toEqual({ useBms: true, ratio: 0.1, mixedRatios: true });
    });

    it('returns ratio:null when no item carries a valid ratio', async () => {
        getAppDetailsMock.mockResolvedValue({ subscriptionId: SUBSCRIPTION_ID });
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockResolvedValue(makeBudget([item({ costToCreditRatio: '0' })]));
        const res = await GET(makeRequest(`appId=${APP_ID}`));
        expect(await res.json()).toEqual({ useBms: true, ratio: null, mixedRatios: false });
    });

    it('falls back to useBms:true/ratio:null when getBudget fails', async () => {
        getAppDetailsMock.mockResolvedValue({ subscriptionId: SUBSCRIPTION_ID });
        getSubscriptionMock.mockResolvedValue({ id: SUBSCRIPTION_ID, bmsBudgetId: BUDGET_ID });
        getBudgetMock.mockRejectedValue(new Error('boom'));
        const res = await GET(makeRequest(`appId=${APP_ID}`));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ useBms: true, ratio: null, mixedRatios: false });
    });

    it('returns NOT_BMS when the app lookup fails', async () => {
        getAppDetailsMock.mockRejectedValue(new Error('mgmt down'));
        const res = await GET(makeRequest(`appId=${APP_ID}`));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ useBms: false, ratio: null, mixedRatios: false });
        expect(getSubscriptionMock).not.toHaveBeenCalled();
    });
});
