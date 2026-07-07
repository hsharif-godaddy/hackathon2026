/**
 * Agent Token Endpoint Tests
 *
 * Tests the /api/auth/agent-token endpoint to ensure proper authentication,
 * authorization, and site ownership validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureAppTeamVenture } from '@/lib/authz-fga/ensure-app-venture';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { SubscriptionPlan } from '@/types/credits';
import { POST } from '../route';
import { clearSiteValidationCache } from '../site-validation-cache';

/**
 * Mock dependencies using vi.hoisted to avoid hoisting issues
 */
const { mockJWTService, mockAuthenticateCustomer, mockControlPlaneAdapter, mockCheckSwitchboardFlag, mockCheckSwitchboardValue, mockMgmtClient, mockEnforceAabMultiUserCanBuild, mockGetExperimentCohorts, mockLogger, mockFgaListObjects, mockResolveCareAgentIdentity } = vi.hoisted(function setup() {
  return {
    mockResolveCareAgentIdentity: vi.fn(),
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
      getSubscription: vi.fn(),
      getApps: vi.fn(),
      getSecrets: vi.fn()
    },
    mockEnforceAabMultiUserCanBuild: vi.fn().mockResolvedValue(null),
    mockGetExperimentCohorts: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockFgaListObjects: vi.fn()
  };
});

// Helper: build an auth-group secrets response with the given pointer names.
function authSecretsResponse(names: string[]): { auth: { secrets: { name: string; systemManaged: boolean }[] } } {
  return { auth: { secrets: names.map((name) => ({ name, systemManaged: false })) } };
}

vi.mock('@/lib/authz-fga/enforce-can-build', function mockEnforceCanBuild() {
  return {
    enforceAabMultiUserCanBuild: mockEnforceAabMultiUserCanBuild
  };
});

vi.mock('@/lib/authz-fga/ensure-app-venture', function mockEnsureAppVenture() {
  return {
    ensureAppTeamVenture: vi.fn().mockResolvedValue(null)
  };
});

/**
 * Mock FGA primitives used by the sharedWithMe (collaborator) paywall branch.
 */
vi.mock('@/lib/authz-fga/list-objects', function mockListObjects() {
  return { listObjects: mockFgaListObjects };
});

vi.mock('@/lib/authz-fga/oauth-token', function mockOauthToken() {
  return { getAuthzFgaAccessToken: vi.fn().mockResolvedValue('fga-access-token') };
});

