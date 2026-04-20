import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: <P,>(handler: unknown) => handler as (
    req: NextRequest,
    auth: unknown,
    ctx: { params: Promise<P> }
  ) => Promise<Response>,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

const SHOPPER_BASE_URL = 'https://shopper.api.int.godaddy.com';

function makeRequest(shopperId: string, cookieHeader?: string): NextRequest {
  const url = `https://localhost/api/shopper/${encodeURIComponent(shopperId)}`;
  const headers: Record<string, string> = {};
  if (cookieHeader !== undefined) headers.cookie = cookieHeader;
  return new NextRequest(new URL(url), { method: 'GET', headers });
}

describe('shopper proxy route GET', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it('returns 400 for shopperId that fails the regex', async () => {
    const { GET } = await import('../route');

    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ shopperId: string }> }
    ) => Promise<Response>)(
      makeRequest('bad/id', 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ shopperId: 'bad/id' }) }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid shopperId');
  });

  it('returns 400 when shopperId exceeds the 64-char cap', async () => {
    const long = 'a'.repeat(65);
    const { GET } = await import('../route');

    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ shopperId: string }> }
    ) => Promise<Response>)(
      makeRequest(long, 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ shopperId: long }) }
    );

    expect(response.status).toBe(400);
  });

  it('returns 401 when auth_jomax cookie is missing', async () => {
    global.fetch = vi.fn();
    const { GET } = await import('../route');

    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ shopperId: string }> }
    ) => Promise<Response>)(
      makeRequest('123456789'),
      {},
      { params: Promise.resolve({ shopperId: '123456789' }) }
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Missing auth_jomax cookie');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('forwards auth_jomax as Authorization: sso-jwt and proxies the upstream body on 200', async () => {
    const upstreamBody = JSON.stringify({ shopperId: '123', name: 'Test' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(upstreamBody, { status: 200, headers: { 'content-type': 'application/json' } })
    );
    global.fetch = fetchMock;

    const { GET } = await import('../route');

    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ shopperId: string }> }
    ) => Promise<Response>)(
      makeRequest('123456789', 'foo=bar; auth_jomax=jwt-value; other=x'),
      {},
      { params: Promise.resolve({ shopperId: '123456789' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = await response.json();
    expect(body).toEqual({ shopperId: '123', name: 'Test' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain(`${SHOPPER_BASE_URL}/v1/shoppers/123456789`);
    expect(calledUrl).toContain('auditClientIp=127.0.0.1');
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('sso-jwt jwt-value');
    expect(headers.cookie).toBeUndefined();
  });

  it('propagates upstream non-OK status with parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"detail":"forbidden"}', { status: 403 })
    );
    global.fetch = fetchMock;

    const { GET } = await import('../route');

    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ shopperId: string }> }
    ) => Promise<Response>)(
      makeRequest('123456789', 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ shopperId: '123456789' }) }
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Upstream error');
    expect(body.status).toBe(403);
    expect(body.body).toEqual({ detail: 'forbidden' });
  });

  it('returns 502 when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));

    const { GET } = await import('../route');

    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ shopperId: string }> }
    ) => Promise<Response>)(
      makeRequest('123456789', 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ shopperId: '123456789' }) }
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('Failed to fetch shopper');
    expect(body.message).toBe('boom');
  });
});
