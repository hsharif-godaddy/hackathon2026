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

const CARE_BASE_URL = 'https://conversation-state-service.care.godaddy.com';

function makeRequest(
  contactId: string,
  search?: Record<string, string>,
  cookieHeader?: string
): NextRequest {
  const url = new URL(`https://localhost/api/care/transcripts/${encodeURIComponent(contactId)}`);
  if (search) {
    Object.entries(search).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const headers: Record<string, string> = {};
  if (cookieHeader !== undefined) headers.cookie = cookieHeader;
  return new NextRequest(url, { method: 'GET', headers });
}

describe('care/transcripts/[contactId] route GET', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it('returns 400 for contactId that fails the regex', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ contactId: string }> }
    ) => Promise<Response>)(
      makeRequest('bad/id', undefined, 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ contactId: 'bad/id' }) }
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid contactId');
  });

  it('returns 400 when contactId exceeds the 64-char cap', async () => {
    const long = 'a'.repeat(65);
    const { GET } = await import('../route');
    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ contactId: string }> }
    ) => Promise<Response>)(
      makeRequest(long, undefined, 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ contactId: long }) }
    );
    expect(response.status).toBe(400);
  });

  it('returns 401 when auth_jomax cookie is missing', async () => {
    global.fetch = vi.fn();
    const { GET } = await import('../route');
    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ contactId: string }> }
    ) => Promise<Response>)(
      makeRequest('contact-1'),
      {},
      { params: Promise.resolve({ contactId: 'contact-1' }) }
    );
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('forwards auth_jomax as Authorization: sso-jwt and defaults includeSurveyResponses=true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"transcript":"hi"}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    global.fetch = fetchMock;

    const { GET } = await import('../route');
    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ contactId: string }> }
    ) => Promise<Response>)(
      makeRequest('contact-1', undefined, 'foo=bar; auth_jomax=jwt-value'),
      {},
      { params: Promise.resolve({ contactId: 'contact-1' }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ transcript: 'hi' });

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain(`${CARE_BASE_URL}/transcripts/contact-1`);
    expect(calledUrl).toContain('includeSurveyResponses=true');
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('sso-jwt jwt-value');
    expect(headers.cookie).toBeUndefined();
  });

  it('respects includeSurveyResponses query override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock;

    const { GET } = await import('../route');
    await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ contactId: string }> }
    ) => Promise<Response>)(
      makeRequest('contact-1', { includeSurveyResponses: 'false' }, 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ contactId: 'contact-1' }) }
    );

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain('includeSurveyResponses=false');
  });

  it('propagates upstream non-OK status', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('{"detail":"nope"}', { status: 404 })
    );
    const { GET } = await import('../route');
    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ contactId: string }> }
    ) => Promise<Response>)(
      makeRequest('contact-1', undefined, 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ contactId: 'contact-1' }) }
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Upstream error');
    expect(body.body).toEqual({ detail: 'nope' });
  });

  it('returns 502 when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const { GET } = await import('../route');
    const response = await (GET as unknown as (
      req: NextRequest,
      auth: unknown,
      ctx: { params: Promise<{ contactId: string }> }
    ) => Promise<Response>)(
      makeRequest('contact-1', undefined, 'auth_jomax=jwt'),
      {},
      { params: Promise.resolve({ contactId: 'contact-1' }) }
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('Failed to fetch transcript');
  });
});
