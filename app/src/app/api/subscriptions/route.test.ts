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
    it('should include grantsEnabled in meta when flag is enabled', async function grantsEnabled() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);

      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ plan: SubscriptionPlan.Starter }),
      ]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(data.data.meta.grantsEnabled).toBe(true);
    });

    it('should include grantsEnabled false in meta when flag is disabled', async function grantsDisabled() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      vi.mocked(checkSwitchboardFlag).mockResolvedValue(false);

      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ plan: SubscriptionPlan.None }),
      ]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(data.data.meta.grantsEnabled).toBe(false);
    });
  });
});
