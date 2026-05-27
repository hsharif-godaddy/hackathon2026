/**
 * Tests for the airoShareToken injection path on the /api/sites endpoint
 * (both list and ?site_id= variants). Same mitigation as
 * /api/sites/[id] — see lib/share/inject-preview-token.ts. Splitting these
 * tests out of the existing route.test.ts keeps the mock surface focused.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockListSites,
  mockAgentFetch,
  mockCheckSwitchboardFlag,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockListSites: vi.fn(),
  mockAgentFetch: vi.fn(),
  mockCheckSwitchboardFlag: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({
    getSite: mockGetSite,
    listSites: mockListSites,
  })),
}));
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }));
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/translations/server-intl', () => ({
  detectTranslationLocale: vi.fn().mockResolvedValue('en-US'),
}));
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...args: any[]) =>
    handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: {} }, ...args),
  customerHasAccount: vi.fn(() => true),
  createCustomerAuthError: vi.fn(),
}));

import { __clearTokenCacheForTesting } from '@/lib/share/inject-preview-token';
import { GET } from '../route';

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;

const SITE_A = {
  id: 'app-a',
  preview_url: 'https://app-a.preview.c4.test-airoapp.ai',
  published_url: 'https://app-a.publish.c4.test-airoapp.ai',
  agent_url: 'https://app-a.agent.c4.test-airoapp.ai',
};
const SITE_B = {
  id: 'app-b',
  preview_url: 'https://app-b.preview.c4.test-airoapp.ai',
  published_url: 'https://app-b.publish.c4.test-airoapp.ai',
  agent_url: 'https://app-b.agent.c4.test-airoapp.ai',
};
const SITE_PENDING = {
  id: 'app-pending',
  // No preview_url / agent_url yet — still provisioning.
};

describe('GET /api/sites (list) — preview_url airoShareToken injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearTokenCacheForTesting();
    mockCheckSwitchboardFlag.mockResolvedValue(true);
  });

  it('injects token into preview_url for each site (in parallel)', async () => {
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_B }]);
    // First call (for SITE_A): returns active token.
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [{ token: 'token-a', expiresAt: FUTURE }],
      }),
    });
    // Second call (for SITE_B): also returns active token.
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [{ token: 'token-b', expiresAt: FUTURE }],
      }),
    });

    const res = await GET(new NextRequest('http://localhost/api/sites'));
    const body = await res.json();

    expect(body).toHaveLength(2);
    expect(body[0].preview_url).toBe(`${SITE_A.preview_url}/?airoShareToken=token-a`);
    expect(body[1].preview_url).toBe(`${SITE_B.preview_url}/?airoShareToken=token-b`);
    // Both list calls fired — proof Promise.all worked.
    expect(mockAgentFetch).toHaveBeenCalledTimes(2);
  });

  it('skips injection for sites missing preview_url or agent_url', async () => {
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_PENDING }]);
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [{ token: 'token-a', expiresAt: FUTURE }],
      }),
    });

    const res = await GET(new NextRequest('http://localhost/api/sites'));
    const body = await res.json();

    expect(body).toHaveLength(2);
    expect(body[0].preview_url).toContain('?airoShareToken=token-a');
    // Pending app: preview_url stays undefined (no injection)
    expect(body[1].preview_url).toBeUndefined();
    // Only one agent call fired — for SITE_A, not for the pending app.
    expect(mockAgentFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to bare preview_url when one site\'s injection fails (others succeed)', async () => {
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_B }]);
    // Promise.all schedules calls for SITE_A and SITE_B in parallel and the
    // observed call order isn't guaranteed, so route by URL rather than
    // queueing mockResolvedValueOnce.
    mockAgentFetch.mockImplementation(async (url: string) => {
      if (url.includes(SITE_A.id)) {
        return { ok: false, status: 500, text: async () => 'err' };
      }
      if (url.includes(SITE_B.id)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokens: [{ token: 'token-b', expiresAt: FUTURE }],
          }),
        };
      }
      throw new Error(`Unexpected agentFetch URL: ${url}`);
    });

    const res = await GET(new NextRequest('http://localhost/api/sites'));
    const body = await res.json();

    // SITE_A bare (both list + mint failed → fail-open), SITE_B has token.
    // Critically, Promise.all completed despite SITE_A's failure path.
    expect(body[0].preview_url).toBe(SITE_A.preview_url);
    expect(body[1].preview_url).toContain('?airoShareToken=token-b');
  });

  it('returns bare list when the appbuilder-share-links flag is off', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_B }]);

    const res = await GET(new NextRequest('http://localhost/api/sites'));
    const body = await res.json();

    expect(body[0].preview_url).toBe(SITE_A.preview_url);
    expect(body[1].preview_url).toBe(SITE_B.preview_url);
    // No agent calls — short-circuited above the loop.
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('returns bare list + logs when Switchboard lookup throws (does not 500)', async () => {
    // Switchboard outage must not take down /api/sites. Treat lookup
    // failures as flag-off so the route still returns the site list.
    mockCheckSwitchboardFlag.mockRejectedValue(new Error('Atlas fetch failed'));
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_B }]);

    const res = await GET(new NextRequest('http://localhost/api/sites'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].preview_url).toBe(SITE_A.preview_url);
    expect(body[1].preview_url).toBe(SITE_B.preview_url);
    expect(mockAgentFetch).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.previewUrl.flag.lookupError',
      expect.objectContaining({ error: 'Atlas fetch failed' }),
    );
  });

  it('does not modify any published_url', async () => {
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_B }]);
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [{ token: 'token-a', expiresAt: FUTURE }] }),
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [{ token: 'token-b', expiresAt: FUTURE }] }),
    });

    const res = await GET(new NextRequest('http://localhost/api/sites'));
    const body = await res.json();

    expect(body[0].published_url).toBe(SITE_A.published_url);
    expect(body[1].published_url).toBe(SITE_B.published_url);
  });
});

describe('GET /api/sites?site_id=<id> — preview_url airoShareToken injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearTokenCacheForTesting();
    mockCheckSwitchboardFlag.mockResolvedValue(true);
  });

  it('injects token for the single site (?site_id= variant)', async () => {
    mockGetSite.mockResolvedValue({ ...SITE_A });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [{ token: 'token-a', expiresAt: FUTURE }] }),
    });

    const res = await GET(new NextRequest(`http://localhost/api/sites?site_id=${SITE_A.id}`));
    const body = await res.json();

    expect(body.preview_url).toBe(`${SITE_A.preview_url}/?airoShareToken=token-a`);
  });

  it('returns bare preview_url when flag is off (?site_id= variant)', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    mockGetSite.mockResolvedValue({ ...SITE_A });

    const res = await GET(new NextRequest(`http://localhost/api/sites?site_id=${SITE_A.id}`));
    const body = await res.json();

    expect(body.preview_url).toBe(SITE_A.preview_url);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('returns 404 when site not found (?site_id= variant)', async () => {
    mockGetSite.mockResolvedValue(null);

    const res = await GET(new NextRequest(`http://localhost/api/sites?site_id=missing`));
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });
});
