/**
 * Deployments Endpoint Tests
 *
 * Tests the POST /api/apps/[id]/deployments endpoint to ensure proper:
 * - Authentication and authorization
 * - Site ownership validation
 * - V2 deployment record creation
 * - Legacy/dev site handling
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroHttpError } from '@/lib/mgmt-airo';
import { POST } from '../route';

/**
 * Mock dependencies using vi.hoisted to avoid hoisting issues
 */
const { mockControlPlaneAdapter, mockAuthenticateCustomer, mockAiroMgmtClient, mockLogger } = vi.hoisted(function setup() {
  return {
    mockControlPlaneAdapter: {
      getSite: vi.fn()
    },
    mockAuthenticateCustomer: vi.fn(),
    mockAiroMgmtClient: {
      publishApp: vi.fn()
    },
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    }
  };
});

/**
 * Mock control plane adapter
 */
vi.mock('@/lib/control-plane', function mockControlPlaneModule() {
  return {
    getControlPlaneAdapter: vi.fn().mockReturnValue(mockControlPlaneAdapter),
  };
});

/**
 * Mock mgmt-airo client
 */
vi.mock('@/lib/mgmt-airo', async function mockMgmtAiroModule() {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  return {
    ...actual,
    AiroMgmtClient: vi.fn().mockImplementation(function () { return mockAiroMgmtClient; })
  };
});

/**
 * Mock logger
 */
vi.mock('@/lib/request-context', function mockLoggerModule() {
  return {
    logger: mockLogger
  };
});

/**
 * Mock customer auth
 */
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
    }),
    customerHasAccount: vi.fn(function hasAccount(user) {
      return !!user.accountId;
    }),
    createCustomerAuthError: vi.fn(function createError(message, status) {
      return new Response(
        JSON.stringify({ error: message }),
        { status, headers: { 'Content-Type': 'application/json' } }
      );
    })
  };
});

/**
 * Test fixtures
 */
const MOCK_SITE_ID = 'site-123';
const MOCK_ACCOUNT_ID = 'account-456';
const MOCK_SUBSCRIPTION_ID = 'subscription-789';
const MOCK_SYSTEM_ID = 'system-012';
const MOCK_GIT_HASH = 'a1b2c3d4e5f6789012345678901234567890abcd';

const MOCK_USER = {
  shopperId: 'shopper-789',
  customerId: 'customer-789',
  accountId: MOCK_ACCOUNT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000)
};

const MOCK_V2_SITE = {
  id: MOCK_SITE_ID,
  account_id: MOCK_ACCOUNT_ID,
  name: 'Test Site',
  status: 'running' as const,
  agent_url: 'https://agent.example.com',
  preview_url: 'https://preview.example.com',
  subscription_id: MOCK_SUBSCRIPTION_ID,
  system_id: MOCK_SYSTEM_ID,
  created_at: new Date(),
  updated_at: new Date()
};

const MOCK_LEGACY_SITE = {
  id: MOCK_SITE_ID,
  account_id: MOCK_ACCOUNT_ID,
  name: 'Legacy Site',
  status: 'running' as const,
  agent_url: 'https://agent.example.com',
  preview_url: 'https://preview.example.com',
  created_at: new Date(),
  updated_at: new Date()
  // No subscription_id or system_id
};

const MOCK_DEPLOYMENT_RESPONSE = {
  deploymentId: 'deployment-123',
  statusJobId: 'job-456',
  status: 'pending',
  message: 'Deployment created',
  subscriptionId: MOCK_SUBSCRIPTION_ID,
  systemId: MOCK_SYSTEM_ID,
  appId: MOCK_SITE_ID,
  gitHash: MOCK_GIT_HASH
};

/**
 * Helper to create mock NextRequest
 */
