import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    return async (request: any, ctx: any) => {
      const mockAuthContext = {
        jwt: 'test-jwt-token',
        user: { accountId: 'test-account', email: 'test@example.com' },
      };
      return handler(request, mockAuthContext, ctx);
    };
  },
  customerHasAccount: vi.fn(() => true),
  createCustomerAuthError: vi.fn((msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })
  ),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(),
}));

vi.mock('@/lib/translations/server-intl', () => ({
  detectLocale: vi.fn().mockResolvedValue('en-US'),
}));

describe('/api/sites/[id]/archive-status', function archiveStatusRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('GET - success', function getSuccessTests() {
    it('should return archive status when adapter succeeds', async function returnsStatus() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');

      const mockAdapter = {
        getArchiveStatus: vi.fn().mockResolvedValue({ isArchived: true, canRestore: true }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest('http://localhost:3000/api/sites/test-site-123/archive-status');
      const response = await GET(request, { params: Promise.resolve({ id: 'test-site-123' }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.isArchived).toBe(true);
      expect(body.canRestore).toBe(true);
      expect(mockAdapter.getArchiveStatus).toHaveBeenCalledWith('test-site-123', 'test-jwt-token');
    });

    it('should return isArchived false for non-archived apps', async function returnsNotArchived() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');

      const mockAdapter = {
        getArchiveStatus: vi.fn().mockResolvedValue({ isArchived: false, canRestore: false }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest('http://localhost:3000/api/sites/site-99/archive-status');
      const response = await GET(request, { params: Promise.resolve({ id: 'site-99' }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.isArchived).toBe(false);
      expect(body.canRestore).toBe(false);
    });
  });

  describe('GET - error handling', function getErrorTests() {
    it('should return 401 when adapter throws 401', async function returns401() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');

      const mockError = Object.assign(new Error('Unauthorized'), { status: 401 });
      const mockAdapter = { getArchiveStatus: vi.fn().mockRejectedValue(mockError) };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest('http://localhost:3000/api/sites/test-site/archive-status');
      const response = await GET(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(response.status).toBe(401);
    });

    it('should return 404 when adapter throws 404', async function returns404() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');

      const mockError = Object.assign(new Error('Not Found'), { status: 404 });
      const mockAdapter = { getArchiveStatus: vi.fn().mockRejectedValue(mockError) };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest('http://localhost:3000/api/sites/test-site/archive-status');
      const response = await GET(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(response.status).toBe(404);
    });

    it('should return 500 for generic errors', async function returns500() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { GET } = await import('../route');

      const mockAdapter = { getArchiveStatus: vi.fn().mockRejectedValue(new Error('DB failure')) };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest('http://localhost:3000/api/sites/test-site/archive-status');
      const response = await GET(request, { params: Promise.resolve({ id: 'test-site' }) });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });

    it('should return 403 when customerHasAccount returns false', async function returns403() {
      const { customerHasAccount } = await import('@/lib/customer-auth');
      const { GET } = await import('../route');

      (customerHasAccount as any).mockReturnValueOnce(false);

      const request = new NextRequest('http://localhost:3000/api/sites/test-site/archive-status');
      const response = await GET(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(response.status).toBe(403);
    });
  });
});
