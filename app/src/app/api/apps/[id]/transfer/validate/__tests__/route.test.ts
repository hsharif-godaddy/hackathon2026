import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAgentFetch = vi.fn();
const mockGetSite = vi.fn();

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (...args: any[]) => mockAgentFetch(...args),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: () => ({
    getSite: (...args: any[]) => mockGetSite(...args),
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

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: any, ...args: any[]) => {
      const authContext = (request as any).__testAuthContext ?? {
        jwt: 'test-jwt-token',
        user: { customerId: 'cust-123', email: 'test@example.com' },
      };
      return handler(request, authContext, ...args);
    };
  },
}));

function createRequest(url: string, authContext?: Record<string, unknown>): NextRequest {
  const request = new NextRequest(url);
  if (authContext) {
    (request as any).__testAuthContext = authContext;
  }
  return request;
}

const MOCK_SITE = {
  id: 'app-1',
  agent_url: 'https://agent.example.com',
  status: 'running',
};

describe('/api/apps/[id]/transfer/validate', function validateRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockGetSite.mockResolvedValue(MOCK_SITE);
  });

  describe('GET - Validate transfer eligibility', function getTests() {
    it('should return canTransfer true when no commerce integration', async function noCommerce() {
      mockAgentFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ canTransfer: true, gdCommerce: false }),
      });

      const { GET } = await import('../route');
      const response = await GET(
        createRequest('http://localhost:3000/api/apps/app-1/transfer/validate'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.canTransfer).toBe(true);
      expect(body.gdCommerce).toBe(false);
      expect(mockAgentFetch).toHaveBeenCalledWith(
        'https://agent.example.com/apps/app-1/transfer/validate',
        { siteId: 'app-1' }
      );
    });

    it('should return canTransfer false and log commerce block when commerce integration exists', async function hasCommerce() {
      mockAgentFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ canTransfer: false, gdCommerce: true }),
      });

      const { logger } = await import('@/lib/request-context');
      const { GET } = await import('../route');
      const response = await GET(
        createRequest('http://localhost:3000/api/apps/app-1/transfer/validate'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.canTransfer).toBe(false);
      expect(body.gdCommerce).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith('transfer.validate.commerce.blocked', {
        appId: 'app-1',
        gdCommerce: true,
      });
    });

    it('should not log commerce block when canTransfer is false for non-commerce reasons', async function nonCommerceBlock() {
      mockAgentFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ canTransfer: false, gdCommerce: false }),
      });

      const { logger } = await import('@/lib/request-context');
      const { GET } = await import('../route');
      const response = await GET(
        createRequest('http://localhost:3000/api/apps/app-1/transfer/validate'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.canTransfer).toBe(false);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should return 404 when site not found', async function siteNotFound() {
      mockGetSite.mockResolvedValue(null);

      const { GET } = await import('../route');
      const response = await GET(
        createRequest('http://localhost:3000/api/apps/app-1/transfer/validate'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Site not found');
    });

    it('should return error when agent responds with error status', async function agentError() {
      mockAgentFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const { GET } = await import('../route');
      const response = await GET(
        createRequest('http://localhost:3000/api/apps/app-1/transfer/validate'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to validate transfer eligibility');
    });

    it('should return 500 when agentFetch throws', async function fetchThrows() {
      mockAgentFetch.mockRejectedValue(new Error('Network error'));

      const { GET } = await import('../route');
      const response = await GET(
        createRequest('http://localhost:3000/api/apps/app-1/transfer/validate'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to validate transfer eligibility');
    });

    it('should fall back to AGENTS_SERVICE_URL when site has no agent_url', async function fallback() {
      mockGetSite.mockResolvedValue({ id: 'app-1', status: 'running', agent_url: null });
      mockAgentFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ canTransfer: true, gdCommerce: false }),
      });

      const { GET } = await import('../route');
      const response = await GET(
        createRequest('http://localhost:3000/api/apps/app-1/transfer/validate'),
        { params: Promise.resolve({ id: 'app-1' }) }
      );

      expect(response.status).toBe(200);
      expect(mockAgentFetch).toHaveBeenCalledWith(
        'http://localhost:4000/apps/app-1/transfer/validate',
        { siteId: 'app-1' }
      );
    });

    it('should return 401 when auth context has no jwt', async function noJwt() {
      const { GET } = await import('../route');
      const response = await GET(
        createRequest('http://localhost:3000/api/apps/app-1/transfer/validate', { jwt: null, user: null }),
        { params: Promise.resolve({ id: 'app-1' }) }
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Authentication token required');
    });
  });
});
