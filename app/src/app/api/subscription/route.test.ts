import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';

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

describe('GET /api/subscription', () => {
  let mockClient: any;
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      getSubscriptions: vi.fn(),
      getEntitlements: vi.fn(),
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
      const request = new NextRequest('http://localhost/api/subscription');
      const authContext = createAuthContext();

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication token required');
    });
  });

  describe('Subscription prioritization', () => {
    it('should return airoPlus plan when multiple subscriptions exist', async () => {
      const request = new NextRequest('http://localhost/api/subscription');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([
        {
          id: 'sub-free',
          productId: 'FreeAppBuilderProduct',
          status: 'active',
          isTrial: false,
          plan: SubscriptionPlan.Free,
        },
        {
          id: 'sub-plus',
          productId: 'aab-v1',
          status: 'active',
          isTrial: false,
          plan: SubscriptionPlan.AiroPlus,
        },
      ]);

      mockClient.getEntitlements.mockResolvedValue({
        id: 'sub-plus',
        productId: 'aab-v1',
        customerId: 'test-customer-123',
        status: 'active',
        isTrial: false,
        plan: SubscriptionPlan.AiroPlus,
        entitlementId: 'ent-123',
        builderEntitlementId: 'builder-ent-456',
        renewsAt: '2026-03-27T14:52:16.000Z',
      });

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscription.plan).toBe(SubscriptionPlan.AiroPlus);
      expect(data.data.subscription.builderEntitlementId).toBe('builder-ent-456');
    });

    it('should return starter plan over free plan', async () => {
      const request = new NextRequest('http://localhost/api/subscription');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([
        {
          id: 'sub-free',
          productId: 'FreeAppBuilderProduct',
          status: 'active',
          isTrial: false,
          plan: SubscriptionPlan.Free,
        },
        {
          id: 'sub-starter',
          productId: 'aab-v1',
          status: 'active',
          isTrial: false,
          plan: SubscriptionPlan.Starter,
        },
      ]);

      mockClient.getEntitlements.mockResolvedValue({
        id: 'sub-starter',
        productId: 'aab-v1',
        customerId: 'test-customer-123',
        status: 'active',
        isTrial: false,
        plan: SubscriptionPlan.Starter,
        builderEntitlementId: 'builder-ent-789',
      });

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.subscription.plan).toBe(SubscriptionPlan.Starter);
    });
  });

  describe('Legacy product ID mapping', () => {
    it('should map aab-v1 to airoPlus plan', async () => {
      const request = new NextRequest('http://localhost/api/subscription');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([
        {
          id: 'sub-legacy',
          productId: 'aab-v1',
          status: 'active',
          isTrial: false,
          // No plan field - testing legacy subscription
        },
      ]);

      mockClient.getEntitlements.mockRejectedValue(new Error('Not found'));

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(data.data.subscription.plan).toBe(SubscriptionPlan.AiroPlus);
    });

    it('should map trial subscriptions to free plan', async () => {
      const request = new NextRequest('http://localhost/api/subscription');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([
        {
          id: 'sub-trial',
          productId: 'aab-v1',
          status: 'active',
          isTrial: true,
        },
      ]);

      mockClient.getEntitlements.mockRejectedValue(new Error('Not found'));

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(data.data.subscription.plan).toBe(SubscriptionPlan.Free);
    });
  });

  describe('No subscription scenarios', () => {
    it('should return default free plan when no subscriptions exist', async () => {
      const request = new NextRequest('http://localhost/api/subscription');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([]);

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscription.plan).toBe(SubscriptionPlan.Free);
      expect(data.data.subscription.status).toBe('active');
      expect(data.data.subscription.customerId).toBe('test-customer-123');
    });
  });

  describe('Error handling', () => {
    it('should return subscription without full details if getEntitlements fails', async () => {
      const request = new NextRequest('http://localhost/api/subscription');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockResolvedValue([
        {
          id: 'sub-1',
          productId: 'aab-v1',
          status: 'active',
          isTrial: false,
          plan: SubscriptionPlan.AiroPlus,
        },
      ]);

      mockClient.getEntitlements.mockRejectedValue(new Error('API error'));

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscription.plan).toBe(SubscriptionPlan.AiroPlus);
      expect(data.data.subscription.id).toBe('sub-1');
    });

    it('should return 500 if getSubscriptions fails', async () => {
      const request = new NextRequest('http://localhost/api/subscription');
      const authContext = createAuthContext('jwt-token');

      mockClient.getSubscriptions.mockRejectedValue(new Error('Network error'));

      const response = await GET(request, authContext);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch subscription data');
    });
  });
});
