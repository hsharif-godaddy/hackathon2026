import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetResponse } from '@airo/shared/budget';
import {
  BudgetServiceAuthError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
} from '@airo/shared/budget';

import { type AiroCreditGrant, AiroGrantType } from '@/lib/mgmt-airo';

vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  return { ...actual, AiroMgmtClient: vi.fn() };
});
vi.mock('@/lib/budget-service/client');
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => handler,
}));
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const MOCK_GRANT: AiroCreditGrant = {
  id: 'grant-1',
  subscriptionId: 'sub-123',
  type: AiroGrantType.PlanMonthly,
  llmBudgetUserId: 'user-1',
  llmBudgetId: 'bi-1',
  creditsMax: 150,
  creditsSpent: 50,
  isAvailable: true,
  finalState: null,
  useBefore: '2026-05-01T00:00:00Z',
  consumedAt: null,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-07T00:00:00Z',
};

const MOCK_BUDGET: BudgetResponse = {
  budgetId: 'sub-123',
  productKey: 'airo-builder',
  creditsTotal: '150.000000',
  creditsUsed: '50.000000',
  creditsPending: '0.000000',
  items: [
    {
      budgetItemId: 'bi-1',
      creditsTotal: '150.000000',
      creditsUsed: '50.000000',
      costToCreditRatio: '0.100000',
      startsAt: null,
      expiresAt: null,
      resetInterval: null,
    },
  ],
};

describe('GET /api/credits/status', () => {
  let mockMgmtClient: any;
  let mockBudgetClient: any;
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockMgmtClient = {
      getSubscription: vi.fn().mockResolvedValue({ id: 'sub-123' }),
      getCreditGrants: vi.fn().mockResolvedValue([MOCK_GRANT]),
    };

    mockBudgetClient = {
      getBudget: vi.fn().mockResolvedValue(MOCK_BUDGET),
    };

    const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
    vi.mocked(AiroMgmtClient as any).mockImplementation(() => mockMgmtClient);

    const { getBudgetServiceClient } = await import('@/lib/budget-service/client');
    vi.mocked(getBudgetServiceClient).mockReturnValue(mockBudgetClient);

    const routeModule = await import('../route');
    GET = routeModule.GET;
  });

  const createAuthContext = (jwt?: string) => ({
    jwt,
    user: { customerId: 'test-customer-123' },
  });

  // ── Auth ──

  describe('authentication', () => {
    it('returns 401 if no JWT', async () => {
      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext());
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe('Authentication token required');
    });
  });

  // ── Params ──

  describe('parameter validation', () => {
    it('returns 400 if subscriptionId missing', async () => {
      const request = new NextRequest('http://localhost/api/credits/status');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('subscriptionId query parameter is required');
    });

    it('returns 400 if subscriptionId is empty string', async () => {
      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(400);
    });

    it('returns 400 if subscriptionId is whitespace', async () => {
      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=%20');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(400);
    });
  });

  // ── Ownership ──

  describe('subscription ownership', () => {
    it('returns 404 if subscription not owned', async () => {
      const { AiroHttpError } = await import('@/lib/mgmt-airo');
      mockMgmtClient.getSubscription.mockRejectedValue(
        new AiroHttpError(404, 'Not Found', 'Not found')
      );

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-999');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('Subscription not found');
      expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
    });

    it('returns 502 if mgmt-airo unreachable', async () => {
      mockMgmtClient.getSubscription.mockRejectedValue(new Error('ECONNREFUSED'));

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(502);
      expect((await response.json()).error).toBe('Failed to verify subscription');
      expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
    });
  });

  // ── Happy path ──

  describe('success', () => {
    it('returns enriched budget data with numeric fields', async () => {
      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.budgetId).toBe('sub-123');
      expect(data.data.creditsTotal).toBe('150.000000');
      expect(data.data.creditsTotalNumeric).toBe(150);
      expect(data.data.creditsUsedNumeric).toBe(50);
      expect(data.data.creditsPendingNumeric).toBe(0);
    });

    it('joins items with grants to add type labels', async () => {
      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      const { items } = (await response.json()).data;

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('plan-monthly');
      expect(items[0].creditsTotalNumeric).toBe(150);
      expect(items[0].creditsUsedNumeric).toBe(50);
      expect(items[0].budgetItemId).toBe('bi-1');
    });

    it('sets type null for items with no matching grant', async () => {
      mockMgmtClient.getCreditGrants.mockResolvedValue([]); // no grants

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      const { items } = (await response.json()).data;

      expect(items[0].type).toBeNull();
      expect(items[0].creditsTotalNumeric).toBe(150);
    });

    it('parallel-fetches grants and budget', async () => {
      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      await GET(request, createAuthContext('jwt'));

      expect(mockMgmtClient.getCreditGrants).toHaveBeenCalledWith('sub-123', false);
      expect(mockBudgetClient.getBudget).toHaveBeenCalledWith('sub-123');
    });

    it('passes subscriptionId as budgetId to BMS', async () => {
      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-456');
      await GET(request, createAuthContext('jwt'));
      expect(mockBudgetClient.getBudget).toHaveBeenCalledWith('sub-456');
    });
  });

  // ── Grants fetch failure ──

  describe('grants fetch failure', () => {
    it('degrades gracefully with null type labels if getCreditGrants fails', async () => {
      mockMgmtClient.getCreditGrants.mockRejectedValue(new Error('mgmt-airo 500'));

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(200);

      const { data } = await response.json();
      expect(data.budgetId).toBe('sub-123');
      expect(data.items[0].type).toBeNull();
      expect(data.items[0].creditsTotalNumeric).toBe(150);
    });
  });

  // ── BMS client not configured ──

  describe('budget service unavailable', () => {
    it('returns 503 if client not configured', async () => {
      const { getBudgetServiceClient } = await import('@/lib/budget-service/client');
      vi.mocked(getBudgetServiceClient).mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('Budget service unavailable');
    });
  });

  // ── BMS errors ──

  describe('budget service errors', () => {
    it('returns 502 on BMS auth error', async () => {
      mockBudgetClient.getBudget.mockRejectedValue(
        new BudgetServiceAuthError('auth failed', 401, '')
      );

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(502);
      expect((await response.json()).error).toBe('Budget service auth failed');
    });

    it('returns 502 on BMS timeout', async () => {
      mockBudgetClient.getBudget.mockRejectedValue(
        new BudgetServiceTimeoutError('timed out')
      );

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(502);
      expect((await response.json()).error).toBe('Budget service timeout');
    });

    it('returns 502 on BMS unreachable', async () => {
      mockBudgetClient.getBudget.mockRejectedValue(
        new BudgetServiceUnavailableError('unreachable')
      );

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(502);
      expect((await response.json()).error).toBe('Budget service unavailable');
    });

    it('returns 404 on BMS 404', async () => {
      mockBudgetClient.getBudget.mockRejectedValue(
        new BudgetServiceError('not found', 404, 'resource not found')
      );

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('Budget not found');
    });

    it('returns 502 on BMS 500', async () => {
      mockBudgetClient.getBudget.mockRejectedValue(
        new BudgetServiceError('server error', 500, '')
      );

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(502);
      expect((await response.json()).error).toBe('Failed to fetch credit status');
    });

    it('returns 500 on unknown error', async () => {
      mockBudgetClient.getBudget.mockRejectedValue(new Error('unexpected'));

      const request = new NextRequest('http://localhost/api/credits/status?subscriptionId=sub-123');
      const response = await GET(request, createAuthContext('jwt'));
      expect(response.status).toBe(500);
      expect((await response.json()).error).toBe('Failed to fetch credit status');
    });
  });
});