vi.mock('@/lib/authz-fga/config', function mockAuthzFgaConfig() {
  return { getAuthzFgaConfig: vi.fn().mockReturnValue({ apiUrl: 'https://fga.example', storeId: 'store-1' }) };
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
 * Mock care-agent identity resolution — the route resolves the care agent's
 * worker GUID (or hashed-username fallback) at mint time. Default: no identity
 * resolved.
 */
vi.mock('@/lib/care-agent-identity', function mockCareAgentIdentityModule() {
  return {
    resolveCareAgentIdentity: mockResolveCareAgentIdentity
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
    AiroMgmtClient: vi.fn().mockImplementation(function () { return mockMgmtClient; }),
    AIRO_OWNER_PRODUCTS: { AIRO_APP_BUILDER: 'AiroAppBuilder', PAAS_NODEJS: 'PaaSNodeJS' },
    ATTRIBUTE_KEYS: { BMS_MIGRATION: 'bms-migration', FREE_PLAN: 'free-plan' }
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
 * Mock gasket — avoids triggering Atlas/Visitor plugin initialization during tests.
 * The getExperimentCohorts action is stubbed for the gasket surface; the route's only
 * consumer of it (the initial-agent experiment) was removed in AIROBUILD-3388.
 */
vi.mock('../../../../../../gasket', function mockGasketModule() {
  return {
    default: {
      actions: {
        getExperimentCohorts: mockGetExperimentCohorts
      }
    }
  };
});

/**
 * Mock market resolution — returns visitorMarket: 'en-US' by default.
 */
vi.mock('@/lib/market/resolve-market', function mockResolveMarketModule() {
  return {
    resolveMarketId: vi.fn().mockResolvedValue({ marketId: 'en-US', visitorMarket: 'en-US', source: 'visitor-market' }),
  };
});

/**
 * Mock logger
 */
vi.mock('@/lib/request-context', function mockRequestContextModule() {
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
      mockGetExperimentCohorts.mockResolvedValue({});
      mockControlPlaneAdapter.appExists.mockResolvedValue(true);
      mockMgmtClient.getSubscription.mockResolvedValue({ bmsBudgetId: null });
      mockMgmtClient.getApps.mockResolvedValue([]);
      mockFgaListObjects.mockResolvedValue([]);
      mockControlPlaneAdapter.getSite.mockResolvedValue({});
      mockJWTService.getToken.mockResolvedValue({
        token: MOCK_JWT_TOKEN,
        expires: MOCK_TOKEN_EXPIRES
      });
      mockJWTService.createToken.mockResolvedValue({
        token: MOCK_JWT_TOKEN,
        expires: MOCK_TOKEN_EXPIRES
      });
      mockEnforceAabMultiUserCanBuild.mockResolvedValue(null);
      // Workers Service lookup defaults to no identity resolved; employee-session
      // tests override this to assert the GUID or hashed-username fallback.
      mockResolveCareAgentIdentity.mockResolvedValue({});
      // SSO presence check defaults to "not configured" (auth group empty).
      // Every existing test uses the default site (no ssoRequired flag), so
      // the BFF skips the auth-group GET entirely. SSO-specific tests below
      // override the site fixture to trigger the call.
      mockMgmtClient.getSecrets.mockResolvedValue({ auth: { secrets: [] } });
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
        type: 'jwt',
        budgetServiceEnabled: false,
      });
      expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledWith(MOCK_SITE_ID, 'user-jwt-token', 'AiroAppBuilder', false);
      expect(mockJWTService.getToken).toHaveBeenCalledWith({
        shopperId: 'shopper-789',
        siteId: MOCK_SITE_ID,
        customerId: 'customer-789',
        market: 'en-US',
        canDownload: false,
        canPublish: false,
        canPurchaseDomain: false,
        authType: 'basic',
        isE2S: false,
        useTestBudget: false,
        budgetServiceEnabled: false,
        subscriptionId: undefined,
        bmsBudgetId: undefined,
        enableAssessmentAgent: false,
        enableAssessmentOverride: false,
        assessmentClassifier: undefined,
        product: 'AiroAppBuilder',
        modelSelectorEnabled: false,
        modelOverride: undefined,
        agentStartOverrideEnabled: false,
        agentProfile: undefined,
        costAttributionDryRun: false,

        useAtlasCrawler: false,
        rebuildIntakeFormEnabled: false, rebuildSourceImagesEnabled: false,

        debugStatsEnabled: false,
        automationsEnabled: false,
        marketingCampaignsEnabled: false, googleBusinessProfileSyncEnabled: false,
        aiVisibilityEnabled: false,
        asmDualWriteEnabled: false,
        logoBrandColorsEnabled: false,
        purchaseIntentClassifierEnabled: false,
        skillSuggestionsEnabled: false,
        enableFixSession: false,
        ssoRequired: false,
        ssoConfigured: false,
        ownerProduct: undefined,
      });
    });

    it('returns 403 when multi-user FGA gate denies', async function fgaDeny() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockEnforceAabMultiUserCanBuild.mockResolvedValue(
        NextResponse.json({ error: 'Forbidden', message: 'no builder' }, { status: 403 })
      );

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
      expect(mockJWTService.getToken).not.toHaveBeenCalled();
    });

    it('passes isOwner true when hosting owner matches customer', async function ownerClaim() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue({
        id: MOCK_SITE_ID,
        subscription_id: 'sub-123',
        owner_customer_id: 'customer-789',
      });

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(mockJWTService.getToken).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: MOCK_SITE_ID,
          customerId: 'customer-789',
          isOwner: true,
        })
      );
    });

    // Regression: the mapping backstop inside ensureAppTeamVenture is what lets
    // invitee-pull resolve an already-provisioned venture. agent-token must call
    // it on EVERY owner open, not only when the venture is missing — otherwise a
    // shared app whose venture already exists never gets its venture->app mapping
    // re-asserted and invited collaborators stay invisible.
    it('calls ensureAppTeamVenture even when team_venture_id already exists', async function ventureExists() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue({
        id: MOCK_SITE_ID,
        subscription_id: 'sub-123',
        owner_customer_id: MOCK_USER.customerId,
        team_venture_id: 'venture-already-here',
      });

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(ensureAppTeamVenture).toHaveBeenCalledWith(
        expect.objectContaining({ siteId: MOCK_SITE_ID, customerId: MOCK_USER.customerId }),
      );
    });

    it('should include fqdn in token options when getSite returns a fqdn', async function fqdnPresent() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.appExists.mockResolvedValue(true);
      mockControlPlaneAdapter.getSite.mockResolvedValue({ fqdn: 'studiosketch.com' });

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockJWTService.getToken).toHaveBeenCalledWith(
        expect.objectContaining({ fqdn: 'studiosketch.com' })
      );
    });

    it('should omit fqdn from token options when getSite returns no fqdn', async function fqdnAbsent() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.appExists.mockResolvedValue(true);
      mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const tokenOptions = mockJWTService.getToken.mock.calls[0][0];
      expect(tokenOptions).not.toHaveProperty('fqdn');
    });

    it('should omit fqdn when getSite rejects', async function fqdnGetSiteRejects() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.appExists.mockResolvedValue(true);
      mockControlPlaneAdapter.getSite.mockRejectedValue(new Error('control plane error'));

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const tokenOptions = mockJWTService.getToken.mock.calls[0][0];
      expect(tokenOptions).not.toHaveProperty('fqdn');
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
      // Generic detail (internal error text is logged server-side, not echoed).
      expect(data).toEqual({
        error: 'Token creation failed',
        details: 'An unexpected error occurred. Please try again.'
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
        details: 'An unexpected error occurred. Please try again.'
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
          { shopperId: 'shopper-789', siteId: MOCK_SITE_ID, customerId: 'customer-789', market: 'en-US', canDownload: false, canPublish: false, canPurchaseDomain: false, authType: 'basic', isE2S: false, useTestBudget: false, budgetServiceEnabled: false, subscriptionId: undefined, bmsBudgetId: undefined, enableAssessmentAgent: false, enableAssessmentOverride: false, assessmentClassifier: undefined, product: 'AiroAppBuilder', modelSelectorEnabled: false, modelOverride: undefined, agentStartOverrideEnabled: false, agentProfile: undefined, costAttributionDryRun: false, useAtlasCrawler: false, rebuildIntakeFormEnabled: false, rebuildSourceImagesEnabled: false, debugStatsEnabled: false, automationsEnabled: false, marketingCampaignsEnabled: false, googleBusinessProfileSyncEnabled: false, aiVisibilityEnabled: false, asmDualWriteEnabled: false, logoBrandColorsEnabled: false, purchaseIntentClassifierEnabled: false, skillSuggestionsEnabled: false, enableFixSession: false, ssoRequired: false, ssoConfigured: false, ownerProduct: undefined },
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
          shopperId: 'shopper-789',
          siteId: MOCK_SITE_ID,
          customerId: 'customer-789',
          market: 'en-US',
          canDownload: false,
          canPublish: false,
          canPurchaseDomain: false,
          authType: 'e2s',
          isE2S: true,
          useTestBudget: false,
          budgetServiceEnabled: false,
          subscriptionId: undefined,
          bmsBudgetId: undefined,
          enableAssessmentAgent: false,
          enableAssessmentOverride: false,
          assessmentClassifier: undefined,
          product: 'AiroAppBuilder',
          modelSelectorEnabled: true,
          modelOverride: undefined,
          agentStartOverrideEnabled: true,
          agentProfile: undefined,
          costAttributionDryRun: false,

          useAtlasCrawler: false,
          rebuildIntakeFormEnabled: false, rebuildSourceImagesEnabled: false,

          debugStatsEnabled: false,
          automationsEnabled: false,
          marketingCampaignsEnabled: false, googleBusinessProfileSyncEnabled: false,
          aiVisibilityEnabled: false,
          asmDualWriteEnabled: false,
          logoBrandColorsEnabled: false,
          purchaseIntentClassifierEnabled: false,
          skillSuggestionsEnabled: false,
        enableFixSession: false,
        ssoRequired: false,
        ssoConfigured: false,
        ownerProduct: undefined,
        });
      });

      function e2sJwtFixture(): string {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify({
          auth: 'e2s',
          e2s: { shopperId: '67890', cid: 'customer-789' },
          del: { accountName: 'fgoodwrk', typ: 'jomax' },
        })).toString('base64url');
        return `${header}.${body}.fakesig`;
      }

      it('resolves the care agent via the delegated JWT username and mints the worker GUID for e2s sessions', async function e2sCareAgentGuid() {
        const e2sJwt = e2sJwtFixture();
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: { ...MOCK_USER, authType: 'e2s', isE2S: true },
          jwt: e2sJwt,
        });
        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockResolveCareAgentIdentity.mockResolvedValue({ careAgentId: 'worker-guid-123' });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        // accountName from `del.accountName` is passed to the lookup, never minted.
        expect(mockResolveCareAgentIdentity).toHaveBeenCalledWith(
          expect.objectContaining({ jwt: e2sJwt, accountName: 'fgoodwrk' }),
        );
        const passedOptions = mockJWTService.getToken.mock.calls[0]![0];
        expect(passedOptions).toMatchObject({ authType: 'e2s', isE2S: true, careAgentId: 'worker-guid-123' });
        expect(passedOptions).not.toHaveProperty('careAgentUsername');
        expect(passedOptions).not.toHaveProperty('careAgentUsernameHash');
      });

      it('mints the hashed-username fallback when the worker-GUID lookup fails', async function e2sCareAgentHashFallback() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: { ...MOCK_USER, authType: 'e2s', isE2S: true },
          jwt: e2sJwtFixture(),
        });
        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockResolveCareAgentIdentity.mockResolvedValue({ careAgentUsernameHash: 'sha256hex' });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        const passedOptions = mockJWTService.getToken.mock.calls[0]![0];
        expect(passedOptions).toMatchObject({ careAgentUsernameHash: 'sha256hex' });
        expect(passedOptions).not.toHaveProperty('careAgentId');
        expect(passedOptions).not.toHaveProperty('careAgentUsername');
      });

      it('still mints a token when the lookup resolves no identity', async function e2sCareAgentNoIdentity() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: { ...MOCK_USER, authType: 'e2s', isE2S: true },
          jwt: e2sJwtFixture(),
        });
        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockResolveCareAgentIdentity.mockResolvedValue({});

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        const passedOptions = mockJWTService.getToken.mock.calls[0]![0];
        expect(passedOptions).not.toHaveProperty('careAgentId');
        expect(passedOptions).not.toHaveProperty('careAgentUsernameHash');
      });

      it('should NOT resolve or mint care-agent claims for non-employee (basic) sessions', async function basicNoCareAgent() {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify({
          shopperId: 'sh-basic',
          cid: 'customer-789',
          del: { accountName: 'fgoodwrk', typ: 'jomax' },
        })).toString('base64url');
        const basicJwt = `${header}.${body}.fakesig`;

        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: { ...MOCK_USER, authType: 'basic', isE2S: false },
          jwt: basicJwt,
        });
        mockControlPlaneAdapter.appExists.mockResolvedValue(true);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockResolveCareAgentIdentity).not.toHaveBeenCalled();
        const passedOptions = mockJWTService.getToken.mock.calls[0]![0];
        expect(passedOptions).not.toHaveProperty('careAgentId');
        expect(passedOptions).not.toHaveProperty('careAgentUsernameHash');
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
          shopperId: 'shopper-789',
          siteId: MOCK_SITE_ID,
          customerId: 'customer-789',
          market: 'en-US',
          canDownload: false,
          canPublish: false,
          canPurchaseDomain: false,
          authType: 's2s',
          isE2S: false,
          useTestBudget: false,
          budgetServiceEnabled: false,
          subscriptionId: undefined,
          bmsBudgetId: undefined,
          enableAssessmentAgent: false,
          enableAssessmentOverride: false,
          assessmentClassifier: undefined,
          product: 'AiroAppBuilder',
          modelSelectorEnabled: false,
          modelOverride: undefined,
          agentStartOverrideEnabled: false,
          agentProfile: undefined,
          costAttributionDryRun: false,

          useAtlasCrawler: false,
          rebuildIntakeFormEnabled: false, rebuildSourceImagesEnabled: false,

          debugStatsEnabled: false,
          automationsEnabled: false,
          marketingCampaignsEnabled: false, googleBusinessProfileSyncEnabled: false,
          aiVisibilityEnabled: false,
          asmDualWriteEnabled: false,
          logoBrandColorsEnabled: false,
          purchaseIntentClassifierEnabled: false,
          skillSuggestionsEnabled: false,
        enableFixSession: false,
        ssoRequired: false,
        ssoConfigured: false,
        ownerProduct: undefined,
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
      it('should pass asmDualWriteEnabled flag from switchboard', async function asmDualWriteFlag() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'appbuilder-asm-dual-write')
        );

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ asmDualWriteEnabled: true })
        );
      });

      it('should pass useTestBudget flag from switchboard', async function testBudgetFlag() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        // Only enable useTestBudget and canPurchaseDomain, NOT budget service
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'appbuilder-test-budget' || flag === 'appbuilder-domain-purchase'); }
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

      it('should pass budgetServiceEnabled and subscriptionId when both flags are on and subscription is migrated', async function budgetServiceEnabled() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: 'budget-123',
          attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }]
        });

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

      it('should enable budgetServiceEnabled for EXISTING user when only bmsExistingEnabled flag is on', async function existingUserOnlyBmsExistingFlag() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        // Only bmsExistingEnabled is true, budgetServiceEnabled is false
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        // Existing user with migration complete
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: 'budget-456',
          attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }]
        });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        // Critical: budgetServiceEnabled must be true for agents service to use BMS mode
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({
            budgetServiceEnabled: true,
            subscriptionId: 'sub-123',
            bmsBudgetId: 'budget-456'
          })
        );
      });

      it('should succeed with undefined bmsBudgetId when getSite rejects and budget service flags are enabled', async function budgetServiceGetSiteRejects() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockRejectedValue(new Error('control plane error'));

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // Graceful degradation: returns 200 with budgetServiceEnabled but no bmsBudgetId
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.token).toBeDefined();
      });

      it('should succeed with undefined bmsBudgetId when getSite rejects on cache-hit path and budget service flags are enabled', async function budgetServiceGetSiteRejectsCacheHit() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );

        // First request: populate the site validation cache with a successful getSite
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: 'budget-123',
          attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }]
        });
        const request1 = createMockRequest({ siteId: MOCK_SITE_ID });
        await POST(request1);

        // Second request: getSite now rejects, but cache-hit path is used (skips appExists)
        mockControlPlaneAdapter.getSite.mockRejectedValue(new Error('control plane error'));
        const request2 = createMockRequest({ siteId: MOCK_SITE_ID });
        const response2 = await POST(request2);

        // Graceful degradation: returns 200 but budgetServiceEnabled is false (no subscriptionId)
        expect(response2.status).toBe(200);
        // Verify cache-hit path was taken: appExists should only have been called once (first request)
        expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledTimes(1);
        const body = await response2.json();
        expect(body.token).toBeDefined();
      });

      it('should fall back to legacy grants when subscriptionId is missing and budget service flags are enabled', async function budgetServiceMissingSubscription() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({});

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // Graceful degradation: returns 200 but budgetServiceEnabled is false (no subscriptionId to check)
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.token).toBeDefined();
      });

      it('should fall back to legacy grants when bmsBudgetId is missing from subscription (migration not complete)', async function budgetServiceMissingBmsBudgetId() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        // Subscription has migration attribute but no bmsBudgetId — migration not complete
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: null,
          attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }]
        });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // Falls back to legacy grants: budgetServiceEnabled=false, bmsBudgetId undefined
        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: false, bmsBudgetId: undefined })
        );
      });

      it('should fall back to legacy grants when getSubscription throws', async function budgetServiceSubscriptionFetchFailed() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockRejectedValue(new Error('mgmt-airo down'));

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // Falls back to legacy grants: budgetServiceEnabled=false, bmsBudgetId undefined
        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: false, bmsBudgetId: undefined })
        );
      });

      it('should use BMS for NEW user when budgetServiceEnabled is true and Hivemind cohort is on', async function budgetServiceNewUser() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: 'budget-123',
          attributes: []
        });
        mockGetExperimentCohorts.mockResolvedValue({ 'airo-app-builder-budget-service-launch': { cohortId: 'on' } });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: 'budget-123' })
        );
      });

      it('should fall back to legacy grants for EXISTING user when bmsExistingEnabled is false', async function budgetServiceExistingUserFlagDisabled() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        // Only app-builder-budget-service is enabled, not app-builder-bms-existing
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        // EXISTING user (has migration attribute) but bmsExistingEnabled is false
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: 'budget-123',
          attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }]
        });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // EXISTING user with bmsExistingEnabled=false → falls back to legacy grants
        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: false, bmsBudgetId: undefined })
        );
      });

      it('should fall back to legacy grants for NEW user when budgetServiceEnabled is false', async function budgetServiceNewUserFlagDisabled() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        // Only app-builder-bms-existing is enabled, not app-builder-budget-service
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        // NEW user (no migration attribute) but budgetServiceEnabled is false
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: 'budget-123',
          attributes: []
        });

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        // NEW user with budgetServiceEnabled=false → falls back to legacy grants
        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: false, bmsBudgetId: undefined })
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
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'appbuilder-model-selector'); }
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
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'appbuilder-cost-attribution-dry-run'); }
        );

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ costAttributionDryRun: true })
        );
      });
    });

    describe('PaaS permission bypass', function paasBypassTests() {
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

      it('should force canDownload=true for PaaSNodeJS when paywall denies access', async function paasDownloadBypass() {
        const request = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'PaaSNodeJS' });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ canDownload: true, canPublish: true, product: 'PaaSNodeJS' })
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

      it('should leave canDownload=false for AiroAppBuilder when paywall denies access', async function aabNoDownloadBypass() {
        const request = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'AiroAppBuilder' });
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ canDownload: false, canPublish: false, product: 'AiroAppBuilder' })
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

      it('should force canDownload=true for PaaSNodeJS on the site-validation cache-hit path', async function paasDownloadBypassCacheHit() {
        const firstRequest = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'PaaSNodeJS' });
        const firstResponse = await POST(firstRequest);
        expect(firstResponse.status).toBe(200);
        expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledTimes(1);

        const secondRequest = createMockRequest({ siteId: MOCK_SITE_ID, owningProduct: 'PaaSNodeJS' });
        const secondResponse = await POST(secondRequest);

        expect(secondResponse.status).toBe(200);
        expect(mockControlPlaneAdapter.appExists).toHaveBeenCalledTimes(1);
        expect(mockJWTService.getToken).toHaveBeenLastCalledWith(
          expect.objectContaining({ canDownload: true, product: 'PaaSNodeJS' })
        );
      });
    });

    describe('agent profile resolution (appbuilder-agent-profile)', function agentProfileTests() {
      beforeEach(function authedUser() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
      });

      function mockSwitchboardAgentProfile(value: string | null): void {
        mockCheckSwitchboardValue.mockImplementation(async function getValue(name: string) {
          if (name === 'appbuilder-agent-profile') return value;
          return null;
        });
      }

      it('real profile name is passed through as the agentProfile claim', async function operatorOverride() {
        mockSwitchboardAgentProfile('initial-agent-design-system');

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ agentProfile: 'initial-agent-design-system' })
        );
      });

      it("'default' sentinel resolves to no agentProfile (agents default to initial-v3)", async function defaultSentinel() {
        mockSwitchboardAgentProfile('default');

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ agentProfile: undefined })
        );
      });

      it("'hivemind' sentinel resolves to no agentProfile (agents default to initial-v3)", async function hivemindSentinel() {
        mockSwitchboardAgentProfile('hivemind');

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ agentProfile: undefined })
        );
      });

      it('absent switchboard value resolves to no agentProfile', async function absentValue() {
        mockSwitchboardAgentProfile(null);

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ agentProfile: undefined })
        );
      });
    });

    describe('internal start-as override (agentStartOverrideEnabled + agentProfileOverride)', function startAsTests() {
      beforeEach(function authedUser() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token',
        });
      });

      function enableStartOverrideFlag(): void {
        mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
          Promise.resolve(flag === 'appbuilder-agent-start-override')
        );
      }

      it('appbuilder-agent-start-override flag on → token carries agentStartOverrideEnabled: true', async function flagOn() {
        enableStartOverrideFlag();

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ agentStartOverrideEnabled: true })
        );
      });

      it('internal caller + known agentProfileOverride → token carries that profile', async function knownProfile() {
        enableStartOverrideFlag();

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID, agentProfileOverride: 'initial-agent-design-system' }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ agentProfile: 'initial-agent-design-system' })
        );
      });

      it('internal caller + unknown agentProfileOverride → ignored with warn (falls through)', async function unknownProfile() {
        enableStartOverrideFlag();

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID, agentProfileOverride: 'not-a-real-profile' }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ agentProfile: undefined })
        );
        expect(mockLogger.warn).toHaveBeenCalledWith('agent-token.start-profile-override-invalid', expect.objectContaining({
          requested: 'not-a-real-profile',
        }));
      });

      it('non-internal caller (flag off) + known agentProfileOverride → ignored', async function nonInternal() {
        // flag defaults to false (top-level beforeEach) → agentStartOverrideEnabled false
        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID, agentProfileOverride: 'initial-agent-design-system' }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ agentStartOverrideEnabled: false, agentProfile: undefined })
        );
      });
    });

    describe('BMS for new and existing users (cohort does not gate BMS)', function budgetExperimentTests() {
      function setupNewBmsUser(): void {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: 'budget-123',
          attributes: []
        });
      }

      function setupExistingBmsUser(): void {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        mockControlPlaneAdapter.appExists.mockResolvedValue(true);
        mockCheckSwitchboardFlag.mockImplementation(function (flag: string) { return Promise.resolve(flag === 'app-builder-budget-service' || flag === 'app-builder-bms-existing'); }
        );
        mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
        mockMgmtClient.getSubscription.mockResolvedValue({
          bmsBudgetId: 'budget-456',
          attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }]
        });
      }

      it('new user with on cohort → budgetServiceEnabled true', async function onCohort() {
        setupNewBmsUser();
        mockGetExperimentCohorts.mockResolvedValue({ 'airo-app-builder-bms-launch-aa': { cohortId: 'on' } });

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: 'budget-123' })
        );
      });

      it('new user with off cohort → budgetServiceEnabled true (cohort does not gate BMS)', async function offCohort() {
        setupNewBmsUser();
        mockGetExperimentCohorts.mockResolvedValue({ 'airo-app-builder-bms-launch-aa': { cohortId: 'off' } });

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: 'budget-123' })
        );
      });

      it('new user with no cohort → budgetServiceEnabled true (flags-only decision)', async function noCohort() {
        setupNewBmsUser();
        mockGetExperimentCohorts.mockResolvedValue({});

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: 'budget-123' })
        );
      });

      it.each(['ineligible', 'unassigned', 'not_bucketed'])(
        'new user with excluded cohort %s → budgetServiceEnabled true (cohort does not gate BMS)',
        async function excluded(cohort) {
          setupNewBmsUser();
          mockGetExperimentCohorts.mockResolvedValue({ 'airo-app-builder-bms-launch-aa': cohort });

          const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

          expect(response.status).toBe(200);
          expect(mockJWTService.getToken).toHaveBeenCalledWith(
            expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: 'budget-123' })
          );
        }
      );

      it('existing migrated user is unaffected by off cohort', async function existingUserUnaffected() {
        setupExistingBmsUser();
        mockGetExperimentCohorts.mockResolvedValue({ 'airo-app-builder-bms-launch-aa': { cohortId: 'off' } });

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: 'budget-456' })
        );
      });

      it('existing migrated user is unaffected when no cohort assigned', async function existingNoCohort() {
        setupExistingBmsUser();
        mockGetExperimentCohorts.mockResolvedValue({});

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: 'budget-456' })
        );
      });

      it('getExperimentCohorts rejection → new user still uses BMS (flags-only decision)', async function cohortFetchFails() {
        setupNewBmsUser();
        mockGetExperimentCohorts.mockRejectedValue(new Error('switchboard unreachable'));

        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));

        expect(response.status).toBe(200);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ budgetServiceEnabled: true, bmsBudgetId: 'budget-123' })
        );
      });
    });

    describe('Auth-at-Edge SSO claims', function ssoClaimsTests() {
      it('bakes ssoRequired:false + ssoConfigured:false for non-ent apps and skips the hosting GET', async () => {
        // Non-ent app: site has no ssoRequired flag (or false). The BFF
        // must not call the customer-proxy auth-group GET at all — keeps
        // the per-mint cost zero for normal customers.
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt',
        });
        mockControlPlaneAdapter.getSite.mockResolvedValue({
          owner_customer_id: 'cust-1',
          // ssoRequired absent (or false) — same effect on the gate
        });

        const req = createMockRequest({ siteId: MOCK_SITE_ID });
        await POST(req);

        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ ssoRequired: false, ssoConfigured: false })
        );
        expect(mockMgmtClient.getSecrets).not.toHaveBeenCalled();
      });

      it('bakes ssoRequired:true + ssoConfigured:true when both pointer rows are in the auth group', async () => {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt',
        });
        mockControlPlaneAdapter.getSite.mockResolvedValue({
          owner_customer_id: 'cust-1',
          ssoRequired: true,
          ssoConfigId: 'cfg-godaddy-shopper',
          subscription_id: 'sub-1',
          system_id: 'sys-1',
          clientIdSecretName: 'GD_SSO_OAUTH_CLIENT_ID',
          clientSecretSecretName: 'GD_SSO_OAUTH_CLIENT_SECRET',
        });
        mockMgmtClient.getSecrets.mockResolvedValue(
          authSecretsResponse(['GD_SSO_OAUTH_CLIENT_ID', 'GD_SSO_OAUTH_CLIENT_SECRET']),
        );

        const req = createMockRequest({ siteId: MOCK_SITE_ID });
        await POST(req);

        // Customer-proxy GET is called with (subId, sysId, appId) — no
        // pointer-name argument; presence is computed from the response.
        expect(mockMgmtClient.getSecrets).toHaveBeenCalledWith('sub-1', 'sys-1', MOCK_SITE_ID);
        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ ssoRequired: true, ssoConfigured: true })
        );
      });

      it('bakes ssoRequired:true + ssoConfigured:false when the auth group is missing a pointer row', async () => {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt',
        });
        mockControlPlaneAdapter.getSite.mockResolvedValue({
          owner_customer_id: 'cust-1',
          ssoRequired: true,
          ssoConfigId: 'cfg-godaddy-shopper',
          subscription_id: 'sub-1',
          system_id: 'sys-1',
        });
        // Half-saved state — only one row present.
        mockMgmtClient.getSecrets.mockResolvedValue(
          authSecretsResponse(['GD_SSO_OAUTH_CLIENT_ID']),
        );

        const req = createMockRequest({ siteId: MOCK_SITE_ID });
        await POST(req);

        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ ssoRequired: true, ssoConfigured: false })
        );
      });

      it('fail-safes ssoConfigured to false when the auth-group GET throws', async () => {
        // If airo-go is unreachable at mint time, the agents/ middleware
        // would falsely permit publish if we left ssoConfigured undefined.
        // Behavior: ssoRequired stays true (we know that from the app GET),
        // ssoConfigured defaults to false → middleware blocks publish.
        // Restored once the next mint succeeds.
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt',
        });
        mockControlPlaneAdapter.getSite.mockResolvedValue({
          owner_customer_id: 'cust-1',
          ssoRequired: true,
          ssoConfigId: 'cfg-godaddy-shopper',
          subscription_id: 'sub-1',
          system_id: 'sys-1',
        });
        mockMgmtClient.getSecrets.mockRejectedValue(new Error('upstream timeout'));

        const req = createMockRequest({ siteId: MOCK_SITE_ID });
        await POST(req);

        expect(mockJWTService.getToken).toHaveBeenCalledWith(
          expect.objectContaining({ ssoRequired: true, ssoConfigured: false })
        );
        const warnCall = mockLogger.warn.mock.calls.find(
          ([event]: [string]) => event === 'agent-token.sso-config-presence.fetch-failed',
        );
        expect(warnCall).toBeDefined();
      });
    });

    describe('sharedWithMe owner-pays gate', function ownerPaysTests() {
      const SHARED_SITE = {
        sharedWithMe: true,
        team_venture_id: 'venture-1',
        subscription_id: 'owner-sub-1',
        owner_customer_id: 'owner-1',
      };

      function grantFga(grants: { publish?: boolean; download?: boolean }) {
        mockFgaListObjects.mockImplementation((_cfg: unknown, _token: unknown, opts: { relation: string }) => {
          if (opts.relation === AUTHZ_FGA_RELATIONS.canPublish) {
            return Promise.resolve(grants.publish ? ['venture-1'] : []);
          }
          if (opts.relation === AUTHZ_FGA_RELATIONS.canDownload) {
            return Promise.resolve(grants.download ? ['venture-1'] : []);
          }
          return Promise.resolve([]);
        });
      }

      async function mintedPerms() {
        const response = await POST(createMockRequest({ siteId: MOCK_SITE_ID }));
        expect(response.status).toBe(200);
        return mockJWTService.getToken.mock.calls[0][0];
      }

      beforeEach(function authAsCollaborator() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'collaborator-jwt',
        });
        mockControlPlaneAdapter.getSite.mockResolvedValue({ ...SHARED_SITE });
      });

      it('blocks publish + download when the owner is on a FREE plan, even with the FGA grants', async function freeOwner() {
        grantFga({ publish: true, download: true });
        mockMgmtClient.getSubscription.mockResolvedValue({ plan: SubscriptionPlan.Free });

        expect(await mintedPerms()).toMatchObject({ canPublish: false, canDownload: false });
      });

      it('allows publish when the owner is on a paid plan', async function paidOwner() {
        grantFga({ publish: true });
        mockMgmtClient.getSubscription.mockResolvedValue({ plan: SubscriptionPlan.Starter });

        expect(await mintedPerms()).toMatchObject({ canPublish: true });
      });

      it('allows a paid owner regardless of published-app count (no per-collaborator count limit)', async function paidOwnerNoCountLimit() {
        // Regression: an Ultimate owner with many published apps (e.g. 27/50) must
        // not be blocked. The gate is plan-only and never fetches the app inventory.
        grantFga({ publish: true, download: true });
        mockMgmtClient.getSubscription.mockResolvedValue({ plan: SubscriptionPlan.Ultimate });

        expect(await mintedPerms()).toMatchObject({ canPublish: true, canDownload: true });
        expect(mockMgmtClient.getApps).not.toHaveBeenCalled();
      });

      it('gates download on the owner plan (free blocked, paid allowed)', async function downloadGate() {
        grantFga({ download: true });
        mockMgmtClient.getSubscription.mockResolvedValue({ plan: SubscriptionPlan.Free });
        expect(await mintedPerms()).toMatchObject({ canDownload: false });
      });

      it('denies both and skips the owner lookup when the collaborator has no FGA grant', async function noGrant() {
        grantFga({ publish: false, download: false });
        mockMgmtClient.getSubscription.mockResolvedValue({ plan: SubscriptionPlan.Ultimate });

        expect(await mintedPerms()).toMatchObject({ canPublish: false, canDownload: false });
        expect(mockMgmtClient.getSubscription).not.toHaveBeenCalled();
      });

      it('fails closed when the owner subscription fetch fails', async function subscriptionFetchError() {
        grantFga({ publish: true, download: true });
        mockMgmtClient.getSubscription.mockRejectedValue(new Error('mgmt-airo unavailable'));

        expect(await mintedPerms()).toMatchObject({ canPublish: false, canDownload: false });
      });

      it('fails closed and skips the owner lookup when the shared app has no subscription_id', async function missingSubscriptionId() {
        mockControlPlaneAdapter.getSite.mockResolvedValue({
          sharedWithMe: true,
          team_venture_id: 'venture-1',
          owner_customer_id: 'owner-1',
        });
        grantFga({ publish: true, download: true });

        expect(await mintedPerms()).toMatchObject({ canPublish: false, canDownload: false });
        expect(mockMgmtClient.getSubscription).not.toHaveBeenCalled();
      });

      it('blocks a legacy AiroPlus owner (not a grants-paid plan)', async function legacyAiroPlusOwner() {
        grantFga({ publish: true, download: true });
        // No `plan`; legacy AiroPlus is derived from productId + hadAiroPlus → AiroPlus, which is NOT grants-paid.
        mockMgmtClient.getSubscription.mockResolvedValue({ productId: 'aab-v1', hadAiroPlus: true, isTrial: false });

        expect(await mintedPerms()).toMatchObject({ canPublish: false, canDownload: false });
      });
    });
  });
});
