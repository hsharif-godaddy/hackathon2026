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
  customerHasAccount: vi.fn(function () { return true; }),
  createCustomerAuthError: vi.fn(function (msg: string, status: number) { return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } }); }
  ),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(),
}));

vi.mock('@/lib/translations/server-intl', () => ({
  detectTranslationLocale: vi.fn().mockResolvedValue('en-US'),
}));

describe('/api/sites/[id]/archive-restore', function archiveRestoreRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('POST - success', function postSuccessTests() {
    it('should return 202 with statusJobId when restore is initiated', async function returns202() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      const mockAdapter = {
        startArchiveRestore: vi.fn().mockResolvedValue({
          statusJobId: 'job-abc-123',
          estimatedRestoreTime: '3-5 minutes',
        }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest(
        'http://localhost:3000/api/sites/test-site-123/archive-restore',
        { method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } }
      );
      const response = await POST(request, { params: Promise.resolve({ id: 'test-site-123' }) });
      const body = await response.json();

      expect(response.status).toBe(202);
      expect(body.statusJobId).toBe('job-abc-123');
      expect(mockAdapter.startArchiveRestore).toHaveBeenCalledWith(
        'test-site-123',
        'test-jwt-token',
        undefined
      );
    });

    it('should forward targetCell from request body to adapter', async function forwardsTargetCell() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      const mockAdapter = {
        startArchiveRestore: vi.fn().mockResolvedValue({ statusJobId: 'job-xyz' }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest(
        'http://localhost:3000/api/sites/test-site/archive-restore',
        {
          method: 'POST',
          body: JSON.stringify({ targetCell: 'us-west-2' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const response = await POST(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(response.status).toBe(202);
      expect(mockAdapter.startArchiveRestore).toHaveBeenCalledWith(
        'test-site',
        'test-jwt-token',
        { targetCell: 'us-west-2' }
      );
    });

    it('should handle empty body gracefully', async function emptyBodyGraceful() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      const mockAdapter = {
        startArchiveRestore: vi.fn().mockResolvedValue({ statusJobId: 'job-no-body' }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest(
        'http://localhost:3000/api/sites/test-site/archive-restore',
        { method: 'POST' }
      );
      const response = await POST(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(response.status).toBe(202);
      expect(mockAdapter.startArchiveRestore).toHaveBeenCalledWith('test-site', 'test-jwt-token', undefined);
    });

    it('should ignore non-string targetCell values', async function ignoresNonStringTargetCell() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      const mockAdapter = {
        startArchiveRestore: vi.fn().mockResolvedValue({ statusJobId: 'job-type-check' }),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest(
        'http://localhost:3000/api/sites/test-site/archive-restore',
        {
          method: 'POST',
          body: JSON.stringify({ targetCell: 12345 }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      await POST(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(mockAdapter.startArchiveRestore).toHaveBeenCalledWith('test-site', 'test-jwt-token', undefined);
    });
  });

  describe('POST - error handling', function postErrorTests() {
    it('should return 401 when adapter throws 401', async function returns401() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      const mockError = Object.assign(new Error('Unauthorized'), { status: 401 });
      const mockAdapter = { startArchiveRestore: vi.fn().mockRejectedValue(mockError) };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest(
        'http://localhost:3000/api/sites/test-site/archive-restore',
        { method: 'POST' }
      );
      const response = await POST(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(response.status).toBe(401);
    });

    it('should return 404 when adapter throws 404', async function returns404() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      const mockError = Object.assign(new Error('Not Found'), { status: 404 });
      const mockAdapter = { startArchiveRestore: vi.fn().mockRejectedValue(mockError) };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest(
        'http://localhost:3000/api/sites/test-site/archive-restore',
        { method: 'POST' }
      );
      const response = await POST(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(response.status).toBe(404);
    });

    it('should return 500 for generic errors', async function returns500() {
      const { getControlPlaneAdapter } = await import('@/lib/control-plane');
      const { POST } = await import('../route');

      const mockAdapter = {
        startArchiveRestore: vi.fn().mockRejectedValue(new Error('Restore service unavailable')),
      };
      (getControlPlaneAdapter as any).mockReturnValue(mockAdapter);

      const request = new NextRequest(
        'http://localhost:3000/api/sites/test-site/archive-restore',
        { method: 'POST' }
      );
      const response = await POST(request, { params: Promise.resolve({ id: 'test-site' }) });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });

    it('should return 403 when customerHasAccount returns false', async function returns403() {
      const { customerHasAccount } = await import('@/lib/customer-auth');
      const { POST } = await import('../route');

      (customerHasAccount as any).mockReturnValueOnce(false);

      const request = new NextRequest(
        'http://localhost:3000/api/sites/test-site/archive-restore',
        { method: 'POST' }
      );
      const response = await POST(request, { params: Promise.resolve({ id: 'test-site' }) });

      expect(response.status).toBe(403);
    });
  });
});
