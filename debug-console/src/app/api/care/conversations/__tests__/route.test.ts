import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler as (req: NextRequest) => Promise<Response>,
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

const CARE_BASE_URL = 'https://conversation-state-service.care.godaddy.com';

function makeRequest(params: Record<string, string>, cookieHeader?: string): NextRequest {
  const url = new URL('https://localhost/api/care/conversations');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = {};
  if (cookieHeader !== undefined) headers.cookie = cookieHeader;
  return new NextRequest(url, { method: 'GET', headers });
}

describe('care/conversations route GET', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it('returns 400 when shopperId is missing', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({}, 'auth_jomax=jwt')
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid or missing shopperId');
  });

  it('returns 400 for shopperId that fails the regex', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ shopperId: 'bad/id' }, 'auth_jomax=jwt')
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when lastMinutes is not a positive integer', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ shopperId: '123456789', lastMinutes: 'abc' }, 'auth_jomax=jwt')
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid lastMinutes');
  });

  it('returns 400 when lastMinutes exceeds the 90-day cap', async () => {
    global.fetch = vi.fn();
    const { GET } = await import('../route');
    // 90 days = 129,600 min; anything above that must be rejected so we don't
    // forward huge range scans upstream.
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ shopperId: '123456789', lastMinutes: '9999999' }, 'auth_jomax=jwt')
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/lastMinutes must be between/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when lastMinutes is zero', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ shopperId: '123456789', lastMinutes: '0' }, 'auth_jomax=jwt')
    );
    expect(response.status).toBe(400);
  });

  it('returns 401 when auth_jomax cookie is missing', async () => {
    global.fetch = vi.fn();
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ shopperId: '123456789' })
    );
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('forwards auth_jomax as Authorization: sso-jwt and proxies upstream body', async () => {
    const upstream = JSON.stringify({ conversations: [{ id: 'c1' }] });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(upstream, { status: 200, headers: { 'content-type': 'application/json' } })
    );
    global.fetch = fetchMock;

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ shopperId: '123456789', lastMinutes: '60' }, 'foo=bar; auth_jomax=jwt-value')
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ conversations: [{ id: 'c1' }] });

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain(
      `${CARE_BASE_URL}/conversation-state/shopper/123456789/conversations`
    );
    expect(calledUrl).toContain('lastMinutes=60');
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('sso-jwt jwt-value');
    expect(headers.cookie).toBeUndefined();
  });

  it('propagates upstream non-OK status', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('{"detail":"nope"}', { status: 500 })
    );
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ shopperId: '123456789' }, 'auth_jomax=jwt')
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Upstream error');
    expect(body.body).toEqual({ detail: 'nope' });
  });

  it('returns 502 when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ shopperId: '123456789' }, 'auth_jomax=jwt')
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('Failed to fetch conversations');
  });
});
