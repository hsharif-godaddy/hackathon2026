/**
 * Sites API Route Tests
 * 
 * Tests the /api/sites endpoint, focusing on error handling
 * and authentication flow with the control plane adapter.
 * 
 * Complete 401 Authentication Flow:
 * 1. Adapter: listSites() throws error with status=401
 * 2. Route: Catches error, calls handleControlPlaneError()
 * 3. Handler: Returns NextResponse with status=401
 * 4. Client: authFetch() intercepts 401 response
 * 5. Client: authFetch() calls clientRedirect(window)
 * 6. Browser: Redirects to SSO login page
 * 
 * Note: These tests cover steps 1-3 (server-side).
 * Steps 4-6 (client-side redirect) are handled by @godaddy/gasket-auth's authFetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Mock modules before importing the route
 */
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => handler,
  customerHasAccount: vi.fn(() => true),
  createCustomerAuthError: vi.fn()
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn()
}));

describe('/api/sites', function sitesRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('GET /api/sites - Authentication Errors', function authErrorTests() {
    it('should return 401 when adapter.listSites throws 401 error', async function test401FromAdapter() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');
      
      // Create error with status property (duck typing)
      const mockError = Object.assign(
        new Error('API request failed: 401 Unauthorized - Token expired'),
        { status: 401 }
      );
      
      // Mock adapter that throws 401
      const mockAdapter = {
        listSites: vi.fn().mockRejectedValue(mockError)
      };
      
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);
      
      // Create mock request
      const request = new NextRequest('http://localhost:3000/api/sites');
      const authContext = {
        user: { accountId: 'test-account' },
        jwt: 'test-jwt-token'
      };
      
      // Call the route handler
      const response = await GET(request, authContext as any);
      const body = await response.json();
      
      // Should return 401 for client-side redirect
      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(mockAdapter.listSites).toHaveBeenCalledWith('test-jwt-token');
    });

    it('should return 403 when adapter.listSites throws 403 error', async function test403FromAdapter() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');
      
      // Create error with status property (duck typing)
      const mockError = Object.assign(
        new Error('API request failed: 403 Forbidden - Access denied'),
        { status: 403 }
      );
      
      // Mock adapter that throws 403
      const mockAdapter = {
        listSites: vi.fn().mockRejectedValue(mockError)
      };
      
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);
      
      // Create mock request
      const request = new NextRequest('http://localhost:3000/api/sites');
      const authContext = {
        user: { accountId: 'test-account' },
        jwt: 'test-jwt-token'
      };
      
      // Call the route handler
      const response = await GET(request, authContext as any);
      const body = await response.json();
      
      // Should return 403
      expect(response.status).toBe(403);
      expect(body.error).toBe('Forbidden');
    });

    it('should return sites list when adapter.listSites succeeds', async function testSuccessfulList() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');
      
      const mockSites = [
        {
          id: 'site-1',
          name: 'Test Site 1',
          status: 'running',
          account_id: 'test-account',
          created_at: new Date('2025-01-01T00:00:00.000Z'),
          updated_at: new Date('2025-01-01T00:00:00.000Z')
        },
        {
          id: 'site-2',
          name: 'Test Site 2',
          status: 'running',
          account_id: 'test-account',
          created_at: new Date('2025-01-01T00:00:00.000Z'),
          updated_at: new Date('2025-01-01T00:00:00.000Z')
        }
      ];
      
      // Mock adapter that returns sites
      const mockAdapter = {
        listSites: vi.fn().mockResolvedValue(mockSites)
      };
      
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);
      
      // Create mock request
      const request = new NextRequest('http://localhost:3000/api/sites');
      const authContext = {
        user: { accountId: 'test-account' },
        jwt: 'test-jwt-token'
      };
      
      // Call the route handler
      const response = await GET(request, authContext as any);
      const body = await response.json();
      
      // Should return sites (dates serialized as ISO strings)
      expect(response.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe('site-1');
      expect(body[1].id).toBe('site-2');
      expect(mockAdapter.listSites).toHaveBeenCalledWith('test-jwt-token');
    });

    it('should return 500 for generic errors', async function testGenericError() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');
      
      // Generic error without status
      const mockError = new Error('Database connection failed');
      
      // Mock adapter that throws generic error
      const mockAdapter = {
        listSites: vi.fn().mockRejectedValue(mockError)
      };
      
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);
      
      // Create mock request
      const request = new NextRequest('http://localhost:3000/api/sites');
      const authContext = {
        user: { accountId: 'test-account' },
        jwt: 'test-jwt-token'
      };
      
      // Call the route handler
      const response = await GET(request, authContext as any);
      const body = await response.json();
      
      // Should return 500
      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(body.details).toBe('Database connection failed');
    });
  });

  describe('GET /api/sites?site_id=X - Authentication Errors', function getSiteAuthTests() {
    it('should return 401 when adapter.getSite throws 401 error', async function test401FromGetSite() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');
      
      // Create error with status property (duck typing)
      const mockError = Object.assign(
        new Error('API request failed: 401 Unauthorized - Token expired'),
        { status: 401 }
      );
      
      // Mock adapter that throws 401
      const mockAdapter = {
        getSite: vi.fn().mockRejectedValue(mockError)
      };
      
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);
      
      // Create mock request with site_id param
      const request = new NextRequest('http://localhost:3000/api/sites?site_id=test-site-123');
      const authContext = {
        user: { accountId: 'test-account' },
        jwt: 'test-jwt-token'
      };
      
      // Call the route handler
      const response = await GET(request, authContext as any);
      const body = await response.json();
      
      // Should return 401 for client-side redirect
      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(mockAdapter.getSite).toHaveBeenCalledWith('test-site-123', 'test-jwt-token');
    });
  });
});

