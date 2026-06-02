import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

// Mock auth context that will be injected by withCustomerAuth mock
const mockAuthContext = {
  user: {
    customerId: 'test-customer-id',
    shopperId: 'test-shopper-id',
    accountId: 'test-account-id',
  },
  isAuthenticated: true,
  jwt: 'test-jwt-token',
};

const mockControlPlaneAdapter = {
  getSite: vi.fn(),
};

// Mock dependencies
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    // Wrap the handler to inject mockAuthContext automatically
    return (request: NextRequest) => handler(request, mockAuthContext);
  },
  createCustomerAuthError: vi.fn(function (message: string, status: number) {
    return new Response(JSON.stringify({ error: 'Forbidden', message }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return mockControlPlaneAdapter; }),
}));

vi.mock('@/lib/marketing/get-calendar-events', () => ({
  generateMilestoneEvents: vi.fn(function () { return []; }),
  getMonthDateRange: vi.fn(function () { return {
    startDate: '2024-01-01',
    endDate: '2024-01-31',
  }; }),
}));

vi.mock('@/lib/marketing/scan-scheduled-posts', () => ({
  getScheduledPostsForMonth: vi.fn(function () { return []; }),
}));

vi.mock('@/utils/getServerRootDomain', () => ({
  getApiBaseUrl: vi.fn(function () { return 'https://content-inspirations.api.test'; }),
}));

vi.mock('@/lib/marketing/social-posts', () => ({
  fetchSocialPostsFromAgents: vi.fn(function () { return Promise.resolve([]); }),
}));

/**
 * Helper to create mock NextRequest for testing
 * Note: This creates a request object for unit testing - no actual HTTP calls are made
 * The URL is only used for parsing the path and query parameters
 */
function createMockRequest(path: string): NextRequest {
  return new NextRequest(`http://test${path}`);
}

describe('Marketing Calendar API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();

    // Set up default control plane adapter mock to return a valid site owned by the test user
    mockControlPlaneAdapter.getSite.mockResolvedValue({
      id: 'test-site-id',
      created_at: new Date('2020-01-01'),
      updated_at: new Date('2020-01-01'),
      account_id: 'test-account-id',
      status: 'running',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input Validation', () => {
    it('should return 400 for missing appId parameter', async () => {
      const request = createMockRequest('/api/marketing/calendar');

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('siteId is required');
    });

    it('should return 400 for invalid month format (non-numeric year)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=abcd-01'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid month parameter');
    });

    it('should return 400 for invalid month format (non-numeric month)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-ab'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid month parameter');
    });

    it('should return 400 for month out of range (month 0)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-00'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid month parameter');
    });

    it('should return 400 for month out of range (month 13)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-13'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid month parameter');
    });

    it('should return 400 for year out of range (too old)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=1899-01'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid month parameter');
    });

    it('should return 400 for year out of range (too far in future)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2101-01'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid month parameter');
    });

    it('should return 400 for invalid siteId format (not a UUID)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=invalid-id&month=2024-01'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid siteId format');
    });

    it('should return 400 for invalid market format', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-01&market=invalid'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid market format');
    });

    it('should return 400 for invalid timezone format', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-01&market=en-US&timezone=invalid/../../etc'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid timezone format');
    });
  });

  describe('Authorization', () => {
    it('should return 403 when user does not own the site', async () => {
      // Mock a site owned by a different account
      mockControlPlaneAdapter.getSite.mockResolvedValueOnce({
        id: '12345678-1234-1234-1234-123456789abc',
        created_at: new Date('2020-01-01'),
        updated_at: new Date('2020-01-01'),
        account_id: 'different-account-id', // Different from mockAuthContext.user.accountId
        status: 'running',
      });

      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-01&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.message).toContain('permission');
    });

    it('should succeed when user owns the site', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-01&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Date Parsing Edge Cases', () => {
    beforeEach(() => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });
    });

    it('should handle leap year February (2024-02)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-02&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events).toBeDefined();
    });

    it('should handle non-leap year February (2023-02)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2023-02&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events).toBeDefined();
    });

    it('should handle December to January boundary (2024-12)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-12&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events).toBeDefined();
    });

    it('should handle DST transition month (March in US)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-03&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events).toBeDefined();
    });

    it('should handle DST transition month (November in US)', async () => {
      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-11&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events).toBeDefined();
    });
  });

  describe('External API Timeout Handling', () => {
    it('should handle timeout from Content Inspirations API', async () => {
      // Mock fetch to simulate timeout
      (global.fetch as any).mockImplementation(function () {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          }, 100);
        });
      });

      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-01&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);

      // Should still return 200 with empty events (graceful degradation)
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events).toBeDefined();
    });

    it('should handle network error from Content Inspirations API', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-01&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);

      // Should still return 200 with empty events (graceful degradation)
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events).toBeDefined();
    });
  });

  describe('Site Not Found', () => {
    it('should return 404 if site not found', async () => {
      mockControlPlaneAdapter.getSite.mockResolvedValueOnce(null);

      const request = createMockRequest(
        '/api/marketing/calendar?siteId=12345678-1234-1234-1234-123456789abc&month=2024-01&market=en-US&timezone=America/New_York'
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Site not found');
    });
  });
});
