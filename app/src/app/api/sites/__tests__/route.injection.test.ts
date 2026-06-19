/**
 * Tests for the airoShareToken injection path on the /api/sites endpoint.
 *
 * The list GET returns the control-plane payload as-is (no per-app token
 * injection) — keeping an un-paginated list lightweight and avoiding stalls
 * on hibernated/unreachable agents. The token is injected on-demand only on
 * the ?site_id= single-site path, which the Projects-page preview button
 * calls when a preview is opened. Same mitigation as /api/sites/[id] — see
 * lib/share/inject-preview-token.ts.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockListSites,
  mockAgentFetch,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockListSites: vi.fn(),
  mockAgentFetch: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return {
    getSite: mockGetSite,
    listSites: mockListSites,
  }; }),
}));
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
// Mock the switchboard so resolveMultiUserFlag → checkSwitchboardFlag never hits
// the real gasket visitor/Atlas pipeline (a network fetch that surfaces as an
// unhandled AtlasFetchError rejection and fails the run). getSite/listSites are
// mocked, so the resolved flag value doesn't affect these injection assertions.
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/translations/server-intl', () => ({
  detectTranslationLocale: vi.fn().mockResolvedValue('en-US'),
}));
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...args: any[]) =>
    handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: {} }, ...args),
  customerHasAccount: vi.fn(function () { return true; }),
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

describe('GET /api/sites (list) — returns control-plane payload as-is', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearTokenCacheForTesting();
  });

  it('returns the site list verbatim with no per-site token injection', async () => {
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_B }]);

    const res = await GET(new NextRequest('http://localhost/api/sites'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    // preview_url returned exactly as the control plane provided it — no
    // ?airoShareToken= appended. Tokens are injected on-demand via the
    // ?site_id= path when a preview is opened.
    expect(body[0].preview_url).toBe(SITE_A.preview_url);
    expect(body[1].preview_url).toBe(SITE_B.preview_url);
    expect(body[0].published_url).toBe(SITE_A.published_url);
    expect(body[1].published_url).toBe(SITE_B.published_url);
  });

  it('does no per-app backend work: no agent calls on the list path', async () => {
    // A list GET must stay lightweight (this endpoint is intentionally
    // un-paginated). Iterating to mint/rotate tokens per app — including for
    // hibernated apps whose agent is down — is exactly what made it slow.
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_B }]);

    await GET(new NextRequest('http://localhost/api/sites'));

    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('returns sites that are still provisioning unchanged', async () => {
    mockListSites.mockResolvedValue([{ ...SITE_A }, { ...SITE_PENDING }]);

    const res = await GET(new NextRequest('http://localhost/api/sites'));
    const body = await res.json();

    expect(body).toHaveLength(2);
    expect(body[0].preview_url).toBe(SITE_A.preview_url);
    expect(body[1].preview_url).toBeUndefined();
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/sites?site_id=<id> — preview_url airoShareToken injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearTokenCacheForTesting();
  });

  it('injects token for the single site unconditionally (?site_id= variant)', async () => {
    // The appbuilder-share-links rollout is complete, so the single-site path
    // always injects when preview_url + agent_url are present — no flag gate.
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

  it('returns the bare site (no injection) when it has no preview_url/agent_url', async () => {
    mockGetSite.mockResolvedValue({ ...SITE_PENDING });

    const res = await GET(new NextRequest(`http://localhost/api/sites?site_id=${SITE_PENDING.id}`));
    const body = await res.json();

    expect(body.id).toBe(SITE_PENDING.id);
    expect(body.preview_url).toBeUndefined();
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('returns 404 when site not found (?site_id= variant)', async () => {
    mockGetSite.mockResolvedValue(null);

    const res = await GET(new NextRequest(`http://localhost/api/sites?site_id=missing`));
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });
});
