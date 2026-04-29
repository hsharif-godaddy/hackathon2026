/**
 * Agent Token Endpoint Tests
 *
 * Tests the /api/auth/agent-token endpoint to ensure proper authentication,
 * authorization, and site ownership validation.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';
import { clearSiteValidationCache } from '../site-validation-cache';

/**
 * Mock dependencies using vi.hoisted to avoid hoisting issues
 */
const { mockJWTService, mockAuthenticateCustomer, mockControlPlaneAdapter, mockCheckSwitchboardFlag, mockCheckSwitchboardValue, mockMgmtClient } = vi.hoisted(function setup() {
  return {
    mockJWTService: {
      getToken: vi.fn(),
      createToken: vi.fn()
    },
    mockControlPlaneAdapter: {
      getSite: vi.fn(),
      appExists: vi.fn()
    },
    mockAuthenticateCustomer: vi.fn(),
    mockCheckSwitchboardFlag: vi.fn(),
    mockCheckSwitchboardValue: vi.fn(),
    mockMgmtClient: {
      getSubscription: vi.fn()
    }
  };
});

/**
 * Mock JWT service
 */
vi.mock('@/lib/jwt-service', function mockJWTServiceModule() {
  return {
    getJWTService: vi.fn().mockReturnValue(mockJWTService)
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
vi.mock('@/lib/mgmt-airo', function mockMgmtAiroModule() {
  return {
    AiroMgmtClient: vi.fn().mockImplementation(() => mockMgmtClient),
    AIRO_OWNER_PRODUCTS: { AIRO_APP_BUILDER: 'AiroAppBuilder', PAAS_NODEJS: 'PaaSNodeJS' }
  };
});

/**
 * Mock paywall
 */
vi.mock('@/lib/paywall/core', function mockPaywallModule() {
  return {
    checkPaywallEligibility: vi.fn().mockResolvedValue({
      hasAccess: false,
      reason: 'no_subscription',
      details: { hasSubscription: false, hasEntitlements: false, hasMatchingProject: false }
    }),
    PaywallAction: { Publish: 'publish' }
  };
});

vi.mock('@/lib/paywall/server-provider', function mockPaywallProviderModule() {
  return {
    ServerPaywallProvider: vi.fn()
  };
});

/**
 * Mock switchboard
 */
vi.mock('@/lib/switchboard/server', function mockSwitchboardModule() {
  return {
    checkSwitchboardFlag: mockCheckSwitchboardFlag,
    checkSwitchboardValue: mockCheckSwitchboardValue
  };
});

/**
 * Mock logger
 */
vi.mock('@/lib/request-context', function mockRequestContextModule() {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
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
const MOCK_USER = {
  shopperId: 'shopper-789',
  customerId: 'customer-789',
  accountId: MOCK_ACCOUNT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000)
};

const MOCK_JWT_TOKEN = 'mock-jwt-token-for-testing';
const MOCK_TOKEN_EXPIRES = new Date(Date.now() + 3600000);

/**
 * Helper to create mock NextRequest
 */
function createMockRequest(body: any, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/agent-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

describe('agent-token', function packageTests() {
  describe('#POST', function postTests() {
    beforeEach(function resetMocks() {
      vi.clearAllMocks();
      clearSiteValidationCache();

      // Default mock implementations
      mockCheckSwitchboardFlag.mockResolvedValue(false);
      mockCheckSwitchboardValue.mockResolvedValue(null);
      mockControlPlaneAdapter.appExists.mockResolvedValue(true);
      mockMgmtClient.getSubscription.mockResolvedValue({ bmsBudgetId: null });
      mockJWTService.getToken.mockResolvedValue({
        token: MOCK_JWT_TOKEN,
        expires: MOCK_TOKEN_EXPIRES
      });
      mockJWTService.createToken.mockResolvedValue({
        token: MOCK_JWT_TOKEN,
        expires: MOCK_TOKEN_EXPIRES
      });
    });

    it('should create agent token for authenticated user with valid site', async function createToken() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.appExists.mockResolvedValue(true);

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        token: MOCK_JWT_TOKEN,
        expires: MOCK_TOKEN_EXPIRES.toISOString(),
        siteId: MOCK_SITE_ID,
        type: 'jwt'
      });
      expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledWith(MOCK_SITE_ID, 'user-jwt-token', 'AiroAppBuilder');
      expect(mockJWTService.getToken).toHaveBeenCalledWith({
        siteId: MOCK_SITE_ID,
        customerId: 'customer-789',
        canDownload: false,
        canPublish: false,
        canPurchaseDomain: false,
        authType: 'basic',
        isE2S: false,
        useTestBudget: false,
        budgetServiceEnabled: false,
        subscriptionId: undefined,
        enableAssessmentAgent: false,
        enableAssessmentOverride: false,
        product: 'AiroAppBuilder',
        modelSelectorEnabled: false,
        modelOverride: undefined,
        agentProfileSelectorEnabled: false,
        agentProfile: undefined,
        costAttributionDryRun: false,
      });
    });

    it('should reject unauthenticated requests', async function rejectUnauth() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: false,
        user: null,
        error: 'No authentication token provided'
      });

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        error: 'Unauthorized',
        message: 'No authentication token provided',
        requiresAuth: true
      });
      expect(mockJWTService.getToken).not.toHaveBeenCalled();
    });

    it('should reject request when user has no account', async function rejectNoAccount() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: {
          ...MOCK_USER,
          accountId: undefined
        },
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        error: 'You must have an account to create agent tokens'
      });
      expect(mockControlPlaneAdapter.appExists).not.toHaveBeenCalled();
    });

    it('should reject request when siteId is missing', async function rejectMissingSiteId() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest({});
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'siteId is required'
      });
      expect(mockJWTService.getToken).not.toHaveBeenCalled();
    });

    it('should return 404 when site not found', async function siteNotFound() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.appExists.mockResolvedValue(false);

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        error: 'Site not found'
      });
      expect(mockJWTService.getToken).not.toHaveBeenCalled();
    });

    it('should handle control plane adapter errors gracefully', async function handleAdapterError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.appExists.mockRejectedValue(new Error('Control plane connection failed'));

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Token creation failed',
        details: 'Control plane connection failed'
      });
    });

    it('should handle JWT service errors gracefully', async function handleJWTError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      mockControlPlaneAdapter.appExists.mockResolvedValue(true);
      mockJWTService.getToken.mockRejectedValue(new Error('JWT generation failed'));

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Token creation failed',
        details: 'JWT generation failed'
      });
    });

    describe('expiresInSeconds', function expirationTests() {
      it('should support custom expiresInSeconds', async function customExpiration() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);

        const expiresInSeconds = 600;
        const request = createMockRequest({
          siteId: MOCK_SITE_ID,
          expiresInSeconds
        });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.expiresInSeconds).toBe(expiresInSeconds);
        expect(mockJWTService.createToken).toHaveBeenCalledWith(
          { siteId: MOCK_SITE_ID, customerId: 'customer-789', canDownload: false, canPublish: false, canPurchaseDomain: false, authType: 'basic', isE2S: false, useTestBudget: false, budgetServiceEnabled: false, subscriptionId: undefined, enableAssessmentAgent: false, enableAssessmentOverride: false, product: 'AiroAppBuilder', modelSelectorEnabled: false, modelOverride: undefined, agentProfileSelectorEnabled: false, agentProfile: undefined, costAttributionDryRun: false },
          expiresInSeconds
        );
        expect(mockJWTService.getToken).not.toHaveBeenCalled();
      });

      it('should reject expiresInSeconds that exceeds maximum', async function rejectExceedsMax() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        const request = createMockRequest({
          siteId: MOCK_SITE_ID,
          expiresInSeconds: 50000
        });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toEqual({
          error: 'expiresInSeconds cannot exceed 43200 seconds (12 hours)'
        });
        expect(mockControlPlaneAdapter.appExists).not.toHaveBeenCalled();
      });

      it('should reject expiresInSeconds less than or equal to 0', async function rejectZero() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        const request = createMockRequest({
          siteId: MOCK_SITE_ID,
          expiresInSeconds: 0
        });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toEqual({
          error: 'expiresInSeconds must be greater than 0'
        });
      });
    });

    describe('auth type handling', function authTypeTests() {
      it('should pass e2s auth type and isE2S flag to JWT service', async function e2sAuthType() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: {
            ...MOCK_USER,
            authType: 'e2s',
            isE2S: true
          },
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith({
          siteId: MOCK_SITE_ID,
          customerId: 'customer-789',
          canDownload: false,
          canPublish: false,
          canPurchaseDomain: false,
          authType: 'e2s',
          isE2S: true,
          useTestBudget: false,
          budgetServiceEnabled: false,
          subscriptionId: undefined,
          enableAssessmentAgent: false,
          enableAssessmentOverride: false,
          product: 'AiroAppBuilder',
          modelSelectorEnabled: true,
          modelOverride: undefined,
          agentProfileSelectorEnabled: false,
          agentProfile: undefined,
          costAttributionDryRun: false,
        });
      });

      it('should pass s2s auth type without isE2S flag', async function s2sAuthType() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: {
            ...MOCK_USER,
            authType: 's2s',
            isE2S: false
          },
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith({
          siteId: MOCK_SITE_ID,
          customerId: 'customer-789',
          canDownload: false,
          canPublish: false,
          canPurchaseDomain: false,
          authType: 's2s',
          isE2S: false,
          useTestBudget: false,
          budgetServiceEnabled: false,
          subscriptionId: undefined,
          enableAssessmentAgent: false,
          enableAssessmentOverride: false,
          product: 'AiroAppBuilder',
          modelSelectorEnabled: false,
          modelOverride: undefined,
          agentProfileSelectorEnabled: false,
          agentProfile: undefined,
          costAttributionDryRun: false,
        });
      });
    });

    describe('site validation cache', function cacheTests() {
      it('should cache site validation and skip re-validation on second call', async function cacheHit() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);

        // First call - should validate
        const request1 = createMockRequest({ siteId: MOCK_SITE_ID });
        const response1 = await POST(request1);
        expect(response1.status).toBe(200);
        expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledTimes(1);

        // Second call - should use cache
        const request2 = createMockRequest({ siteId: MOCK_SITE_ID });
        const response2 = await POST(request2);
        expect(response2.status).toBe(200);
        expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledTimes(1); // Not called again
      });
    });

    describe('switchboard flags', function switchboardTests() {
      it('should pass useTestBudget flag from switchboard', async function testBudgetFlag() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        // Only enable useTestBudget and canPurchaseDomain, NOT budget service
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'appbuilder-test-budget' || flag === 'appbuilder-domain-purchase')
        );

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({
            useTestBudget: true,
            canPurchaseDomain: true
          })
        );
      });

      it('should pass budgetServiceEnabled and subscriptionId when flag is on and site has subscription', async function budgetServiceEnabled() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'app-builder-budget-service')
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockResolvedValue({ bmsBudgetId: 'budget-123' });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({
            budgetServiceEnabled: true,
            subscriptionId: 'sub-123',
            bmsBudgetId: 'budget-123'
          })
        );
      });

      it('should succeed with undefined bmsBudgetId when getSite rejects and budget service is enabled', async function budgetServiceGetSiteRejects() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'app-builder-budget-service')
        );
        mockControlPlaneAdapter.getSite.mockRejectedValue(new Error('control plane error'));

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // Graceful degradation: returns 200 with budgetServiceEnabled but no bmsBudgetId
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.token).toBeDefined();
      });

      it('should succeed with undefined bmsBudgetId when getSite rejects on cache-hit path and budget service is enabled', async function budgetServiceGetSiteRejectsCacheHit() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'app-builder-budget-service')
        );

        // First request: populate the site validation cache with a successful getSite
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockResolvedValue({ bmsBudgetId: 'budget-123' });
        const request1 = createMockRequest({ siteId: MOCK_SITE_ID });
        await POST(request1);

        // Second request: getSite now rejects, but cache-hit path is used (skips appExists)
        mockControlPlaneAdapter.getSite.mockRejectedValue(new Error('control plane error'));
        const request2 = createMockRequest({ siteId: MOCK_SITE_ID });
        const response2 = await POST(request2);

        // Graceful degradation: returns 200 with budgetServiceEnabled but no bmsBudgetId
        expect(response2.status).toBe(200);
        // Verify cache-hit path was taken: appExists should only have been called once (first request)
        expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledTimes(1);
        const body = await response2.json();
        expect(body.token).toBeDefined();
      });

      it('should succeed with undefined bmsBudgetId when subscriptionId is missing and budget service is enabled', async function budgetServiceMissingSubscription() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'app-builder-budget-service')
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({});

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // Graceful degradation: returns 200 with budgetServiceEnabled but no bmsBudgetId
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.token).toBeDefined();
      });

      it('should succeed with undefined bmsBudgetId when bmsBudgetId is missing from subscription', async function budgetServiceMissingBmsBudgetId() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'app-builder-budget-service')
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockResolvedValue({ bmsBudgetId: null });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // Graceful degradation: returns 200 with budgetServiceEnabled but bmsBudgetId undefined
        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: undefined })
        );
      });

      it('should succeed with undefined bmsBudgetId when getSubscription throws', async function budgetServiceSubscriptionFetchFailed() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'app-builder-budget-service')
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockRejectedValue(new Error('mgmt-airo down'));

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // Graceful degradation: returns 200 with budgetServiceEnabled but bmsBudgetId undefined
        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: undefined })
        );
      });
    });

    describe('model override flags', function modelOverrideTests() {
      beforeEach(function authSetup() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
      });

      it('should set modelSelectorEnabled when switchboard returns true', async function modelSelectorEnabled() {
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'appbuilder-model-selector')
        );

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ modelSelectorEnabled: true })
        );
      });

      it('should set modelOverride when switchboard returns a model name', async function modelOverrideSet() {
        mockCheckSwitchboardValue.mockResolvedValue('claude-sonnet-4-5');

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ modelOverride: 'claude-sonnet-4-5' })
        );
      });

      it('should omit modelOverride when switchboard returns "default"', async function modelOverrideDefault() {
        mockCheckSwitchboardValue.mockResolvedValue('default');

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ modelOverride: undefined })
        );
      });

      it('should omit modelOverride when checkSwitchboardValue rejects', async function modelOverrideReject() {
        mockCheckSwitchboardValue.mockRejectedValue(new Error('switchboard down'));

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ modelOverride: undefined })
        );
      });

      it('should set modelSelectorEnabled false when checkSwitchboardFlag rejects', async function modelSelectorReject() {
        mockCheckSwitchboardFlag.mockRejectedValue(new Error('switchboard down'));

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ modelSelectorEnabled: false })
        );
      });

      it('should force modelSelectorEnabled true for e2s (CRM skip) sessions even when switchboard is false', async function modelSelectorE2sOverride() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: { ...MOCK_USER, authType: 'e2s', isE2S: true },
          jwt: 'user-jwt-token'
        });
        mockCheckSwitchboardFlag.mockResolvedValue(false);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ authType: 'e2s', modelSelectorEnabled: true })
        );
      });

      it('should force modelSelectorEnabled true for e2s2s sessions even when switchboard rejects', async function modelSelectorE2s2sOverride() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: { ...MOCK_USER, authType: 'e2s2s', isE2S: false },
          jwt: 'user-jwt-token'
        });
        mockCheckSwitchboardFlag.mockRejectedValue(new Error('switchboard down'));

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ authType: 'e2s2s', modelSelectorEnabled: true })
        );
      });

      it('should not force modelSelectorEnabled for non-employee auth types', async function modelSelectorBasicNotForced() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: { ...MOCK_USER, authType: 'basic', isE2S: false },
          jwt: 'user-jwt-token'
        });
        mockCheckSwitchboardFlag.mockResolvedValue(false);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ authType: 'basic', modelSelectorEnabled: false })
        );
      });

      it('should not force modelSelectorEnabled for s2s (delegation) sessions', async function modelSelectorS2sNotForced() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: { ...MOCK_USER, authType: 's2s', isE2S: false },
          jwt: 'user-jwt-token'
        });
        mockCheckSwitchboardFlag.mockResolvedValue(false);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ authType: 's2s', modelSelectorEnabled: false })
        );
      });

      it('should set costAttributionDryRun when switchboard returns true', async function costAttributionDryRunEnabled() {
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'appbuilder-cost-attribution-dry-run')
        );

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ costAttributionDryRun: true })
        );
      });
    });

    describe('PaaS canPublish bypass', function paasBypassTests() {
      beforeEach(function paasBypassSetup() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
      });

      it('should force canPublish=true for PaaSNodeJS when paywall denies access', async function paasBypass() {
        const request = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'PaaSNodeJS' });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ canPublish: true, product: 'PaaSNodeJS' })
        );
      });

      it('should not elevate canDownload for PaaSNodeJS when paywall denies access', async function paasNoDownloadBypass() {
        const request = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'PaaSNodeJS' });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ canDownload: false, canPublish: true })
        );
      });

      it('should leave canPublish=false for AiroAppBuilder when paywall denies access', async function aabNotBypassed() {
        const request = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'AiroAppBuilder' });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ canPublish: false, product: 'AiroAppBuilder' })
        );
      });

      it('should force canPublish=true for PaaSNodeJS on the site-validation cache-hit path', async function paasBypassCacheHit() {
        const firstRequest = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'PaaSNodeJS' });
        const firstResponse = await POST(firstRequest);
        expect(firstResponse.status).toBe(200);
        expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledTimes(1);

        const secondRequest = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'PaaSNodeJS' });
        const secondResponse = await POST(secondRequest);

        expect(secondResponse.status).toBe(200);
        // appExists is only called from validateSiteAccess on cache miss — unchanged count proves cache hit
        expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledTimes(1);
        expect(mockJWTService.getToken).toHaveBeenLastCalledWith(
          expect.objectContaining({ canPublish: true, product: 'PaaSNodeJS' })
        );
      });
    });
  });
});
