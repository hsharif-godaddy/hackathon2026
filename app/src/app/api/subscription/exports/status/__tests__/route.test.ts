/**
 * Subscription Export Status Endpoint Tests
 *
 * Tests the GET /api/subscription/exports/status endpoint.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

const { mockAuthenticateCustomer, mockAiroMgmtClient, mockLogger } = vi.hoisted(function setup() {
  return {
    mockAuthenticateCustomer: vi.fn(),
    mockAiroMgmtClient: {
      getSubscriptions: vi.fn(),
      getExportsStatus: vi.fn()
    },
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }
  };
});

vi.mock('@/lib/mgmt-airo', function mockMgmtAiroModule() {
  return {
    AiroMgmtClient: vi.fn().mockImplementation(function () { return mockAiroMgmtClient; }),
    AIRO_OWNER_PRODUCTS: { AIRO_APP_BUILDER: 'airo-app-builder' }
  };
});

vi.mock('@/lib/request-context', function mockLoggerModule() {
  return {
    logger: mockLogger
  };
});

vi.mock('@/lib/customer-auth', async function mockCustomerAuthModule() {
  const actual = await vi.importActual('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn(function withCustomerAuth(handler) {
      return async function wrappedHandler(request: NextRequest, ...args: any[]) {
        const authContext = await mockAuthenticateCustomer(request);

        if (!authContext.isAuthenticated) {
          return new Response(
            JSON.stringify({
              error: 'Unauthorized',
              message: authContext.error,
              requiresAuth: true
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return handler(request, authContext, ...args);
      };
    })
  };
});

const MOCK_SUBSCRIPTION_ID = 'subscription-123';

const MOCK_USER = {
  shopperId: 'shopper-789',
  customerId: 'customer-789',
  accountId: 'account-456',
  authType: 'sso',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000)
};

const MOCK_ACTIVE_SUBSCRIPTION = {
  id: MOCK_SUBSCRIPTION_ID,
  status: 'active',
  productId: 'airo-plus'
};

const MOCK_STATUS_ELIGIBLE = {
  eligibleForRefund: true,
  lastExportedAt: null,
  totalExports: 0
};

const MOCK_STATUS_NOT_ELIGIBLE = {
  eligibleForRefund: false,
  lastExportedAt: '2025-01-15T10:00:00Z',
  totalExports: 3
};

function createMockRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/subscription/exports/status', {
    method: 'GET'
  });
}

describe('subscription exports status GET', function subscriptionExportsStatusTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    mockAiroMgmtClient.getSubscriptions.mockResolvedValue([MOCK_ACTIVE_SUBSCRIPTION]);
    mockAiroMgmtClient.getExportsStatus.mockResolvedValue(MOCK_STATUS_ELIGIBLE);
  });

  describe('#GET', function getTests() {
    it('should look up subscription and return export status', async function lookupAndReturn() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.eligibleForRefund).toBe(true);
      expect(data.totalExports).toBe(0);

      // Should fetch subscriptions first
      expect(mockAiroMgmtClient.getSubscriptions).toHaveBeenCalledWith('airo-app-builder');

      // Then call getExportsStatus with the subscription ID
      expect(mockAiroMgmtClient.getExportsStatus).toHaveBeenCalledWith(MOCK_SUBSCRIPTION_ID);
    });

    it('should return not eligible when exports exist', async function hasExports() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockAiroMgmtClient.getExportsStatus.mockResolvedValue(MOCK_STATUS_NOT_ELIGIBLE);

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.eligibleForRefund).toBe(false);
      expect(data.lastExportedAt).toBe('2025-01-15T10:00:00Z');
      expect(data.totalExports).toBe(3);
    });

    it('should return default status when no active subscription', async function noSubscription() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockAiroMgmtClient.getSubscriptions.mockResolvedValue([]);

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.eligibleForRefund).toBe(false);
      expect(data.lastExportedAt).toBeNull();
      expect(data.totalExports).toBe(0);
      expect(data.message).toBe('No active subscription found');

      // Should NOT call getExportsStatus when no subscription
      expect(mockAiroMgmtClient.getExportsStatus).not.toHaveBeenCalled();
    });

    it('should skip inactive subscriptions', async function inactiveSubscription() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockAiroMgmtClient.getSubscriptions.mockResolvedValue([
        { id: 'inactive-sub', status: 'cancelled', productId: 'airo-plus' }
      ]);

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('No active subscription found');
      expect(mockAiroMgmtClient.getExportsStatus).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', async function notAuthenticated() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: false,
        error: 'Invalid token'
      });

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 when JWT is missing', async function missingJwt() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: null
      });

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication token required');
    });

    it('should return 500 on MHP-Airo error', async function apiError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockAiroMgmtClient.getExportsStatus.mockRejectedValue(new Error('API unavailable'));

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch export status');
    });

    it('should log start and success events', async function logging() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest();
      await GET(request);

      expect(mockLogger.info).toHaveBeenCalledWith('subscription.exports.status.start', expect.objectContaining({
        customerId: 'customer-789'
      }));

      expect(mockLogger.info).toHaveBeenCalledWith('subscription.exports.status.success', expect.objectContaining({
        customerId: 'customer-789',
        subscriptionId: MOCK_SUBSCRIPTION_ID,
        eligibleForRefund: true,
        totalExports: 0
      }));
    });
  });
});
