import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BudgetServiceAuthError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
} from '@airo/shared/budget';

import { type AiroCreditGrant, AiroGrantFinalState, AiroGrantType } from '@/lib/mgmt-airo';
import { CreditsSource } from '@/types/credits';

// Mock dependencies before importing the route
vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual('@/lib/mgmt-airo');
  return {
    ...actual,
    AiroMgmtClient: vi.fn(),
  };
});
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
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/budget-service/client', () => ({
  getBudgetServiceClient: vi.fn().mockReturnValue(null),
}));
vi.mock('@/utils/getRootDomain', () => ({
  getRootDomainFromHeaders: vi.fn().mockReturnValue('test-godaddy.com'),
}));
vi.mock('@/lib/credit-adapter', () => ({
  adaptBudgetToGrants: vi.fn(),
}));

const { mockFetchHivemindCohorts } = vi.hoisted(function setup() {
  return { mockFetchHivemindCohorts: vi.fn().mockResolvedValue({}) };
});

vi.mock('@/lib/budget-service-experiment', async function mockBudgetExperimentModule() {
  const actual = await vi.importActual<typeof import('@/lib/budget-service-experiment')>(
    '@/lib/budget-service-experiment',
  );
  return {
    ...actual,
    fetchHivemindCohorts: mockFetchHivemindCohorts,
    logBudgetServiceExperimentTriggered: vi.fn(),
  };
});

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
      getSubscription: vi.fn().mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: null, // No BMS budget by default - uses grants path
      }),
    };

    // Mock AiroMgmtClient constructor
    const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
    vi.mocked(AiroMgmtClient as any).mockImplementation(function () { return mockClient; });

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

  describe('BMS path (three-lever check: both flags ON + migrated subscription)', () => {
    let mockBudgetClient: any;
    let mockAdaptBudgetToGrants: any;
    let mockCheckSwitchboardFlag: any;
    let mockGetBudgetServiceClient: any;

    beforeEach(async () => {
      // Reset mocks to enable BMS path
      const { checkSwitchboardFlag } = await import('@/lib/switchboard/server');
      const { getBudgetServiceClient } = await import('@/lib/budget-service/client');
      const { adaptBudgetToGrants } = await import('@/lib/credit-adapter');

      mockCheckSwitchboardFlag = vi.mocked(checkSwitchboardFlag);
      mockGetBudgetServiceClient = vi.mocked(getBudgetServiceClient);
      mockAdaptBudgetToGrants = vi.mocked(adaptBudgetToGrants);

      mockBudgetClient = {
        getBudget: vi.fn(),
      };

      // Enable BMS: both flags ON + subscription has bmsBudgetId + migration attribute + client available
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockGetBudgetServiceClient.mockReturnValue(mockBudgetClient);
      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: 'budget-uuid-123',
        attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }],
      });
    });

    it('should use BMS path when both flags enabled and subscription is fully migrated', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      const mockBudget = {
        budgetId: 'budget-uuid-123',
        items: [{ budgetItemId: 'item-1', creditsTotal: '1000', creditsUsed: '500' }],
      };
      const mockAdaptedGrants = [
        { id: 'grant-1', type: AiroGrantType.PlanMonthly, creditsMax: 1000, creditsSpent: 500 },
      ];

      mockBudgetClient.getBudget.mockResolvedValue(mockBudget);
      mockAdaptBudgetToGrants.mockReturnValue(mockAdaptedGrants);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.source).toBe(CreditsSource.Bms);
      expect(data.data).toEqual(mockAdaptedGrants);
      // Uses bmsBudgetId from subscription
      expect(mockBudgetClient.getBudget).toHaveBeenCalledWith('budget-uuid-123');
      expect(mockAdaptBudgetToGrants).toHaveBeenCalledWith(mockBudget, 'sub-123');
      // Should NOT call legacy grants API
      expect(mockClient.getCreditGrants).not.toHaveBeenCalled();
    });

    it('should fall back to grants when subscription has no bmsBudgetId (migration not complete)', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      // Subscription has migration attribute but no bmsBudgetId
      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: null,
        attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }],
      });
      mockClient.getCreditGrants.mockResolvedValue(MOCK_GRANTS);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.source).toBe(CreditsSource.Grants);
      expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
      expect(mockClient.getCreditGrants).toHaveBeenCalled();
    });

    it('should use BMS for NEW user (bmsBudgetId present, no migration attribute) when cohort is on', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      mockFetchHivemindCohorts.mockResolvedValue({ 'airo-app-builder-budget-service-launch': { cohortId: 'on' } });

      // Subscription has bmsBudgetId but no migration attribute = NEW user
      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: 'budget-uuid-123',
        attributes: [],
      });

      const mockBudget = {
        budgetId: 'budget-uuid-123',
        items: [{ budgetItemId: 'item-1', creditsTotal: '1000', creditsUsed: '500' }],
      };
      const mockAdaptedGrants = [
        { id: 'grant-1', type: 'plan_monthly', creditsMax: 1000, creditsSpent: 500 },
      ];

      mockBudgetClient.getBudget.mockResolvedValue(mockBudget);
      mockAdaptBudgetToGrants.mockReturnValue(mockAdaptedGrants);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.source).toBe(CreditsSource.Bms);
      expect(mockBudgetClient.getBudget).toHaveBeenCalledWith('budget-uuid-123');
      expect(mockClient.getCreditGrants).not.toHaveBeenCalled();
    });

    it('should fall back to grants for NEW user when cohort is off', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      mockFetchHivemindCohorts.mockResolvedValue({ 'airo-app-builder-budget-service-launch': { cohortId: 'off' } });
      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: 'budget-uuid-123',
        attributes: [],
      });
      mockClient.getCreditGrants.mockResolvedValue(MOCK_GRANTS);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.source).toBe(CreditsSource.Grants);
      expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
      expect(mockClient.getCreditGrants).toHaveBeenCalled();
    });

    it('should use BMS for EXISTING migrated user even when experiment cohort is off', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      // Cohort explicitly 'off' (control for new-user experiment) — must not suppress BMS for migrated users
      mockFetchHivemindCohorts.mockResolvedValue({ 'airo-app-builder-budget-service-launch': { cohortId: 'off' } });

      // bmsExistingEnabled=true; budgetServiceEnabled=true but cohort=off so experiment disabled
      mockCheckSwitchboardFlag.mockImplementation(function (flag: string) {
        if (flag === 'app-builder-budget-service') return Promise.resolve(true);
        if (flag === 'app-builder-bms-existing') return Promise.resolve(true);
        return Promise.resolve(false);
      });

      // Subscription is fully migrated: bms-migration attribute + bmsBudgetId
      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: 'budget-uuid-123',
        attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }],
      });

      const mockBudget = {
        budgetId: 'budget-uuid-123',
        items: [{ budgetItemId: 'item-1', creditsTotal: '1000', creditsUsed: '500' }],
      };
      const mockAdaptedGrants = [
        { id: 'grant-1', type: AiroGrantType.PlanMonthly, creditsMax: 1000, creditsSpent: 500 },
      ];

      mockBudgetClient.getBudget.mockResolvedValue(mockBudget);
      mockAdaptBudgetToGrants.mockReturnValue(mockAdaptedGrants);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.source).toBe(CreditsSource.Bms);
      expect(mockBudgetClient.getBudget).toHaveBeenCalledWith('budget-uuid-123');
      expect(mockClient.getCreditGrants).not.toHaveBeenCalled();
    });

    it('should fall back to grants for NEW user when cohort is ineligible', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      mockFetchHivemindCohorts.mockResolvedValue({ 'airo-app-builder-budget-service-launch': { cohortId: 'ineligible' } });
      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: 'budget-uuid-123',
        attributes: [],
      });
      mockClient.getCreditGrants.mockResolvedValue(MOCK_GRANTS);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.source).toBe(CreditsSource.Grants);
      expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
      expect(mockClient.getCreditGrants).toHaveBeenCalled();
    });

    it('should fall back to grants for NEW user when budgetServiceEnabled is false', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      mockFetchHivemindCohorts.mockResolvedValue({ 'airo-app-builder-budget-service-launch': { cohortId: 'on' } });

      // Only bmsExistingEnabled is true, but this is a NEW user (no migration attribute)
      mockCheckSwitchboardFlag.mockImplementation(function (flag: string) {
        if (flag === 'app-builder-budget-service') return Promise.resolve(false);
        if (flag === 'app-builder-bms-existing') return Promise.resolve(true);
        return Promise.resolve(false);
      });

      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: 'budget-uuid-123',
        attributes: [], // No migration attribute = NEW user
      });
      mockClient.getCreditGrants.mockResolvedValue(MOCK_GRANTS);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.source).toBe(CreditsSource.Grants);
      expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
      expect(mockClient.getCreditGrants).toHaveBeenCalled();
    });

    it('should fall back to grants for EXISTING user when bmsExistingEnabled is false', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      // Only budgetServiceEnabled is true, but this is an EXISTING user (has migration attribute)
      mockCheckSwitchboardFlag.mockImplementation(function (flag: string) {
        if (flag === 'app-builder-budget-service') return Promise.resolve(true);
        if (flag === 'app-builder-bms-existing') return Promise.resolve(false);
        return Promise.resolve(false);
      });

      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        bmsBudgetId: 'budget-uuid-123',
        attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }],
      });
      mockClient.getCreditGrants.mockResolvedValue(MOCK_GRANTS);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.source).toBe(CreditsSource.Grants);
      expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
      expect(mockClient.getCreditGrants).toHaveBeenCalled();
    });

    it('should fall back to grants path when budget client unavailable', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      // Budget client unavailable
      mockGetBudgetServiceClient.mockReturnValue(null);
      mockClient.getCreditGrants.mockResolvedValue(MOCK_GRANTS);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.source).toBe(CreditsSource.Grants);
      expect(mockClient.getCreditGrants).toHaveBeenCalled();
    });

    it('should fall back to grants path when flag disabled', async () => {
      const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
      const authContext = createAuthContext('jwt-token');

      // Flag disabled
      mockCheckSwitchboardFlag.mockResolvedValue(false);
      mockClient.getCreditGrants.mockResolvedValue(MOCK_GRANTS);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.source).toBe(CreditsSource.Grants);
      expect(mockClient.getCreditGrants).toHaveBeenCalledWith('sub-123', true);
      expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
    });

    describe('BMS error handling', () => {
      it('should return 401 on BudgetServiceAuthError', async () => {
        const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
        const authContext = createAuthContext('jwt-token');

        mockBudgetClient.getBudget.mockRejectedValue(new BudgetServiceAuthError('Auth failed', 401, ''));

        const response = await GET(request, authContext);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('Budget service authentication failed');
      });

      it('should return 504 on BudgetServiceTimeoutError', async () => {
        const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
        const authContext = createAuthContext('jwt-token');

        mockBudgetClient.getBudget.mockRejectedValue(new BudgetServiceTimeoutError('Timeout'));

        const response = await GET(request, authContext);
        const data = await response.json();

        expect(response.status).toBe(504);
        expect(data.error).toBe('Budget service request timed out');
      });

      it('should return 503 on BudgetServiceUnavailableError', async () => {
        const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
        const authContext = createAuthContext('jwt-token');

        mockBudgetClient.getBudget.mockRejectedValue(new BudgetServiceUnavailableError('Unavailable'));

        const response = await GET(request, authContext);
        const data = await response.json();

        expect(response.status).toBe(503);
        expect(data.error).toBe('Budget service unavailable');
      });

      it('should return 500 on generic BudgetServiceError', async () => {
        const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
        const authContext = createAuthContext('jwt-token');

        mockBudgetClient.getBudget.mockRejectedValue(new BudgetServiceError('Generic error', 500, ''));

        const response = await GET(request, authContext);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Budget service error');
      });

      it('should use statusCode from BudgetServiceError when available', async () => {
        const request = new NextRequest('http://localhost/api/credits/grants?subscriptionId=sub-123');
        const authContext = createAuthContext('jwt-token');

        mockBudgetClient.getBudget.mockRejectedValue(new BudgetServiceError('Rate limited', 429, ''));

        const response = await GET(request, authContext);
        const data = await response.json();

        expect(response.status).toBe(429);
        expect(data.error).toBe('Budget service error');
      });
    });
  });
});
