/**
 * Tests for /api/servers/[id] GET — focused on the airoShareToken injection
 * into the preview `server.url` (the URL the develop-page `#preview-iframe`
 * loads from). Mirrors the /api/sites/[id] injection test: the BFF appends
 * the token so the preview authenticates via a query param instead of the
 * cross-site `preview_auth` cookie, which is partitioned (CHIPS) and never
 * carries to a top-level visit. The injection is unconditional (not
 * feature-gated) and fails open to the bare URL.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockAgentFetch,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockAgentFetch: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane/adapter-factory', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}));
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/mgmt-airo', () => ({
  AiroHttpError: class AiroHttpError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...args: any[]) =>
    handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: {} }, ...args),
}));

import { __clearTokenCacheForTesting } from '@/lib/share/inject-preview-token';
import { GET } from '../route';

const APP_ID = 'app-123';
const AGENT_URL = 'https://app-123.agent.c4.test-airoapp.ai';
const PREVIEW_URL = 'https://app-123.preview.c4.test-airoapp.ai';
const ACTIVE_TOKEN = 'tokABCDEFGH';
const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;

function makeRequest(): NextRequest {
  return new NextRequest(`https://airo.test/api/servers/${APP_ID}`);
}

const params = Promise.resolve({ id: APP_ID });

describe('GET /api/servers/[id] — preview server.url airoShareToken injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Module-level token cache survives across tests; clear it so a hit from
    // one case can't satisfy a different case's call expectation.
    __clearTokenCacheForTesting();
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      preview_url: PREVIEW_URL,
      agent_url: AGENT_URL,
      status: 'running',
      updated_at: '2026-06-04T00:00:00Z',
    });
  });

  it('appends the token to server.url', async () => {
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [{ token: ACTIVE_TOKEN, expiresAt: FUTURE }] }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.server.url).toBe(`${PREVIEW_URL}/?airoShareToken=${ACTIVE_TOKEN}`);
    expect(body.server.status).toBe('running');
  });

  it('leaves an agent-only URL untouched (no preview_url → no token)', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      agent_url: AGENT_URL,
      status: 'running',
      updated_at: '2026-06-04T00:00:00Z',
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.server.url).toBe(AGENT_URL);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('fails open to the bare preview URL when injection fails', async () => {
    // Both the token list and the mint fall through to errors — the helper
    // catches and returns the bare URL, so the route still responds 200.
    mockAgentFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.server.url).toBe(PREVIEW_URL);
  });
});
