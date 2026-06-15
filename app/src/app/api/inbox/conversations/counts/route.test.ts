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

describe('GET /api/inbox/conversations/counts', () => {
  const VALID_BRAND = '550e8400-e29b-41d4-a716-446655440000';
  const createAuthContext = (jwt?: string) => ({ jwt });

  function makeRequest(searchParams: Record<string, string>): NextRequest {
    const url = new URL('http://localhost/api/inbox/conversations/counts');
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return new NextRequest(url);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when JWT is missing', async () => {
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext());
    expect(response.status).toBe(401);
  });

  it('returns 400 when brandId is missing', async () => {
    const response = await GET(makeRequest({}), createAuthContext('jwt-token'));
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('brandId');
  });

  it('returns 400 when brandId is not a valid UUID', async () => {
    const response = await GET(makeRequest({ brandId: 'not-a-uuid' }), createAuthContext('jwt-token'));
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('UUID');
  });

  it('builds the Reamaze counts URL with counts_only and filter=unread', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 0 }), { status: 200 }));
    await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt-token'));
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(`${VALID_BRAND}.reamaze.dev-godaddy.com`);
    expect(url).toContain('/api/v2/conversations');
    expect(url).toContain('counts_only=true');
    expect(url).toContain('filter=unread');
  });

  it('forwards JWT as sso-jwt Authorization header', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 0 }), { status: 200 }));
    await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('my-jwt-token'));
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(headers.Authorization).toBe('sso-jwt my-jwt-token');
    expect(headers.Accept).toBe('application/json');
  });

  it('returns the total_count payload on success', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 7 }), { status: 200 }));
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt'));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual({ total_count: 7 });
  });

  it('passes through upstream error status', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 }));
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt'));
    const data = await response.json();
    expect(response.status).toBe(404);
    expect(data.error).toContain('Brand not found');
  });

  it('returns 502 when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt'));
    const data = await response.json();
    expect(response.status).toBe(502);
    expect(data.error).toContain('Failed to fetch unread count');
  });

  it('returns 502 when upstream payload is not an object', async () => {
    mockFetch.mockResolvedValue(new Response('null', { status: 200 }));
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt'));
    expect(response.status).toBe(502);
  });
});
