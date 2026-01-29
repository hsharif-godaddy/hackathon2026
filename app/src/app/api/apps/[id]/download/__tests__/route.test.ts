/**
 * Download Endpoint Tests
 *
 * Tests the POST /api/apps/[id]/download endpoint to ensure:
 * - Authentication and authorization
 * - Export tracking before returning download URL
 * - Returns correct download URL and token
 * - Error handling
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const {
  mockControlPlaneAdapter,
  mockAuthenticateCustomer,
  mockAiroMgmtClient,
  mockJwtService,
  mockPaywallProvider,
  mockLogger
} = vi.hoisted(function setup() {
  return {
    mockControlPlaneAdapter: {
      getSite: vi.fn()
    },
    mockAuthenticateCustomer: vi.fn(),
    mockAiroMgmtClient: {
      recordExport: vi.fn()
    },
    mockJwtService: {
      createToken: vi.fn()
    },
    mockPaywallProvider: {
      checkPaywallEligibility: vi.fn()
    },
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }
  };
});

vi.mock('@/lib/control-plane', function mockControlPlaneModule() {
  return {
    getControlPlaneAdapter: vi.fn().mockReturnValue(mockControlPlaneAdapter)
  };
});

vi.mock('@/lib/mgmt-airo', function mockMgmtAiroModule() {
  return {
    AiroMgmtClient: vi.fn().mockImplementation(() => mockAiroMgmtClient)
  };
});

vi.mock('@/lib/jwt-service', function mockJwtServiceModule() {
  return {
    getJWTService: vi.fn().mockReturnValue(mockJwtService)
  };
});

vi.mock('@/lib/paywall/core', function mockPaywallCoreModule() {
  return {
    checkPaywallEligibility: vi.fn().mockImplementation(() => mockPaywallProvider.checkPaywallEligibility())
  };
});

vi.mock('@/lib/paywall/server-provider', function mockPaywallProviderModule() {
  return {
    ServerPaywallProvider: vi.fn()
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

const MOCK_SITE_ID = 'site-123';
const MOCK_ACCOUNT_ID = 'account-456';
const MOCK_SUBSCRIPTION_ID = 'subscription-789';
const MOCK_SYSTEM_ID = 'system-012';
const MOCK_AGENT_TOKEN = 'agent-jwt-token';

const MOCK_USER = {
  shopperId: 'shopper-789',
  customerId: 'customer-789',
  accountId: MOCK_ACCOUNT_ID,
  authType: 'sso',
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
};

const MOCK_EXPORT_RESPONSE = {
  id: 'export-123',
  subscriptionId: MOCK_SUBSCRIPTION_ID,
  appId: MOCK_SITE_ID,
  exportedAt: '2025-01-15T10:00:00Z'
};

function createMockRequest(siteId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/apps/${siteId}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('download POST', function downloadTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();

    mockPaywallProvider.checkPaywallEligibility.mockResolvedValue({
      hasAccess: true,
      reason: 'Active subscription'
    });

    mockJwtService.createToken.mockResolvedValue({
      token: MOCK_AGENT_TOKEN,
      expires: new Date(Date.now() + 3600000)
    });

    mockAiroMgmtClient.recordExport.mockResolvedValue(MOCK_EXPORT_RESPONSE);
  });

  describe('#POST', function postTests() {
    it('should track export and return download URL for V2 site', async function trackAndReturnUrl() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.downloadUrl).toBe(`${MOCK_V2_SITE.agent_url}/apps/${MOCK_SITE_ID}/zip`);
      expect(data.token).toBe(MOCK_AGENT_TOKEN);
      expect(data.filename).toBe('Test-Site.zip');
      expect(data.tracked).toBe(true);
      expect(data.exportId).toBe('export-123');

      // Verify tracking was called
      expect(mockAiroMgmtClient.recordExport).toHaveBeenCalledWith(
        MOCK_SUBSCRIPTION_ID,
        MOCK_SYSTEM_ID,
        MOCK_SITE_ID,
        expect.objectContaining({
          initiatedBy: 'customer-789',
          appName: 'Test Site'
        })
      );
    });

    it('should return download URL without tracking for legacy site', async function legacySite() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_LEGACY_SITE);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.downloadUrl).toBe(`${MOCK_LEGACY_SITE.agent_url}/apps/${MOCK_SITE_ID}/zip`);
      expect(data.token).toBe(MOCK_AGENT_TOKEN);
      expect(data.tracked).toBe(false);

      // Verify tracking was NOT called (no V2 IDs)
      expect(mockAiroMgmtClient.recordExport).not.toHaveBeenCalled();
    });

    it('should return download URL even if tracking fails', async function trackingFailure() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockAiroMgmtClient.recordExport.mockResolvedValue(null);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.downloadUrl).toBeDefined();
      expect(data.token).toBeDefined();
      expect(data.tracked).toBe(false);
    });

    it('should return 403 when user lacks paid subscription', async function paywallBlock() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockPaywallProvider.checkPaywallEligibility.mockResolvedValue({
        hasAccess: false,
        reason: 'No active subscription'
      });

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Download requires Paid subscription');

      // Should not call tracking
      expect(mockAiroMgmtClient.recordExport).not.toHaveBeenCalled();
    });

    it('should return 404 when site is not found', async function siteNotFound() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(null);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Site not found');
    });

    it('should return 503 when agent is not available', async function agentNotAvailable() {
      const siteWithoutAgent = { ...MOCK_V2_SITE, agent_url: undefined };
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(siteWithoutAgent);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toContain('agent is not available');
    });

    it('should return 403 when user has no account', async function noAccount() {
      const userWithoutAccount = { ...MOCK_USER, accountId: undefined };
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: userWithoutAccount,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('You must have an account to download apps');
    });

    it('should return 401 when user is not authenticated', async function notAuthenticated() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: false,
        error: 'Invalid token'
      });

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should sanitize filename for special characters', async function sanitizeFilename() {
      const siteWithSpecialChars = {
        ...MOCK_V2_SITE,
        name: 'My App! @Special #Test'
      };
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(siteWithSpecialChars);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.filename).toBe('My-App---Special--Test.zip');
    });

    it('should use site ID for filename when site name is missing', async function fallbackFilename() {
      const siteWithoutName = { ...MOCK_V2_SITE, name: undefined };
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(siteWithoutName);

      const request = createMockRequest(MOCK_SITE_ID);
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.filename).toBe(`app-${MOCK_SITE_ID}.zip`);
    });
  });
});
