/**
 * Unpublish Endpoint Tests
 *
 * Tests the POST /api/apps/[id]/unpublish endpoint to ensure proper:
 * - Authentication and authorization
 * - Feature flag validation
 * - Site ownership validation
 * - Agents service communication
 * - Control plane unpublish
 * - Domain disconnect option
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

/**
 * Mock dependencies using vi.hoisted to avoid hoisting issues
 */
const {
  mockControlPlaneAdapter,
  mockIsV2ControlPlaneEnabled,
  mockAuthenticateCustomer,
  mockAiroMgmtClient,
  mockLogger,
  mockAgentFetch,
  mockCheckSwitchboardFlag,
  mockJWTService,
} = vi.hoisted(function setup() {
  return {
    mockControlPlaneAdapter: {
      getSite: vi.fn(),
    },
    mockIsV2ControlPlaneEnabled: vi.fn(),
    mockAuthenticateCustomer: vi.fn(),
    mockAiroMgmtClient: {
      unpublishApp: vi.fn(),
      modifyDomains: vi.fn(),
    },
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    mockAgentFetch: vi.fn(),
    mockCheckSwitchboardFlag: vi.fn(),
    mockJWTService: {
      createToken: vi.fn().mockResolvedValue({ token: 'test-token', expires: new Date() }),
    },
  };
});

/**
 * Mock control plane adapter
 */
vi.mock('@/lib/control-plane', function mockControlPlaneModule() {
  return {
    getControlPlaneAdapter: vi.fn().mockReturnValue(mockControlPlaneAdapter),
    isV2ControlPlaneEnabled: mockIsV2ControlPlaneEnabled,
  };
});

/**
 * Mock mgmt-airo client
 */
vi.mock('@/lib/mgmt-airo', function mockMgmtAiroModule() {
  return {
    AiroMgmtClient: vi.fn().mockImplementation(() => mockAiroMgmtClient),
  };
});

/**
 * Mock logger
 */
vi.mock('@/lib/request-context', function mockLoggerModule() {
  return {
    logger: mockLogger,
  };
});

/**
 * Mock agent fetch (legacy - kept for compatibility)
 */
vi.mock('@/lib/agent-fetch', function mockAgentFetchModule() {
  return {
    agentFetch: mockAgentFetch,
  };
});

/**
 * Mock JWT service
 */
vi.mock('@/lib/jwt-service', function mockJWTServiceModule() {
  return {
    getJWTService: vi.fn().mockReturnValue(mockJWTService),
  };
});

/**
 * Mock switchboard
 */
vi.mock('@/lib/switchboard/server', function mockSwitchboardModule() {
  return {
    checkSwitchboardFlag: mockCheckSwitchboardFlag,
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
              requiresAuth: true,
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
  };
});

/**
 * Test fixtures
 */
const MOCK_SITE_ID = 'site-123';
const MOCK_ACCOUNT_ID = 'account-456';
const MOCK_SUBSCRIPTION_ID = 'subscription-789';
const MOCK_SYSTEM_ID = 'system-012';

const MOCK_USER = {
  shopperId: 'shopper-789',
  customerId: 'customer-789',
  accountId: MOCK_ACCOUNT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
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
  updated_at: new Date(),
  domains: [{ fqdn: 'example.com', domainType: 'custom' }],
};

const MOCK_LEGACY_SITE = {
  id: MOCK_SITE_ID,
  account_id: MOCK_ACCOUNT_ID,
  name: 'Legacy Site',
  status: 'running' as const,
  agent_url: 'https://agent.example.com',
  preview_url: 'https://preview.example.com',
  created_at: new Date(),
  updated_at: new Date(),
};

const MOCK_UNPUBLISH_RESPONSE = {
  message: 'App unpublished',
  subscriptionId: MOCK_SUBSCRIPTION_ID,
  systemId: MOCK_SYSTEM_ID,
  appId: MOCK_SITE_ID,
};

/**
 * Helper to create mock NextRequest
 */
function createMockRequest(
  siteId: string,
  body?: any,
  headers: Record<string, string> = {}
): NextRequest {
  const options: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  return new NextRequest(
    `http://localhost:3000/api/apps/${siteId}/unpublish`,
    options
  );
}

