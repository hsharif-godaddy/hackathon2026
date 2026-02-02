import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroGrantFinalState, AiroGrantType, type AiroCreditGrant } from '@/lib/mgmt-airo';

// Mock dependencies before importing the route
vi.mock('@/lib/mgmt-airo');
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => handler,
}));
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('GET /api/credits/grants', () => {
  let mockClient: any;
  let GET: any;

  const MOCK_GRANTS: AiroCreditGrant[] = [
    {
      id: 'grant-1',
      subscriptionId: 'sub-123',
      type: AiroGrantType.PlanMonthly,
      llmBudgetUserId: 'airo-builder:grant:grant-1',
      llmBudgetId: 'budget-123',
      creditsMax: 1500,
      creditsSpent: 500,
      isAvailable: true,
      finalState: null,
      useBefore: '2026-02-09T00:00:00.000Z',
      consumedAt: null,
      createdAt: '2026-01-09T00:00:00.000Z',
      updatedAt: '2026-01-14T00:00:00.000Z',
    },
    {
      id: 'grant-2',
      subscriptionId: 'sub-123',
      type: AiroGrantType.CreditPack,
      llmBudgetUserId: 'airo-builder:grant:grant-2',
      llmBudgetId: 'budget-456',
      creditsMax: 2500,
      creditsSpent: 2500,
      isAvailable: false,
      finalState: AiroGrantFinalState.Consumed,
      useBefore: '2026-02-01T00:00:00.000Z',
      consumedAt: '2026-01-05T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      getCreditGrants: vi.fn(),
    };

    // Mock AiroMgmtClient constructor
    const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
    vi.mocked(AiroMgmtClient as any).mockImplementation(() => mockClient);

    // Import the route handler after mocks are set up
    const routeModule = await import('./route');
    GET = routeModule.GET;
  });

  const createAuthContext = (jwt?: string) => ({
    jwt,
    user: {
      customerId: 'test-customer-123',
      email: 'test@example.com',
    },
  });

  describe('Authentication', () => {
    it('should return 401 if no JWT provided', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext();

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication token required');
    });
  });

  describe('Parameter validation', () => {
    it('should return 400 if subscriptionId is missing', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants');
      const authContext = createAuthContext('jwt-token');

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('subscriptionId query parameter is required');
    });
  });

  describe('Successful responses', () => {
    it('should return grants for subscription', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      mockClient.getCreditGrants.mockResolvedValue(MOCK_GRANTS);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0].id).toBe('grant-1');
      expect(data.data[0].type).toBe(AiroGrantType.PlanMonthly);
      expect(data.data[1].id).toBe('grant-2');
      expect(data.data[1].type).toBe(AiroGrantType.CreditPack);
    });

    it('should pass syncSpend=true by default', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      mockClient.getCreditGrants.mockResolvedValue([]);

      await GET(request, authContext);

      expect(mockClient.getCreditGrants).toHaveBeenCalledWith('sub-123', true);
    });

    it('should pass syncSpend=false when specified', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123&syncSpend=false');
      const authContext = createAuthContext('jwt-token');

      mockClient.getCreditGrants.mockResolvedValue([]);

      await GET(request, authContext);

      expect(mockClient.getCreditGrants).toHaveBeenCalledWith('sub-123', false);
    });

    it('should return empty array when no grants exist', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      mockClient.getCreditGrants.mockResolvedValue([]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
    });
  });

  describe('Error handling', () => {
    it('should return 500 on general error', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      mockClient.getCreditGrants.mockRejectedValue(new Error('Network error'));

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch credit grants');
    });
  });
});
