/**
 * Exports API Endpoint Tests
 *
 * Tests the GET and POST /api/apps/[id]/exports endpoints for:
 * - Authentication and authorization
 * - Site ownership validation
 * - Export tracking record creation
 * - Legacy site handling
 * - Export listing
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '../route';

const { mockControlPlaneAdapter, mockAuthenticateCustomer, mockAiroMgmtClient, mockLogger } = vi.hoisted(function setup() {
  return {
    mockControlPlaneAdapter: {
      getSite: vi.fn()
    },
    mockAuthenticateCustomer: vi.fn(),
    mockAiroMgmtClient: {
      recordExport: vi.fn(),
      getAppExports: vi.fn()
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
    AiroMgmtClient: vi.fn().mockImplementation(function () { return mockAiroMgmtClient; })
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

const MOCK_EXPORTS_LIST = {
  exports: [
    { id: 'export-123', initiatedBy: 'customer-789', exportedAt: '2025-01-15T10:00:00Z' },
    { id: 'export-456', initiatedBy: 'customer-789', exportedAt: '2025-01-16T10:00:00Z' }
  ],
  total: 2
};

function createMockPostRequest(siteId: string, body: any = {}): NextRequest {
  return new NextRequest(`http://localhost:3000/api/apps/${siteId}/exports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function createMockGetRequest(siteId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/apps/${siteId}/exports`, {
    method: 'GET'
  });
}

describe('exports API', function exportsApiTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    mockAiroMgmtClient.recordExport.mockResolvedValue(MOCK_EXPORT_RESPONSE);
    mockAiroMgmtClient.getAppExports.mockResolvedValue(MOCK_EXPORTS_LIST);
  });

  describe('#POST', function postTests() {
    it('should record export for V2 site with valid subscription/system IDs', async function recordExport() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const request = createMockPostRequest(MOCK_SITE_ID, { format: 'zip' });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.exportId).toBe('export-123');

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

    it('should return success=false for legacy site without V2 IDs', async function legacySite() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_LEGACY_SITE);

      const request = createMockPostRequest(MOCK_SITE_ID, { format: 'zip' });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Export not tracked (missing metadata)');
      expect(data.exportId).toBeNull();

      expect(mockAiroMgmtClient.recordExport).not.toHaveBeenCalled();
    });

    it('should return success=false when MHP-Airo call fails', async function mgmtAiroFailure() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockAiroMgmtClient.recordExport.mockResolvedValue(null);

      const request = createMockPostRequest(MOCK_SITE_ID, { format: 'zip' });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Export not tracked (MHP-Airo call failed)');
    });

    it('propagates downstream 401 AiroHttpError as 401 with authReason:2', async function mgmtAiroUnauthorized() {
      const { AiroHttpError } = await import('@/lib/mgmt-airo/types');
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockAiroMgmtClient.recordExport.mockRejectedValue(new AiroHttpError(401, 'Unauthorized', ''));

      const request = createMockPostRequest(MOCK_SITE_ID, { format: 'zip' });
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized', authReason: 2 });
    });

    it('should return 400 when request body is invalid JSON', async function invalidJson() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const request = new NextRequest(`http://localhost:3000/api/apps/${MOCK_SITE_ID}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{'
      });

      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request body');
    });

    it('should return 404 when site is not found', async function siteNotFound() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(null);

      const request = createMockPostRequest(MOCK_SITE_ID, {});
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Site not found');
    });

    it('should return 403 when user has no account', async function noAccount() {
      const userWithoutAccount = { ...MOCK_USER, accountId: undefined };
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: userWithoutAccount,
        jwt: 'user-jwt-token'
      });

      const request = createMockPostRequest(MOCK_SITE_ID, {});
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('You must have an account to export apps');
    });

    it('should return 401 when user is not authenticated', async function notAuthenticated() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: false,
        error: 'Invalid token'
      });

      const request = createMockPostRequest(MOCK_SITE_ID, {});
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should handle unexpected errors gracefully', async function unexpectedError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockRejectedValue(new Error('Database connection failed'));

      const request = createMockPostRequest(MOCK_SITE_ID, {});
      const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.message).toBe('Export not tracked (error occurred)');
    });
  });

  describe('#GET', function getTests() {
    it('should list exports for V2 site', async function listExports() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);

      const request = createMockGetRequest(MOCK_SITE_ID);
      const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.exports).toHaveLength(2);
      expect(data.total).toBe(2);

      expect(mockAiroMgmtClient.getAppExports).toHaveBeenCalledWith(
        MOCK_SUBSCRIPTION_ID,
        MOCK_SYSTEM_ID,
        MOCK_SITE_ID
      );
    });

    it('should return empty array for legacy site', async function legacySiteList() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_LEGACY_SITE);

      const request = createMockGetRequest(MOCK_SITE_ID);
      const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.exports).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.message).toBe('Site missing subscription metadata - no export tracking available');

      expect(mockAiroMgmtClient.getAppExports).not.toHaveBeenCalled();
    });

    it('should return 404 when site is not found', async function siteNotFound() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(null);

      const request = createMockGetRequest(MOCK_SITE_ID);
      const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Site not found');
    });

    it('should return 401 when JWT is missing', async function missingJwt() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: null
      });

      const request = createMockGetRequest(MOCK_SITE_ID);
      const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication required');
    });

    it('should return 500 on unexpected error', async function unexpectedError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      mockAiroMgmtClient.getAppExports.mockRejectedValue(new Error('API error'));

      const request = createMockGetRequest(MOCK_SITE_ID);
      const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch exports');
    });
  });
});
