import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let capturedAuthOpts: unknown;
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any, opts: unknown) => {
    capturedAuthOpts = opts;
    return handler;
  },
}));
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/utils/api-errors', () => ({
  ApiErrorCode: { AUTH_REQUIRED: 'AUTH_REQUIRED' },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.stubEnv('ENVIRONMENT_NAME', 'development');

const { POST } = await import('./route');

describe('POST /api/inbox', () => {
  const createAuthContext = (jwt?: string) => ({ jwt });

  function makeRequest(body: unknown, host = 'local.gasket.dev-godaddy.com:8443'): NextRequest {
    return new NextRequest('http://localhost/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe('authentication', () => {
    it('returns 401 when JWT is missing', async () => {
      const request = makeRequest({ operation: 'list_accounts' });
      const response = await POST(request, createAuthContext());
      expect(response.status).toBe(401);
    });

    it('uses withCustomerAuth with default level (1)', () => {
      expect(capturedAuthOpts).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------------

  describe('validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const request = new NextRequest('http://localhost/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', host: 'localhost' },
        body: 'not-json{{{',
      });
      const response = await POST(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid JSON');
    });

    it('returns 400 when brandId is missing for brand-scoped operations', async () => {
      const request = makeRequest({ operation: 'list_embeddables' });
      const response = await POST(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('brandId');
    });

    it('returns 400 when brandId is not a valid UUID', async () => {
      const request = makeRequest({ operation: 'list_embeddables', brandId: 'evil.com#' });
      const response = await POST(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('UUID');
    });

    it('does NOT require brandId for list_accounts', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      const request = makeRequest({ operation: 'list_accounts' });
      const response = await POST(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(200);
    });

    it('does NOT require brandId for activate_account', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      const request = makeRequest({ operation: 'activate_account', body: {} });
      const response = await POST(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(200);
    });

    it('returns 400 for unknown operation', async () => {
      const request = makeRequest({ operation: 'delete_everything', brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await POST(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('Unknown operation');
    });

    it('returns 400 when embeddableId missing for update_embeddable', async () => {
      const request = makeRequest({ operation: 'update_embeddable', brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await POST(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('embeddableId');
    });
  });

  // --------------------------------------------------------------------------
  // Host resolution
  // --------------------------------------------------------------------------

  describe('host resolution', () => {
    it('uses dev host for brand-scoped operations in non-production', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      const request = makeRequest(
        { operation: 'list_embeddables', brandId: '550e8400-e29b-41d4-a716-446655440000' },
      );
      await POST(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('reamaze.dev-godaddy.com');
    });

    it('uses dev BFF host for account-level operations in non-production', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      const request = makeRequest({ operation: 'list_accounts' });
      await POST(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('api.reamaze.dev-godaddy.com');
      expect(url).toContain('/bff/accounts');
    });

  });

  // --------------------------------------------------------------------------
  // URL construction
  // --------------------------------------------------------------------------

  describe('URL construction', () => {
    it('uses brandId-prefixed URL for brand-scoped operations', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      const request = makeRequest(
        { operation: 'list_embeddables', brandId: '660e8400-e29b-41d4-a716-446655440001' },
        'local.gasket.dev-godaddy.com:8443',
      );
      await POST(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://660e8400-e29b-41d4-a716-446655440001.reamaze.dev-godaddy.com/api/v2/embeddables');
    });

    it('includes embeddableId in update URL', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      const request = makeRequest(
        { operation: 'update_embeddable', brandId: '550e8400-e29b-41d4-a716-446655440000', embeddableId: 42, body: {} },
        'local.gasket.dev-godaddy.com:8443',
      );
      await POST(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/embeddables/42');
    });

    it('uses BFF path for activate_account', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      const request = makeRequest(
        { operation: 'activate_account', body: { aabAppId: 'app-1' } },
        'local.gasket.dev-godaddy.com:8443',
      );
      await POST(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/bff/activateAiroAppBuilderAccount');
    });

  });

  // --------------------------------------------------------------------------
  // Proxy behavior
  // --------------------------------------------------------------------------

  describe('upstream proxy', () => {
    it('forwards JWT as sso-jwt Authorization header', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      const request = makeRequest(
        { operation: 'list_embeddables', brandId: '550e8400-e29b-41d4-a716-446655440000' },
        'localhost',
      );
      await POST(request, createAuthContext('my-jwt-token'));
      const headers = mockFetch.mock.calls[0][1]?.headers;
      expect(headers.Authorization).toBe('sso-jwt my-jwt-token');
    });

    it('includes Content-Type for POST with body', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
      const request = makeRequest(
        { operation: 'create_embeddable', brandId: '550e8400-e29b-41d4-a716-446655440000', body: { embeddable: { title: 'Widget' } } },
        'localhost',
      );
      await POST(request, createAuthContext('jwt'));
      const headers = mockFetch.mock.calls[0][1]?.headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('omits Content-Type for GET requests', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      const request = makeRequest(
        { operation: 'list_embeddables', brandId: '550e8400-e29b-41d4-a716-446655440000' },
        'localhost',
      );
      await POST(request, createAuthContext('jwt'));
      const headers = mockFetch.mock.calls[0][1]?.headers;
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('returns 200 with upstream status and data on success', async () => {
      const upstreamData = { embeddables: [{ id: 1 }] };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamData), { status: 200 }));
      const request = makeRequest(
        { operation: 'list_embeddables', brandId: '550e8400-e29b-41d4-a716-446655440000' },
        'localhost',
      );
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.status).toBe(200);
      expect(data.data).toEqual(upstreamData);
    });

    it('returns 200 with upstream error status (proxied, not 502)', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Not found' }), { status: 404 }));
      const request = makeRequest(
        { operation: 'list_embeddables', brandId: '550e8400-e29b-41d4-a716-446655440000' },
        'localhost',
      );
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.status).toBe(404);
      expect(data.data).toEqual({ message: 'Not found' });
    });

    it('returns 502 when fetch throws (network error)', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const request = makeRequest(
        { operation: 'list_embeddables', brandId: '550e8400-e29b-41d4-a716-446655440000' },
        'localhost',
      );
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(502);
      expect(data.error).toContain('Upstream request failed');
    });

    it('handles upstream response with unparseable JSON by returning raw text', async () => {
      mockFetch.mockResolvedValue(new Response('not json', { status: 200 }));
      const request = makeRequest(
        { operation: 'list_embeddables', brandId: '550e8400-e29b-41d4-a716-446655440000' },
        'localhost',
      );
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.status).toBe(200);
      expect(data.data).toEqual({ raw: 'not json' });
    });

    it('returns null data when upstream response body is empty', async () => {
      mockFetch.mockResolvedValue(new Response('', { status: 200 }));
      const request = makeRequest(
        { operation: 'list_accounts' },
        'localhost',
      );
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.status).toBe(200);
      expect(data.data).toBeNull();
    });
  });
});
