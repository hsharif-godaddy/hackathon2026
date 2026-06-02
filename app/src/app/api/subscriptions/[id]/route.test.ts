import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';

// Mock dependencies before importing the route
vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
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

describe('GET /api/subscriptions/[id]', function describeRoute() {
  let mockClient: any;
  let GET: any;

  beforeEach(async function setup() {
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      getSubscription: vi.fn(),
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

  const createRequest = () => new NextRequest('http://localhost/api/subscriptions/sub-123', {
    headers: { host: 'builder.godaddy.com' },
  });

  describe('Authentication', function auth() {
    it('should return 401 if no JWT provided', async function noJwt() {
      const request = createRequest();
      const authContext = createAuthContext();
      const params = Promise.resolve({ id: 'sub-123' });

      const response = await GET(request, authContext, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication token required');
    });
  });

  describe('Validation', function validation() {
    it('should return 400 if subscription ID is missing', async function noId() {
      const request = createRequest();
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: '' });

      const response = await GET(request, authContext, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Subscription ID is required');
    });
  });

  describe('Authorization', function authorization() {
    it('should return 403 if subscription belongs to different customer', async function wrongCustomer() {
      const request = createRequest();
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: 'sub-123' });

      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        productId: 'aab-v1',
        status: 'active',
        isTrial: false,
        customerId: 'different-customer-456',
        entitlementId: 'ent-123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const response = await GET(request, authContext, { params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden: Subscription does not belong to your account');
    });
  });

  describe('Include attributes', function includeAttrs() {
    it('should pass includeAttributes when ?include=attributes is set', async function withAttributes() {
      const request = new NextRequest('http://localhost/api/subscriptions/sub-123?include=attributes');
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: 'sub-123' });

      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123', productId: 'aab-v1', status: 'active', isTrial: true,
        customerId: 'test-customer-123', createdAt: '2024-01-01', updatedAt: '2024-01-01',
        attributes: [{ id: 'attr-1', key: 'free-plan', value: {} }],
      });

      const response = await GET(request, authContext, { params });

      expect(response.status).toBe(200);
      // Attributes read drives the conversion-event decision, so it must bypass
      // cache — a stale subscription missing a freshly provisioned attribute would
      // defeat client polling (see the noCache rationale in route.ts).
      expect(mockClient.getSubscription).toHaveBeenCalledWith('sub-123', { includeAttributes: true, noCache: true });
    });

    it('should not pass includeAttributes for non-attributes include value', async function otherInclude() {
      const request = new NextRequest('http://localhost/api/subscriptions/sub-123?include=metadata');
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: 'sub-123' });

      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123', productId: 'aab-v1', status: 'active', isTrial: false,
        customerId: 'test-customer-123', createdAt: '2024-01-01', updatedAt: '2024-01-01',
      });

      const response = await GET(request, authContext, { params });

      expect(response.status).toBe(200);
      expect(mockClient.getSubscription).toHaveBeenCalledWith('sub-123', { includeAttributes: false });
    });

    it('should not pass includeAttributes by default', async function withoutAttributes() {
      const request = createRequest();
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: 'sub-123' });

      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123', productId: 'aab-v1', status: 'active', isTrial: false,
        customerId: 'test-customer-123', createdAt: '2024-01-01', updatedAt: '2024-01-01',
      });

      const response = await GET(request, authContext, { params });

      expect(response.status).toBe(200);
      expect(mockClient.getSubscription).toHaveBeenCalledWith('sub-123', { includeAttributes: false });
    });
  });

  describe('Success cases', function success() {
    it('should return subscription with derived plan field', async function withPlan() {
      const request = createRequest();
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: 'sub-123' });

      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-123',
        productId: 'aab-v1',
        status: 'active',
        isTrial: false,
        customerId: 'test-customer-123',
        hadAiroPlus: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const response = await GET(request, authContext, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        id: 'sub-123',
        productId: 'aab-v1',
        status: 'active',
        plan: SubscriptionPlan.AiroPlus, // Derived from productId + hadAiroPlus
      });
    });

    it('should handle subscription with explicit plan field', async function explicitPlan() {
      const request = createRequest();
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: 'sub-456' });

      mockClient.getSubscription.mockResolvedValue({
        id: 'sub-456',
        productId: 'aab-v1',
        status: 'active',
        isTrial: false,
        plan: SubscriptionPlan.Starter,
        customerId: 'test-customer-123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const response = await GET(request, authContext, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.plan).toBe(SubscriptionPlan.Starter);
    });
  });

  describe('Error cases', function errors() {
    it('should return 404 when subscription not found', async function notFound() {
      const request = createRequest();
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: 'non-existent' });

      const { AiroHttpError } = await import('@/lib/mgmt-airo');
      mockClient.getSubscription.mockRejectedValue(
        new AiroHttpError(404, 'Not Found', 'Subscription not found')
      );

      const response = await GET(request, authContext, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Subscription not found');
    });

    it('should return 500 on unexpected error', async function unexpectedError() {
      const request = createRequest();
      const authContext = createAuthContext('jwt-token');
      const params = Promise.resolve({ id: 'sub-123' });

      mockClient.getSubscription.mockRejectedValue(new Error('Unexpected error'));

      const response = await GET(request, authContext, { params });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch subscription');
    });
  });
});
