/**
 * BFF share route tests.
 *
 * Covers the GET / POST proxy paths the customer SharePanel + ShareMenu
 * call into. Asserts: feature-flag gating, missing agent_url 503, JSON
 * body parsing (valid / absent / malformed → 400), and the days→seconds
 * conversion that the agents service then range-checks.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockAgentFetch,
  mockCheckSwitchboardFlag,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockAgentFetch: vi.fn(),
  mockCheckSwitchboardFlag: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({ getSite: mockGetSite })),
}));
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }));
vi.mock('@/lib/switchboard/server', () => ({ checkSwitchboardFlag: mockCheckSwitchboardFlag }));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

// Pass-through customer auth — our tests don't exercise the auth path,
// but capture the options object (e.g. { level: 3 }) so we can assert
// the route is configured for the right auth tier.
const capturedAuthOptions = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>('@/lib/customer-auth');
  let counter = 0;
  return {
    ...actual,
    withCustomerAuth: vi.fn((handler: any, options?: unknown) => {
      // First withCustomerAuth call in route.ts is GET, second is POST.
      const tag = counter++ === 0 ? 'GET' : 'POST';
      capturedAuthOptions.set(tag, options);
      return async (request: NextRequest, ...args: any[]) =>
        handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: {} }, ...args);
    }),
  };
});

import { GET, POST } from '../route';

const APP_ID = 'app-123';

describe('Auth level configuration', () => {
  it('GET handler is registered with default auth (no options)', () => {
    // GET listing is informational; level 1 is appropriate.
    const opts = capturedAuthOptions.get('GET');
    expect(opts).toBeUndefined();
  });

  it('POST handler is registered with auth level 3 (sensitive operation)', () => {
    // Share-token creation produces a 7-day public-facing bearer credential
    // that grants unauthenticated preview access. Per CLAUDE.md, sensitive
    // operations require a recent heartbeat (level 3) so a stale persistent
    // session can't quietly mint share links.
    const opts = capturedAuthOptions.get('POST') as { level?: number } | undefined;
    expect(opts).toEqual({ level: 3 });
  });
});

function makeRequest(method: 'GET' | 'POST', body?: string): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = body;
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(`https://airo.test/api/apps/${APP_ID}/share`, init);
}

const params = Promise.resolve({ id: APP_ID });

describe('GET /api/apps/[id]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue({ agent_url: 'https://agent.test' });
    mockAgentFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [] }),
    });
  });

  it('returns 403 when the appbuilder-share-links flag is off', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    const res = await GET(makeRequest('GET'), { params });
    expect(res.status).toBe(403);
    expect(mockGetSite).not.toHaveBeenCalled();
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('logs share.api.feature_disabled with appId when flag is off (GET)', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    await GET(makeRequest('GET'), { params });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.api.feature_disabled',
      expect.objectContaining({ appId: APP_ID }),
    );
  });

  it('returns 404 when the site is not found', async () => {
    mockGetSite.mockResolvedValue(null);
    const res = await GET(makeRequest('GET'), { params });
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('returns 503 when the site has no agent_url', async () => {
    mockGetSite.mockResolvedValue({ agent_url: undefined });
    const res = await GET(makeRequest('GET'), { params });
    expect(res.status).toBe(503);
  });

  it('proxies the GET request to agents and returns the result', async () => {
    mockAgentFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [{ token: 'abc' }] }),
    });

    const res = await GET(makeRequest('GET'), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ tokens: [{ token: 'abc' }] });
    expect(mockAgentFetch).toHaveBeenCalledWith(
      `https://agent.test/apps/${APP_ID}/share`,
      expect.objectContaining({ siteId: APP_ID }),
    );
  });

  it('logs list.failure and proxies agents status code when agents returns 5xx', async () => {
    // The handler's `if (!response.ok)` block forwards the upstream
    // status code (other than 404) and emits share.api.list.failure
    // with the response body. If the passthrough were silently swapped
    // for a generic 500 the UI would lose the ability to distinguish
    // "agents is down" (502/503) from "you don't have access" (403).
    mockAgentFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const res = await GET(makeRequest('GET'), { params });

    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'share.api.list.failure',
      expect.objectContaining({ appId: APP_ID, status: 500 }),
    );
  });

  it('normalizes agents 404 to BFF 404 with standard error body (GET)', async () => {
    // Agents 404 on the share-list endpoint usually means the app row
    // was deleted between getSite() and the list call. Re-shape it to
    // the same `{ error: 'App not found' }` body the no-site path
    // returns, so the UI can rely on a single error contract.
    mockAgentFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    const res = await GET(makeRequest('GET'), { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('App not found');
    // Distinct from the getSite-null 404: agentFetch was called.
    expect(mockAgentFetch).toHaveBeenCalled();
  });
});

describe('POST /api/apps/[id]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue({ agent_url: 'https://agent.test' });
    mockAgentFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        token: 'tokABCDEFGH',
        appId: APP_ID,
        shareUrl: 'https://airo.ai/share/encoded',
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        createdAt: new Date().toISOString(),
      }),
    });
  });

  it('returns 403 when the appbuilder-share-links flag is off', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    const res = await POST(makeRequest('POST', '{}'), { params });
    expect(res.status).toBe(403);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('logs share.api.feature_disabled with appId when flag is off (POST)', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    await POST(makeRequest('POST', '{}'), { params });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.api.feature_disabled',
      expect.objectContaining({ appId: APP_ID }),
    );
  });

  it('returns 503 when the site has no agent_url', async () => {
    mockGetSite.mockResolvedValue({ agent_url: undefined });
    const res = await POST(makeRequest('POST', '{}'), { params });
    expect(res.status).toBe(503);
  });

  it('returns 404 when the site is not found (parity with GET)', async () => {
    // Guards the explicit `if (!site)` check in the POST handler. Without
    // this test, accidentally removing the null-check during a refactor
    // would only surface as a downstream error somewhere later in the
    // flow (likely a NPE on site.agent_url).
    mockGetSite.mockResolvedValue(null);
    const res = await POST(makeRequest('POST', '{}'), { params });
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('uses the default 7 days when body is empty', async () => {
    await POST(makeRequest('POST'), { params });

    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ expiresIn: 7 * 86400 }),
      }),
    );
  });

  it('uses the default 7 days when body is "{}"', async () => {
    await POST(makeRequest('POST', '{}'), { params });

    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ expiresIn: 7 * 86400 }),
      }),
    );
  });

  it('converts expiresInDays to seconds correctly (1 day → 86400)', async () => {
    await POST(makeRequest('POST', JSON.stringify({ expiresInDays: 1 })), { params });

    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ expiresIn: 86400 }),
      }),
    );
  });

  it('converts expiresInDays to seconds correctly (7 days → 604800)', async () => {
    await POST(makeRequest('POST', JSON.stringify({ expiresInDays: 7 })), { params });

    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ expiresIn: 604800 }),
      }),
    );
  });

  it('returns 400 when expiresInDays is zero', async () => {
    const res = await POST(
      makeRequest('POST', JSON.stringify({ expiresInDays: 0 })),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when expiresInDays is negative', async () => {
    const res = await POST(
      makeRequest('POST', JSON.stringify({ expiresInDays: -3 })),
      { params },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when expiresInDays is non-numeric', async () => {
    const res = await POST(
      makeRequest('POST', JSON.stringify({ expiresInDays: 'one' })),
      { params },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when expiresInDays exceeds the 7-day ceiling (no agents passthrough)', async () => {
    // Without an upper bound at the BFF, expiresInDays=365 would be
    // converted to expiresIn=31_536_000 and forwarded to agents, which
    // rejects with 400 "expiresIn out of range" — surfaced to the UI as
    // the generic "Failed to create share token" with no hint that the
    // problem was the request value. Catch it here so the error
    // message is precise.
    const res = await POST(
      makeRequest('POST', JSON.stringify({ expiresInDays: 365 })),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/between 1 and 7/i);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when expiresInDays is fractional (avoids sub-3600s expiresIn)', async () => {
    // expiresInDays=0.04 → expiresIn=3456 sec < agents minimum of 3600 →
    // confusing 400 passthrough. Rejecting non-integer values at the
    // BFF closes that path. Also keeps the "1 day = 86400s" mental
    // model honest: the contract is whole days.
    const res = await POST(
      makeRequest('POST', JSON.stringify({ expiresInDays: 0.5 })),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/integer/i);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON body (not a silent 201)', async () => {
    // Caller sends Content-Type: application/json with a syntactically broken body.
    // Pre-fix this used to produce 201 with default 7-day expiry.
    const res = await POST(
      makeRequest('POST', '{"expiresInDays": }'),
      { params },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/JSON/i);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('does not log the raw token in share.api.create.success', async () => {
    await POST(makeRequest('POST', '{}'), { params });

    const successCall = mockLogger.info.mock.calls.find(
      ([event]) => event === 'share.api.create.success',
    );
    expect(successCall).toBeDefined();
    const payload = successCall![1] as Record<string, unknown>;
    // Only the suffix should be logged. The full token value must not leak.
    expect(payload).toHaveProperty('shareTokenSuffix');
    expect(payload).not.toHaveProperty('token');
    expect(payload.shareTokenSuffix).toBe('EFGH'); // last 4 of 'tokABCDEFGH'
  });

  it('returns 502 + logs status when agents responds 2xx with non-JSON body', async () => {
    // Simulate a proxy timeout HTML page or a truncated body.
    mockAgentFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });

    const res = await POST(makeRequest('POST', '{}'), { params });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Unexpected response/i);

    const parseErrCall = mockLogger.error.mock.calls.find(
      ([event]) => event === 'share.api.create.parseError',
    );
    expect(parseErrCall).toBeDefined();
    // Upstream status preserved so the failure mode is distinguishable
    // from a generic 500.
    expect(parseErrCall![1]).toMatchObject({ appId: APP_ID, status: 200 });
  });

  it('returns 502 when agents responds 2xx with parseable JSON missing the token field', async () => {
    // Proxy misconfig or future schema drift: agents returns a 201 whose
    // body is valid JSON but lacks `token`. Without the guard, the BFF
    // forwards `{ token: undefined, ... }` as a 201 — the UI shows
    // "success" with no copyable URL, and the only signal is a
    // shareTokenSuffix='****' line in logs (tokenSuffix's non-string
    // fallback). The guard turns this into an explicit 502 so the failure
    // mode is observable and the client can surface a real error.
    mockAgentFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        // No `token` field.
        appId: APP_ID,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        createdAt: new Date().toISOString(),
      }),
    });

    const res = await POST(makeRequest('POST', '{}'), { params });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Unexpected response/i);

    const missingTokenCall = mockLogger.error.mock.calls.find(
      ([event]) => event === 'share.api.create.missingToken',
    );
    expect(missingTokenCall).toBeDefined();
    expect(missingTokenCall![1]).toMatchObject({ appId: APP_ID, status: 201 });

    // The success log must NOT fire — otherwise the '****' shareTokenSuffix
    // line would re-introduce the silent-failure mode this guard exists to
    // close.
    const successCall = mockLogger.info.mock.calls.find(
      ([event]) => event === 'share.api.create.success',
    );
    expect(successCall).toBeUndefined();
  });

  it('logs create.failure and proxies agents status code when agents returns 5xx', async () => {
    // Symmetric to the GET passthrough test. The 409 case (agents'
    // active-token guard) reaches the UI through this branch too, so
    // it's load-bearing for the SharePanel's "you already have a link"
    // flow.
    mockAgentFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const res = await POST(makeRequest('POST', '{}'), { params });

    expect(res.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'share.api.create.failure',
      expect.objectContaining({ appId: APP_ID, status: 500 }),
    );
  });

  it('normalizes agents 404 to BFF 404 with standard error body (POST)', async () => {
    // Distinct from the getSite-null 404 case: this branch fires after
    // getSite resolved a site, then agents itself returned 404 (e.g.
    // app was deleted in a race between control-plane lookup and the
    // POST). Both paths must produce the same error contract.
    mockAgentFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    const res = await POST(makeRequest('POST', '{}'), { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('App not found');
    expect(mockAgentFetch).toHaveBeenCalled();
  });
});

describe('GET /api/apps/[id]/share — upstream parse failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue({ agent_url: 'https://agent.test' });
  });

  it('returns 502 + logs status when agents responds 2xx with non-JSON body', async () => {
    mockAgentFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });

    const res = await GET(makeRequest('GET'), { params });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Unexpected response/i);

    const parseErrCall = mockLogger.error.mock.calls.find(
      ([event]) => event === 'share.api.list.parseError',
    );
    expect(parseErrCall).toBeDefined();
    expect(parseErrCall![1]).toMatchObject({ appId: APP_ID, status: 200 });
  });
});
