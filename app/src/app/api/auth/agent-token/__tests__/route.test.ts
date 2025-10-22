/**
 * Agent Token Endpoint Tests
 * 
 * Tests the /api/auth/agent-token endpoint to ensure proper authentication,
 * authorization, and site ownership validation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '../route';
import { NextRequest } from 'next/server';

/**
 * Mock dependencies using vi.hoisted to avoid hoisting issues
 */
const { mockJWTService, mockSiteAdapter, mockAuthenticateCustomer, mockControlPlaneAdapter, mockIsV2ControlPlaneEnabled } = vi.hoisted(function setup() {
  return {
    mockJWTService: {
      getToken: vi.fn(),
      createToken: vi.fn()
    },
    mockSiteAdapter: {
      requiresAuth: vi.fn(),
      getSiteById: vi.fn()
    },
    mockControlPlaneAdapter: {
      getSite: vi.fn()
    },
    mockIsV2ControlPlaneEnabled: vi.fn(),
    mockAuthenticateCustomer: vi.fn()
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
 * Mock site adapter factory
 */
vi.mock('@/lib/site-adapters/SiteAdapterFactory', function mockSiteAdapterModule() {
  return {
    SiteAdapterFactory: {
      getInstance: vi.fn().mockReturnValue(mockSiteAdapter)
    }
  };
});

/**
 * Mock control plane adapter
 */
vi.mock('@/lib/control-plane', function mockControlPlaneModule() {
  return {
    getControlPlaneAdapter: vi.fn().mockReturnValue(mockControlPlaneAdapter),
    isV2ControlPlaneEnabled: mockIsV2ControlPlaneEnabled
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

const MOCK_SITE = {
  id: MOCK_SITE_ID,
  account_id: MOCK_ACCOUNT_ID,
  name: 'Test Site',
  status: 'running',
  agent_url: 'https://agent.example.com',
  preview_url: 'https://preview.example.com'
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
      
      // Default mock implementations - use legacy mode by default
      mockIsV2ControlPlaneEnabled.mockReturnValue(false);
      mockSiteAdapter.requiresAuth.mockReturnValue(true);
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
      
      mockSiteAdapter.getSiteById.mockResolvedValue(MOCK_SITE);

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
      expect(mockJWTService.getToken).toHaveBeenCalledWith({
        siteId: MOCK_SITE_ID
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
      expect(mockJWTService.getToken).not.toHaveBeenCalled();
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

    it('should reject request when site does not exist', async function rejectNonexistentSite() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      
      mockSiteAdapter.getSiteById.mockResolvedValue(null);

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        error: 'Site not found'
      });
      expect(mockJWTService.getToken).not.toHaveBeenCalled();
    });

    it('should reject request when user does not own the site', async function rejectWrongOwner() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      
      mockSiteAdapter.getSiteById.mockResolvedValue({
        ...MOCK_SITE,
        account_id: 'different-account-id'
      });

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        error: 'You can only create tokens for your own sites'
      });
      expect(mockJWTService.getToken).not.toHaveBeenCalled();
    });

    it('should allow token creation when auth is not required', async function allowNoAuth() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: {
          ...MOCK_USER,
          accountId: undefined
        },
        jwt: 'user-jwt-token'
      });
      
      mockSiteAdapter.requiresAuth.mockReturnValue(false);
      mockSiteAdapter.getSiteById.mockResolvedValue(MOCK_SITE);

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.token).toBe(MOCK_JWT_TOKEN);
    });

    it('should handle JWT service errors gracefully', async function handleJWTError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      
      mockSiteAdapter.getSiteById.mockResolvedValue(MOCK_SITE);
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

    it('should handle site adapter errors gracefully', async function handleAdapterError() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      
      mockSiteAdapter.getSiteById.mockRejectedValue(new Error('Database connection failed'));

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Token creation failed',
        details: 'Database connection failed'
      });
    });

    it('should validate multiple sites for same user', async function validateMultipleSites() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const site1 = { ...MOCK_SITE, id: 'site-1', account_id: MOCK_ACCOUNT_ID };
      const site2 = { ...MOCK_SITE, id: 'site-2', account_id: MOCK_ACCOUNT_ID };

      mockSiteAdapter.getSiteById.mockResolvedValueOnce(site1);
      const request1 = createMockRequest({ siteId: 'site-1' });
      const response1 = await POST(request1);
      expect(response1.status).toBe(200);

      mockSiteAdapter.getSiteById.mockResolvedValueOnce(site2);
      const request2 = createMockRequest({ siteId: 'site-2' });
      const response2 = await POST(request2);
      expect(response2.status).toBe(200);

      expect(mockJWTService.getToken).toHaveBeenCalledTimes(2);
    });

    it('should reject when siteId is empty string', async function rejectEmptySiteId() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });

      const request = createMockRequest({ siteId: '' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'siteId is required'
      });
    });

    it('should include correct token expiration in response', async function includeExpiration() {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: 'user-jwt-token'
      });
      
      mockSiteAdapter.getSiteById.mockResolvedValue(MOCK_SITE);

      const customExpires = new Date('2025-12-31T23:59:59Z');
      mockJWTService.getToken.mockResolvedValue({
        token: MOCK_JWT_TOKEN,
        expires: customExpires
      });

      const request = createMockRequest({ siteId: MOCK_SITE_ID });
      const response = await POST(request);
      const data = await response.json();

      expect(data.expires).toBe(customExpires.toISOString());
    });

    describe('expiresInSeconds parameter', function expiresTests() {
      it('should create token with custom expiration when expiresInSeconds is provided', async function customExpiration() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockSiteAdapter.getSiteById.mockResolvedValue(MOCK_SITE);

        const expiresInSeconds = 300;
        const request = createMockRequest({ 
          siteId: MOCK_SITE_ID,
          expiresInSeconds 
        });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          token: MOCK_JWT_TOKEN,
          expires: MOCK_TOKEN_EXPIRES.toISOString(),
          siteId: MOCK_SITE_ID,
          type: 'jwt',
          expiresInSeconds
        });
        expect(mockJWTService.createToken).toHaveBeenCalledWith(
          { siteId: MOCK_SITE_ID },
          expiresInSeconds
        );
        expect(mockJWTService.getToken).not.toHaveBeenCalled();
      });

      it('should use getToken when expiresInSeconds is not provided', async function defaultExpiration() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockSiteAdapter.getSiteById.mockResolvedValue(MOCK_SITE);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.expiresInSeconds).toBeUndefined();
        expect(mockJWTService.getToken).toHaveBeenCalledWith({
          siteId: MOCK_SITE_ID
        });
        expect(mockJWTService.createToken).not.toHaveBeenCalled();
      });

      it('should reject when expiresInSeconds is zero', async function rejectZero() {
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
        expect(mockJWTService.createToken).not.toHaveBeenCalled();
        expect(mockJWTService.getToken).not.toHaveBeenCalled();
      });

      it('should reject when expiresInSeconds is negative', async function rejectNegative() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });

        const request = createMockRequest({ 
          siteId: MOCK_SITE_ID,
          expiresInSeconds: -100 
        });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toEqual({
          error: 'expiresInSeconds must be greater than 0'
        });
        expect(mockJWTService.createToken).not.toHaveBeenCalled();
      });

      it('should reject when expiresInSeconds exceeds 12 hours', async function rejectTooLarge() {
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
        expect(mockJWTService.createToken).not.toHaveBeenCalled();
      });

      it('should accept expiresInSeconds at maximum limit (12 hours)', async function acceptMaximum() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockSiteAdapter.getSiteById.mockResolvedValue(MOCK_SITE);

        const expiresInSeconds = 43200;
        const request = createMockRequest({ 
          siteId: MOCK_SITE_ID,
          expiresInSeconds 
        });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.expiresInSeconds).toBe(expiresInSeconds);
        expect(mockJWTService.createToken).toHaveBeenCalledWith(
          { siteId: MOCK_SITE_ID },
          expiresInSeconds
        );
      });

      it('should create short-lived token for WebSocket use case', async function websocketToken() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockSiteAdapter.getSiteById.mockResolvedValue(MOCK_SITE);

        const expiresInSeconds = 300;
        const request = createMockRequest({ 
          siteId: MOCK_SITE_ID,
          expiresInSeconds 
        });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.expiresInSeconds).toBe(300);
        expect(mockJWTService.createToken).toHaveBeenCalledWith(
          { siteId: MOCK_SITE_ID },
          300
        );
      });
    });

    describe('V2 control plane mode', function v2Tests() {
      beforeEach(function setupV2() {
        mockIsV2ControlPlaneEnabled.mockReturnValue(true);
      });

      it('should create agent token using control plane adapter in V2 mode', async function createV2Token() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_SITE);

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
        expect(mockControlPlaneAdapter.getSite).toHaveBeenCalledWith(MOCK_SITE_ID, 'user-jwt-token');
        expect(mockJWTService.getToken).toHaveBeenCalledWith({
          siteId: MOCK_SITE_ID
        });
      });

      it('should reject when user has no account in V2 mode', async function v2RejectNoAccount() {
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
        expect(mockControlPlaneAdapter.getSite).not.toHaveBeenCalled();
      });

      it('should return 404 when site not found in V2 mode', async function v2SiteNotFound() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockControlPlaneAdapter.getSite.mockResolvedValue(null);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data).toEqual({
          error: 'Site not found'
        });
      });

      it('should handle control plane adapter errors in V2 mode', async function v2HandleError() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockControlPlaneAdapter.getSite.mockRejectedValue(new Error('Control plane connection failed'));

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data).toEqual({
          error: 'Token creation failed',
          details: 'Control plane connection failed'
        });
      });

      it('should not use SiteAdapterFactory in V2 mode', async function v2NoSiteAdapter() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_SITE);

        const request = createMockRequest({ siteId: MOCK_SITE_ID });
        await POST(request);

        // Should not call SiteAdapter methods
        expect(mockSiteAdapter.getSiteById).not.toHaveBeenCalled();
        expect(mockSiteAdapter.requiresAuth).not.toHaveBeenCalled();
      });

      it('should support custom expiresInSeconds in V2 mode', async function v2CustomExpiration() {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token'
        });
        
        mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_SITE);

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
          { siteId: MOCK_SITE_ID },
          expiresInSeconds
        );
        expect(mockJWTService.getToken).not.toHaveBeenCalled();
      });

      it('should validate expiresInSeconds limits in V2 mode', async function v2ValidateLimits() {
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
        expect(mockControlPlaneAdapter.getSite).not.toHaveBeenCalled();
      });
    });
  });
});

