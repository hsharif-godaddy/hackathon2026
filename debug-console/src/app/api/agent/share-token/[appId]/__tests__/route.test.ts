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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/agent-client', () => ({
  fetchAgentJson: vi.fn(),
}));

vi.mock('@/lib/agent-jwt', () => ({
  mintAgentToken: vi.fn(),
}));

vi.mock('@/lib/mgmt-control-plane-adapter', () => ({
  default: { getAgentUrl: vi.fn() },
  AgentUrlNotFoundError: class AgentUrlNotFoundError extends Error {
    constructor(appId: string) { super(`No agent_url found for app ${appId}`); }
  },
}));

import { fetchAgentJson } from '@/lib/agent-client';
import { mintAgentToken } from '@/lib/agent-jwt';
import mgmtAdapter from '@/lib/mgmt-control-plane-adapter';

function makeRequest(appId: string): NextRequest {
  return new NextRequest(new URL(`https://localhost/api/agent/share-token/${appId}`));
}

async function callGET(appId: string): Promise<Response> {
  const { GET } = await import('../route');
  return (GET as unknown as (
    req: NextRequest,
    auth: unknown,
    ctx: { params: Promise<{ appId: string }> }
  ) => Promise<Response>)(
    makeRequest(appId),
    {},
    { params: Promise.resolve({ appId }) }
  );
}

describe('GET /api/agent/share-token/[appId]', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.resetModules(); });

  it('returns 400 for appId failing the regex', async () => {
    const res = await callGET('bad/id!');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid appId');
  });

  it('returns the freshest active token when one exists', async () => {
    const now = Date.now();
    vi.mocked(fetchAgentJson).mockResolvedValue({
      status: 200,
      body: {
        tokens: [
          // highest expiresAt — should win even though createdAt is older
          { token: 'long-lived', expiresAt: now + 5000, createdAt: new Date(now - 5000).toISOString() },
          // newer createdAt but lower expiresAt — should lose
          { token: 'recently-created', expiresAt: now + 2000, createdAt: new Date(now - 1000).toISOString() },
          // expired — must be excluded
          { token: 'expired', expiresAt: now - 1000, createdAt: new Date(now - 9000).toISOString() },
        ],
      },
    });

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('long-lived');
    expect(fetchAgentJson).toHaveBeenCalledWith({
      appId: 'abcd1234ef',
      path: '/apps/abcd1234ef/share',
    });
  });

  it('mints a new token when no active tokens exist', async () => {
    const now = Date.now();
    vi.mocked(fetchAgentJson).mockResolvedValue({
      status: 200,
      body: { tokens: [{ token: 'exp', expiresAt: now - 1, createdAt: new Date(now - 9000).toISOString() }] },
    });
    vi.mocked(mgmtAdapter.getAgentUrl).mockResolvedValue('https://agent.example.com');
    vi.mocked(mintAgentToken).mockResolvedValue({ token: 'jwt-tok', expires: new Date() });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'minted-tok', expiresAt: now + 604800000 }), { status: 201 })
    );
    global.fetch = fetchMock;

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('minted-tok');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agent.example.com/apps/abcd1234ef/share');
    expect(init.method).toBe('POST');
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.expiresIn).toBe(604800);
  });

  it('returns { token: null } when list fetch fails', async () => {
    vi.mocked(fetchAgentJson).mockResolvedValue({ status: 500, body: { error: 'boom' } });

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeNull();
  });

  it('returns { token: null } when mint POST fails', async () => {
    vi.mocked(fetchAgentJson).mockResolvedValue({ status: 200, body: { tokens: [] } });
    vi.mocked(mgmtAdapter.getAgentUrl).mockResolvedValue('https://agent.example.com');
    vi.mocked(mintAgentToken).mockResolvedValue({ token: 'jwt', expires: new Date() });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'conflict' }), { status: 409 })
    );

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeNull();
  });

  it('returns { token: null } when fetchAgentJson throws', async () => {
    vi.mocked(fetchAgentJson).mockRejectedValue(new Error('network error'));

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeNull();
  });
});
