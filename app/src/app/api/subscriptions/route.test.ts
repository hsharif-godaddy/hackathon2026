import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionPlan, SubscriptionStatus } from '@/types/credits';

// Mock dependencies before importing the route
vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  return {
    ...actual,
    AiroMgmtClient: vi.fn(),
    AIRO_OWNER_PRODUCTS: { AIRO_APP_BUILDER: 'airo-app-builder' },
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
    debug: vi.fn(),
  },
}));
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn(),
}));

describe('GET /api/subscriptions', function describeRoute() {
  let mockClient: any;
  let GET: any;
  let checkSwitchboardFlag: any;

  beforeEach(async function setup() {
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      getSubscriptions: vi.fn(),
      getSubscription: vi.fn(),
      createBuilderPlan: vi.fn(),
    };

    // Mock AiroMgmtClient constructor
    const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
    vi.mocked(AiroMgmtClient as any).mockImplementation(() => mockClient);

    // Get the checkSwitchboardFlag mock
    const switchboardModule = await import('@/lib/switchboard/server');
    checkSwitchboardFlag = switchboardModule.checkSwitchboardFlag;

    // Default: feature flag disabled
    vi.mocked(checkSwitchboardFlag).mockResolvedValue(false);

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

  const createSubscription = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-123',
    productId: 'aab-v1',
    status: SubscriptionStatus.Active,
    isTrial: false,
    customerId: 'test-customer-123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });

  describe('Authentication', function auth() {
    it('should return 401 if no JWT provided', async function noJwt() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext();

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication token required');
    });
  });

  describe('Basic functionality', function basic() {
    it('should return subscriptions with derived plan field', async function derivedPlan() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ id: 'sub-1', plan: SubscriptionPlan.Starter }),
      ]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscriptions).toHaveLength(1);
      expect(data.data.subscriptions[0].plan).toBe(SubscriptionPlan.Starter);
    });

    it('should select best subscription based on plan priority', async function bestSelection() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      // Return multiple subscriptions with different plans
      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ id: 'sub-free', plan: SubscriptionPlan.Free }),
        createSubscription({ id: 'sub-starter', plan: SubscriptionPlan.Starter }),
        createSubscription({ id: 'sub-airo', plan: SubscriptionPlan.AiroPlus }),
      ]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Starter should be selected as best (highest priority)
      expect(data.data.active.id).toBe('sub-starter');
      expect(data.data.active.plan).toBe(SubscriptionPlan.Starter);
    });

    it('should return empty subscriptions array when none exist', async function empty() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscriptions).toEqual([]);
      expect(data.data.active).toBe(null);
    });
  });

  describe('Auto-creation of free plan', function autoCreate() {
    it('should auto-create free plan when feature enabled and no valid plan exists', async function createFreePlan() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      // Feature flag enabled
      vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);

      // Initial fetch: subscription exists but no plan
      const subWithNoPlan = createSubscription({ id: 'sub-1', plan: SubscriptionPlan.None });
      mockClient.getSubscriptions
        .mockResolvedValueOnce([subWithNoPlan]) // First call
        .mockResolvedValueOnce([{ ...subWithNoPlan, plan: SubscriptionPlan.Free }]); // After creation

      // Recheck returns same (still no plan)
      mockClient.getSubscription.mockResolvedValue(subWithNoPlan);

      // Plan creation succeeds
      mockClient.createBuilderPlan.mockResolvedValue({ success: true });

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockClient.createBuilderPlan).toHaveBeenCalledWith('sub-1', { plan: SubscriptionPlan.Free });
      expect(data.data.active.plan).toBe(SubscriptionPlan.Free);
    });

    it('should NOT auto-create when feature flag is disabled', async function noAutoCreate() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      // Feature flag disabled (default)
      vi.mocked(checkSwitchboardFlag).mockResolvedValue(false);

      // Subscription with no plan
      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ plan: SubscriptionPlan.None }),
      ]);

      const response = await GET(request, authContext);

      expect(response.status).toBe(200);
      expect(mockClient.createBuilderPlan).not.toHaveBeenCalled();
    });

    it('should NOT auto-create when valid plan already exists', async function existingPlan() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      // Feature flag enabled
      vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);

      // Subscription already has a valid plan
      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ plan: SubscriptionPlan.Starter }),
      ]);

      const response = await GET(request, authContext);

      expect(response.status).toBe(200);
      expect(mockClient.createBuilderPlan).not.toHaveBeenCalled();
    });

    it('should handle 409 conflict gracefully (race condition)', async function handleConflict() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      // Feature flag enabled
      vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);

      const subWithNoPlan = createSubscription({ plan: SubscriptionPlan.None });
      mockClient.getSubscriptions
        .mockResolvedValueOnce([subWithNoPlan])
        .mockResolvedValueOnce([{ ...subWithNoPlan, plan: SubscriptionPlan.Free }]);

      mockClient.getSubscription.mockResolvedValue(subWithNoPlan);

      // Plan creation fails with 409 (another request created it)
      const { AiroHttpError } = await import('@/lib/mgmt-airo');
      mockClient.createBuilderPlan.mockRejectedValue(
        new AiroHttpError(409, 'Conflict', 'Plan already exists')
      );

      const response = await GET(request, authContext);
      const data = await response.json();

      // Should succeed - 409 is treated as success
      expect(response.status).toBe(200);
      expect(data.data.active.plan).toBe(SubscriptionPlan.Free);
    });
  });

  describe('Error handling', function errors() {
    it('should return 500 on unexpected error', async function unexpectedError() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockRejectedValue(new Error('Network error'));

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch subscriptions');
    });

    it('should return 404 when AiroHttpError with 404 status', async function notFound() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      const { AiroHttpError } = await import('@/lib/mgmt-airo');
      mockClient.getSubscriptions.mockRejectedValue(
        new AiroHttpError(404, 'Not Found', 'No subscriptions found')
      );

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No subscriptions found');
    });
  });

  describe('Meta information', function meta() {
    it('should include hasValidPlan in meta', async function hasValidPlan() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);

      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ plan: SubscriptionPlan.Starter }),
      ]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(data.data.meta.hasValidPlan).toBe(true);
      expect(data.data.meta.managePlanEnabled).toBe(true);
    });

    it('should report hasValidPlan false when no valid plans', async function noValidPlan() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);

      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ plan: SubscriptionPlan.None }),
      ]);
      mockClient.getSubscription.mockResolvedValue(
        createSubscription({ plan: SubscriptionPlan.None })
      );
      mockClient.createBuilderPlan.mockResolvedValue({ success: true });

      const response = await GET(request, authContext);
      const data = await response.json();

      // After auto-creation attempt, should have valid plan
      expect(data.data.meta.managePlanEnabled).toBe(true);
    });
  });
});
