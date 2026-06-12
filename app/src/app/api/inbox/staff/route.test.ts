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

const { GET, PUT } = await import('./route');

const BRAND = '550e8400-e29b-41d4-a716-446655440000';
const createAuthContext = (jwt?: string) => ({ jwt });

function makeGet(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/inbox/staff');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function makePut(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/inbox/staff', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/inbox/staff', () => {
  it('returns 401 when JWT is missing', async () => {
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext());
    expect(res.status).toBe(401);
  });

  it('returns 400 when brandId is not a valid UUID', async () => {
    const res = await GET(makeGet({ brandId: 'nope' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('proxies to /api/v2/staff/self and returns the raw body', async () => {
    const upstream = { staff: { id: 7, notification_email: 'a@b.com' } };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext('my-jwt'));
    const data = await res.json();
    const url = mockFetch.mock.calls[0][0] as string;
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(url).toContain(`${BRAND}.reamaze.dev-godaddy.com`);
    expect(url).toContain('/api/v2/staff/self');
    expect(headers.Authorization).toBe('sso-jwt my-jwt');
    expect(headers.Accept).toBe('application/json');
    expect(res.status).toBe(200);
    expect(data).toEqual(upstream);
  });

  it('maps upstream failure to its status', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 404 }));
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext('jwt'));
    expect(res.status).toBe(404);
  });

  it('returns 502 when the upstream fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext('jwt'));
    expect(res.status).toBe(502);
  });

  it('returns 502 when upstream returns a non-object body', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify('not-an-object'), { status: 200 }));
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext('jwt'));
    expect(res.status).toBe(502);
  });
});

describe('PUT /api/inbox/staff', () => {
  it('returns 401 when JWT is missing', async () => {
    const res = await PUT(makePut({ brandId: BRAND, staffId: 7, notificationEmail: 'a@b.com' }), createAuthContext());
    expect(res.status).toBe(401);
  });

  it('returns 400 when staffId is not a positive integer', async () => {
    const res = await PUT(makePut({ brandId: BRAND, staffId: 0, notificationEmail: 'a@b.com' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when notificationEmail is empty', async () => {
    const res = await PUT(makePut({ brandId: BRAND, staffId: 7, notificationEmail: '   ' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('PUTs to /api/v2/staff/{id} with notification_email payload', async () => {
    const upstream = { staff: { id: 7, notification_email: 'new@b.com' } };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const res = await PUT(makePut({ brandId: BRAND, staffId: 7, notificationEmail: 'new@b.com' }), createAuthContext('jwt'));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v2/staff/7');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ notification_email: 'new@b.com' });
    expect(init.headers.Authorization).toBe('sso-jwt jwt');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
  });

  it('returns 502 when the upstream fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const res = await PUT(makePut({ brandId: BRAND, staffId: 7, notificationEmail: 'a@b.com' }), createAuthContext('jwt'));
    expect(res.status).toBe(502);
  });

  it('maps an upstream non-ok status to that status', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Unprocessable' }), { status: 422 }));
    const res = await PUT(makePut({ brandId: BRAND, staffId: 7, notificationEmail: 'a@b.com' }), createAuthContext('jwt'));
    expect(res.status).toBe(422);
  });

  it('returns 400 on an invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/inbox/staff', { method: 'PUT', body: 'not json' });
    const res = await PUT(req, createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });
});
