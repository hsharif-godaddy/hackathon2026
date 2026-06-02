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
describe('GET /api/subscriptions', function describeRoute() {
  let mockClient: any;
  let GET: any;

  beforeEach(async function setup() {
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      getSubscriptions: vi.fn(),
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

    it('should not pass includeAttributes to getSubscriptions', async function noAttributes() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([]);

      await GET(request, authContext);

      expect(mockClient.getSubscriptions).toHaveBeenCalledWith('airo-app-builder');
    });

    it('should prefer active subscription over suspended', async function prefersActive() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      // Return suspended and active subscriptions
      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ id: 'sub-suspended', status: SubscriptionStatus.Suspended, plan: SubscriptionPlan.Starter }),
        createSubscription({ id: 'sub-active', status: SubscriptionStatus.Active, plan: SubscriptionPlan.Starter }),
      ]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Active should be selected over suspended
      expect(data.data.active.id).toBe('sub-active');
      expect(data.data.active.status).toBe(SubscriptionStatus.Active);
    });

    it('should return suspended subscription when no active exists', async function fallsBackToSuspended() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');

      // Return only suspended subscription
      mockClient.getSubscriptions.mockResolvedValue([
        createSubscription({ id: 'sub-suspended', status: SubscriptionStatus.Suspended, plan: SubscriptionPlan.Starter }),
      ]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.active.id).toBe('sub-suspended');
      expect(data.data.active.status).toBe(SubscriptionStatus.Suspended);
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

    it('should log at warn level for 401 auth errors', async function authWarn401() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');
      const { logger } = await import('@/lib/request-context');

      const { AiroHttpError } = await import('@/lib/mgmt-airo');
      mockClient.getSubscriptions.mockRejectedValue(
        new AiroHttpError(401, 'Unauthorized', 'Unauthorized')
      );

      const response = await GET(request, authContext);

      expect(response.status).toBe(401);
      expect(logger.warn).toHaveBeenCalledWith('subscriptions.api.error', expect.objectContaining({ message: 'Failed to fetch subscriptions' }));
      expect(logger.error).not.toHaveBeenCalledWith('subscriptions.api.error', expect.anything());
    });

    it('should return empty subscriptions on 403 (unregistered customer)', async function notRegistered403() {
      const request = new NextRequest('http://localhost/api/subscriptions');
      const authContext = createAuthContext('jwt-token');
      const { logger } = await import('@/lib/request-context');

      const { AiroHttpError } = await import('@/lib/mgmt-airo');
      mockClient.getSubscriptions.mockRejectedValue(
        new AiroHttpError(403, 'Forbidden', 'Customer not registered with Airo')
      );

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscriptions).toEqual([]);
      expect(data.data.active).toBe(null);
      expect(logger.info).toHaveBeenCalledWith('subscriptions.api.not-registered', expect.objectContaining({
        customerId: 'test-customer-123',
      }));
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

});