function createMockRequest(siteId: string, body: any, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000/api/apps/${siteId}/deployments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

describe('deployments POST', function packageTests() {
  describe('#POST', function postTests() {
    beforeEach(function resetMocks() {
      vi.clearAllMocks();

      // Default mock implementations
      mockAiroMgmtClient.publishApp.mockResolvedValue(MOCK_DEPLOYMENT_RESPONSE);
    });

    it('should create deployment for V2 site with valid subscription/system IDs', async function createDeployment() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const request = createMockRequest(MOCK_SITE_ID, { dnsUpdateConsent: false, gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        deploymentId: MOCK_DEPLOYMENT_RESPONSE.deploymentId,
        statusJobId: MOCK_DEPLOYMENT_RESPONSE.statusJobId,
        status: MOCK_DEPLOYMENT_RESPONSE.status,
        message: MOCK_DEPLOYMENT_RESPONSE.message
      });

      expect(mockControlPlaneAdapter.getSite).toHaveBeenCalledWith(MOCK_SITE_ID, 'user-jwt-token');
      expect(mockAiroMgmtClient.publishApp).toHaveBeenCalledWith(
        MOCK_SUBSCRIPTION_ID,
        MOCK_SYSTEM_ID,
        MOCK_SITE_ID,
        MOCK_GIT_HASH,
        false
      );
      expect(mockLogger.info).toHaveBeenCalledWith('deployments.api.create.start', expect.any(Object));
      expect(mockLogger.info).toHaveBeenCalledWith('deployments.api.create.success', expect.any(Object));
    });

    it('should pass undefined dnsUpdateConsent when omitted from request body', async function createsDeploymentWithoutConsentField() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });

      expect(response.status).toBe(200);
      expect(mockAiroMgmtClient.publishApp).toHaveBeenCalledWith(
        MOCK_SUBSCRIPTION_ID,
        MOCK_SYSTEM_ID,
        MOCK_SITE_ID,
        MOCK_GIT_HASH,
        undefined
      );
    });

    it('should pass dnsUpdateConsent true when requested', async function createsDeploymentWithDnsConsentTrue() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const request = createMockRequest(MOCK_SITE_ID, { dnsUpdateConsent: true, gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });

      expect(response.status).toBe(200);
      expect(mockAiroMgmtClient.publishApp).toHaveBeenCalledWith(
        MOCK_SUBSCRIPTION_ID,
        MOCK_SYSTEM_ID,
        MOCK_SITE_ID,
        MOCK_GIT_HASH,
        true
      );
    });

    it('should return 400 when request body is invalid JSON', async function invalidJson() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      // Create a request with invalid JSON
      const request = new NextRequest(`http://localhost:3000/api/apps/${MOCK_SITE_ID}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{'
      });

      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request body');
      expect(mockLogger.error).toHaveBeenCalledWith('deployments.api.create.parse-error', expect.any(Object));
    });

    it('should return 400 when gitHash is missing', async function missingGitHash() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest(MOCK_SITE_ID, {});
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('gitHash is required');
    });

    it('should return 400 when dnsUpdateConsent is not boolean', async function invalidDnsUpdateConsentType() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest(MOCK_SITE_ID, { dnsUpdateConsent: 'false', gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid dnsUpdateConsent: expected boolean');
    });

    it('should return 400 when siteId is missing', async function missingSiteId() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest('', { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: '' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Site ID is required');
    });

    it('should return 404 when site is not found', async function siteNotFound() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(null);

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Site not found');
    });

    it('should return 400 for V2 site missing subscription_id', async function missingSubscriptionId() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const siteWithoutSubscription = { ...MOCK_V2_SITE, subscription_id: undefined };
      mockControlPlaneAdapter.getSite.mockResolvedValue(siteWithoutSubscription);

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Site missing required metadata (subscription_id or system_id)');
      expect(mockLogger.error).toHaveBeenCalledWith('deployments.api.create.missing-ids', expect.any(Object));
    });

    it('should return 400 for V2 site missing system_id', async function missingSystemId() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const siteWithoutSystem = { ...MOCK_V2_SITE, system_id: undefined };
      mockControlPlaneAdapter.getSite.mockResolvedValue(siteWithoutSystem);

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Site missing required metadata (subscription_id or system_id)');
      expect(mockLogger.error).toHaveBeenCalledWith('deployments.api.create.missing-ids', expect.any(Object));
    });

    it('should return 400 for site without subscription/system IDs', async function siteMissingMetadata() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_LEGACY_SITE);

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Site missing required metadata (subscription_id or system_id)');
    });

    it('should return 403 when user has no account', async function noAccount() {
      const userWithoutAccount = { ...MOCK_USER, accountId: undefined };
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: userWithoutAccount,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('You must have an account to create deployments');
    });

    it('should return 401 when user is not authenticated', async function notAuthenticated() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: false,
        error: 'Invalid token'
      });

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 500 when mgmt-airo API fails', async function mgmtAiroError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockAiroMgmtClient.publishApp.mockRejectedValue(new Error('API connection failed'));

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create deployment');
      expect(data.details).toBe('API connection failed');
      expect(mockLogger.error).toHaveBeenCalledWith('deployments.api.create.error', expect.any(Object));
    });

    it('propagates downstream 401 AiroHttpError as 401 with authReason:2', async function mgmtAiroUnauthorized() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockAiroMgmtClient.publishApp.mockRejectedValue(new AiroHttpError(401, 'Unauthorized', ''));

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized', authReason: 2 });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'deployments.api.create.hbi-expired',
        { siteId: MOCK_SITE_ID },
        { tags: ['security'] }
      );
    });

    it('should handle mgmt-airo API returning error status', async function mgmtAiroStatusError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const apiError = new Error('Deployment limit reached');
      (apiError as any).status = 429;
      mockAiroMgmtClient.publishApp.mockRejectedValue(apiError);

      const request = createMockRequest(MOCK_SITE_ID, { gitHash: MOCK_GIT_HASH });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error).toBe('Failed to create deployment');
      expect(data.details).toBe('Deployment limit reached');
    });
  });
});
