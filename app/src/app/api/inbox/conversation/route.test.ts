import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => handler,
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

describe('GET /api/inbox/conversation', () => {
  const createAuthContext = (jwt?: string) => ({ jwt });

  function makeRequest(searchParams: Record<string, string>): NextRequest {
    const url = new URL('http://localhost/api/inbox/conversation');
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
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      const response = await GET(request, createAuthContext());
      expect(response.status).toBe(401);
    });
  });

  describe('validation', () => {
    it('returns 400 when brandId is missing', async () => {
      const request = makeRequest({ conversationId: '123' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('brandId');
    });

    it('returns 400 when brandId is not a valid UUID', async () => {
      const request = makeRequest({ brandId: 'not-a-uuid', conversationId: '123' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('UUID');
    });

    it('returns 400 when conversationId is missing', async () => {
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('conversationId');
    });

    it('returns 400 when conversationId is not numeric', async () => {
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: 'abc',
      });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('conversationId');
    });
  });

  describe('URL construction', () => {
    it('builds correct Reamaze URL for dev environment', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversation: {} }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('550e8400-e29b-41d4-a716-446655440000.reamaze.dev-godaddy.com');
      expect(url).toContain('/api/v2/conversations/123');
    });
  });

  describe('upstream proxy', () => {
    it('forwards JWT as sso-jwt Authorization header', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversation: {} }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      await GET(request, createAuthContext('my-jwt-token'));
      const headers = mockFetch.mock.calls[0][1]?.headers;
      expect(headers.Authorization).toBe('sso-jwt my-jwt-token');
      expect(headers.Accept).toBe('application/json');
    });

    it('returns conversation data on success', async () => {
      const upstreamData = { conversation: { id: 123, subject: 'Test' } };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamData), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data).toEqual(upstreamData);
    });

    it('returns error response with upstream status on failure', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 })
      );
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.error).toContain('Conversation not found');
    });

    it('returns 502 when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(502);
      expect(data.error).toContain('Failed to fetch conversation');
    });
  });
});