describe('unpublish POST', function unpublishTests() {
  describe('#POST', function postTests() {
    beforeEach(function resetMocks() {
      vi.clearAllMocks();

      // Default mock implementations
      mockIsV2ControlPlaneEnabled.mockReturnValue(true);
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockAiroMgmtClient.unpublishApp.mockResolvedValue(MOCK_UNPUBLISH_RESPONSE);
      mockJWTService.createToken.mockResolvedValue({ token: 'test-token', expires: new Date() });

      // Mock global fetch for agents service calls
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, status: 'unpublished' }),
        text: async () => JSON.stringify({ success: true, status: 'unpublished' }),
      }));
    });

    it('should unpublish V2 site successfully', async function unpublishSuccess() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('App unpublished');

      expect(mockAiroMgmtClient.unpublishApp).toHaveBeenCalledWith(
        MOCK_SUBSCRIPTION_ID,
        MOCK_SYSTEM_ID,
        MOCK_SITE_ID
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'unpublish.api.control_plane.success',
        expect.any(Object)
      );
    });

    it('should return 403 when feature flag is disabled', async function featureDisabled() {
      mockCheckSwitchboardFlag.mockResolvedValue(false);
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Feature not available');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'unpublish.api.feature_disabled',
        expect.any(Object)
      );
    });

    it('should return 401 when not authenticated', async function notAuthenticated() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: false,
        error: 'Invalid token',
      });

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 403 when user has no account', async function noAccount() {
      const userWithoutAccount = { ...MOCK_USER, accountId: undefined };
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: userWithoutAccount,
        jwt: 'user-jwt-token',
      });

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('You must have an account to unpublish apps');
    });

    it('should return 404 when site not found', async function siteNotFound() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(null);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Site not found');
    });

    it('should disconnect domain when requested', async function disconnectDomain() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const request = createMockRequest(MOCK_SITE_ID, {
        disconnectDomain: true,
        domainFqdn: 'example.com',
      });
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });

      expect(response.status).toBe(200);
      expect(mockAiroMgmtClient.modifyDomains).toHaveBeenCalledWith(
        MOCK_SUBSCRIPTION_ID,
        MOCK_SYSTEM_ID,
        MOCK_SITE_ID,
        { domainsToDelete: [{ fqdn: 'example.com' }] }
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'unpublish.api.disconnect_domain.start',
        expect.any(Object)
      );
    });

    it('should continue with unpublish when domain disconnect fails', async function domainDisconnectFails() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockAiroMgmtClient.modifyDomains.mockRejectedValue(
        new Error('Domain disconnect failed')
      );

      const request = createMockRequest(MOCK_SITE_ID, {
        disconnectDomain: true,
        domainFqdn: 'example.com',
      });
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.domainDisconnectFailed).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'unpublish.api.disconnect_domain.failed',
        expect.any(Object)
      );
    });

    it('should reject domain disconnect if domain not found on site', async function domainNotFound() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockIsV2ControlPlaneEnabled.mockReturnValue(true);

      const request = createMockRequest(MOCK_SITE_ID, {
        disconnectDomain: true,
        domainFqdn: 'not-on-site.com', // Domain that doesn't exist on the site
      });
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Domain not found on this site or is not a custom domain');
      expect(mockAiroMgmtClient.modifyDomains).not.toHaveBeenCalled();
    });

    it('should handle already unpublished app (409)', async function alreadyUnpublished() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const error = new Error('App does not have a publish variant');
      (error as any).status = 409;
      mockAiroMgmtClient.unpublishApp.mockRejectedValue(error);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('App is already unpublished');
    });

    it('should handle control plane error with retryable flag', async function controlPlaneError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const error = new Error('Hosting service error');
      (error as any).status = 502;
      mockAiroMgmtClient.unpublishApp.mockRejectedValue(error);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.error).toBe('Failed to unpublish app in control plane');
      expect(data.retryable).toBe(true);
    });

    it('should work for legacy site with agents only', async function legacySite() {
      mockIsV2ControlPlaneEnabled.mockReturnValue(false);
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_LEGACY_SITE);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockAiroMgmtClient.unpublishApp).not.toHaveBeenCalled();
    });

    it('should return 500 when both agents and control plane fail', async function bothFail() {
      mockIsV2ControlPlaneEnabled.mockReturnValue(false);
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_LEGACY_SITE);

      // Mock fetch to fail for agents service
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Agent error',
      }));

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, {
        params: Promise.resolve({ id: MOCK_SITE_ID }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to unpublish app');
      expect(data.retryable).toBe(true);
    });

    it('should call agents service with proper JWT token', async function callsAgents() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token',
      });

      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, status: 'unpublished' }),
        text: async () => JSON.stringify({ success: true, status: 'unpublished' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const request = createMockRequest(MOCK_SITE_ID);
      await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/apps/${MOCK_SITE_ID}/unpublish`),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });
  });
});
