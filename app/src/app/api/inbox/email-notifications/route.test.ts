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
  const url = new URL('http://localhost/api/inbox/email-notifications');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function makePut(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/inbox/email-notifications', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/inbox/email-notifications', () => {
  it('returns 401 when JWT is missing', async () => {
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext());
    expect(res.status).toBe(401);
  });

  it('returns 400 when brandId is invalid', async () => {
    const res = await GET(makeGet({ brandId: 'nope' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('proxies to /api/v2/email_notifications and returns the raw body', async () => {
    const upstream = { email_notifications: true };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext('my-jwt'));
    const url = mockFetch.mock.calls[0][0] as string;
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(url).toContain('/api/v2/email_notifications');
    expect(headers.Authorization).toBe('sso-jwt my-jwt');
    expect(headers.Accept).toBe('application/json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
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

describe('PUT /api/inbox/email-notifications', () => {
  it('returns 401 when JWT is missing', async () => {
    const res = await PUT(makePut({ brandId: BRAND, emailNotifications: false }), createAuthContext());
    expect(res.status).toBe(401);
  });

  it('returns 400 when emailNotifications is not a boolean', async () => {
    const res = await PUT(makePut({ brandId: BRAND, emailNotifications: 'yes' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('PUTs email_notifications payload and returns the raw body', async () => {
    const upstream = { email_notifications: false };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const res = await PUT(makePut({ brandId: BRAND, emailNotifications: false }), createAuthContext('jwt'));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v2/email_notifications');
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('sso-jwt jwt');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ email_notifications: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
  });

  it('returns 502 when the upstream fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const res = await PUT(makePut({ brandId: BRAND, emailNotifications: true }), createAuthContext('jwt'));
    expect(res.status).toBe(502);
  });

  it('maps an upstream non-ok status to that status', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Unprocessable' }), { status: 422 }));
    const res = await PUT(makePut({ brandId: BRAND, emailNotifications: true }), createAuthContext('jwt'));
    expect(res.status).toBe(422);
  });

  it('returns 400 on an invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/inbox/email-notifications', { method: 'PUT', body: 'not json' });
    const res = await PUT(req, createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });
});
