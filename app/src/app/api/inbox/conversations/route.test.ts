import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: (...args: unknown[]) => unknown) => handler,
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

const { GET } = await import('./route');

describe('GET /api/inbox/conversations', () => {
  const createAuthContext = (jwt?: string) => ({ jwt });

  function makeRequest(searchParams: Record<string, string>): NextRequest {
    const url = new URL('http://localhost/api/inbox/conversations');
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return new NextRequest(url);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 when JWT is missing', async () => {
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await GET(request, createAuthContext());
      expect(response.status).toBe(401);
    });
  });

  describe('validation', () => {
    it('returns 400 when brandId is missing', async () => {
      const request = makeRequest({});
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('brandId');
    });

    it('returns 400 when brandId is not a valid UUID', async () => {
      const request = makeRequest({ brandId: 'not-a-uuid' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('UUID');
    });

    it('returns 400 when page is zero', async () => {
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000', page: '0' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('page');
    });

    it('returns 400 when page is negative', async () => {
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000', page: '-1' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('page');
    });

    it('returns 400 when page is not a number', async () => {
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000', page: 'abc' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('page');
    });

    it('returns 400 when page is a decimal', async () => {
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000', page: '1.5' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('page');
    });

    it('accepts valid page parameter', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000', page: '3' });
      const response = await GET(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(200);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('page=3');
    });

    it('succeeds without page parameter', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await GET(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(200);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('page=');
    });
  });

  describe('validation — filter', () => {
    it('returns 400 when filter is not an allowed value', async () => {
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        filter: 'spam',
      });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('filter must be one of');
    });
  });

  describe('URL construction', () => {
    it('builds correct Reamaze URL for dev environment', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('550e8400-e29b-41d4-a716-446655440000.reamaze.dev-godaddy.com');
      expect(url).toContain('/api/v2/conversations');
      expect(url).toContain('sort=updated');
    });

    it('includes before_timestamp param when provided', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        before_timestamp: '2024-01-01T00:00:00Z',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('before_timestamp=2024-01-01T00%3A00%3A00Z');
    });

    it('maps filter=unresolved to Reamaze filter=open', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        filter: 'unresolved',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('filter=open');
    });

    it('maps filter=pending to Reamaze filter=pending', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        filter: 'pending',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('filter=pending');
    });

    it('maps filter=resolved to Reamaze filter=resolved', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        filter: 'resolved',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('filter=resolved');
    });

    it('does not include filter param when omitted', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('filter=');
    });
  });

  describe('upstream proxy', () => {
    it('forwards JWT as sso-jwt Authorization header', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      await GET(request, createAuthContext('my-jwt-token'));
      const headers = mockFetch.mock.calls[0][1]?.headers;
      expect(headers.Authorization).toBe('sso-jwt my-jwt-token');
      expect(headers.Accept).toBe('application/json');
    });

    it('returns conversation data on success', async () => {
      const upstreamData = {
        conversations: [{ id: 1, subject: 'Test' }],
        page_count: 1,
        page_size: 30,
      };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamData), { status: 200 }));
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data).toEqual(upstreamData);
    });

    it('returns error response with upstream status on failure', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
      );
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.error).toContain('Brand not found');
    });

    it('returns 502 when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(502);
      expect(data.error).toContain('Failed to fetch conversations');
    });
  });
});
