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
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
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
    withCustomerAuth: vi.fn(function (handler: any, options?: unknown) {
      // First withCustomerAuth call in route.ts is GET, second is POST.
      const tag = counter++ === 0 ? 'GET' : 'POST';
      capturedAuthOptions.set(tag, options);
      return async (request: NextRequest, ...args: any[]) =>
        handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: {} }, ...args);
    }),
  };
});

import { __clearRotationCooldownForTesting } from '../rotation-helpers';
import { GET, POST } from '../route';

const APP_ID = 'app-123';

describe('Auth level configuration', () => {
  it('GET handler is registered at default auth level 1', () => {
    // Pin: GET stays at default level 1. The full rationale (popover UX
    // frequency, opportunistic rotation, level-3-POST coverage) lives in
    // the handler JSDoc at route.ts — kept there because it informs the
    // implementation, not the test shape.
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
    // Module-level rotation-cooldown Map survives across tests; reset so
    // a cooldown set in one test can't suppress rotation in another.
    __clearRotationCooldownForTesting();
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

  describe('auto-rotation when freshest active token is stale', () => {
    // DomainMenu's "Share Preview" popover (useShareTokens hook) reads the
    // FIRST active token from this response and shows it as the canonical
    // share link. Without auto-rotation, a 6-day-old token still gets
    // handed out — the recipient gets a link with ~24h of validity. These
    // tests pin the rotation contract end-to-end.
    const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const isoMsAgo = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

    it('rotates via replaceActive=true when the freshest active token is older than 24h', async () => {
      // GET returns a 25h-old token → past freshness window.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      });
      // POST rotation succeeds.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'fresh-tok',
          appId: APP_ID,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: new Date().toISOString(),
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();

      // Fresh token prepended — UI's `tokens.find(active)` picks the first,
      // which is now the rotated token with full 7-day validity.
      expect(body.tokens).toHaveLength(2);
      expect(body.tokens[0].token).toBe('fresh-tok');
      expect(body.tokens[1].token).toBe('stale-tok');

      // Verify POST went out with replaceActive: true and 7-day expiry.
      const [, postOpts] = mockAgentFetch.mock.calls[1];
      const postBody = JSON.parse(postOpts.body);
      expect(postBody.replaceActive).toBe(true);
      expect(postBody.expiresIn).toBe(7 * 24 * 60 * 60);

      // rotated log carries shareTokenSuffix (not raw token), expiresAt, and
      // previousFreshestAgeMs for Loki correlation with the matching
      // share.api.list.rotation.begin event.
      expect(mockLogger.info).toHaveBeenCalledWith(
        'share.api.list.rotated',
        expect.objectContaining({
          appId: APP_ID,
          shareTokenSuffix: expect.any(String),
          expiresAt: expect.any(Number),
          previousFreshestAgeMs: expect.any(Number),
        }),
      );
    });

    it('normalizes firstUsedAt to null on the rotated entry (matches list-entry shape)', async () => {
      // Agents POST response shape lacks `firstUsedAt` (it can't have
      // been used yet — the token is brand new). Agents GET list shape
      // includes it as null or ISO string. Without normalization at
      // the BFF, the rotated entry would have `firstUsedAt: undefined`
      // while the rest of the list has `null`/ISO — downstream
      // `token.firstUsedAt === null` checks would diverge between the
      // newly-rotated row and everything else.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          // Note: no `firstUsedAt` — matches agents POST shape.
          token: 'fresh-tok',
          appId: APP_ID,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: new Date().toISOString(),
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      const body = await res.json();

      // The rotated entry has firstUsedAt: null (normalized), matching
      // the shape of every other list entry.
      expect(body.tokens[0]).toMatchObject({
        token: 'fresh-tok',
        firstUsedAt: null,
      });
      // And the original list entry's firstUsedAt is preserved.
      expect(body.tokens[1].firstUsedAt).toBe(null);
    });

    it('preserves unknown fields from the agents response (forward compat)', async () => {
      // If agents adds a `pagination` or `metadata` field later, the BFF
      // should forward it transparently instead of dropping it. Pin via
      // a synthetic field on the GET response.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [{ token: 'a', expiresAt: FUTURE, createdAt: isoMsAgo(1000), firstUsedAt: null }],
          // Synthetic future field — must not get dropped.
          paginationCursor: 'opaque-cursor-string',
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      const body = await res.json();
      expect(body.paginationCursor).toBe('opaque-cursor-string');
      expect(body.tokens).toHaveLength(1);
    });

    it('suppresses a second rotation attempt within the per-process cooldown window', async () => {
      // Tab-storm guard: 5 tabs opening simultaneously, React Strict
      // Mode double-firing, multiple useShareTokens consumers on one
      // page — all of these can race past the same stale-token check
      // and each fire their own replaceActive POST. The cooldown Map
      // collapses these same-event bursts so we mint one fresh token,
      // not N.
      const staleListResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      };
      // First call: list + rotation POST = 2 agent calls
      mockAgentFetch
        .mockResolvedValueOnce(staleListResponse)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            token: 'fresh-tok-1',
            appId: APP_ID,
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
            createdAt: new Date().toISOString(),
          }),
        });

      await GET(makeRequest('GET'), { params });
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);
      // Sanity: first call did rotate.
      expect(mockLogger.info).toHaveBeenCalledWith(
        'share.api.list.rotation.begin',
        expect.objectContaining({ appId: APP_ID }),
      );

      // Second call (simulating a parallel tab): list returns the same
      // stale token, but cooldown is in effect so no POST fires.
      mockAgentFetch.mockClear();
      mockLogger.info.mockClear();
      mockAgentFetch.mockResolvedValueOnce(staleListResponse);

      const res2 = await GET(makeRequest('GET'), { params });
      expect(res2.status).toBe(200);
      // Only the list call — POST was suppressed by cooldown.
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
      // Cooldown event logged so an operator can see the suppression.
      expect(mockLogger.info).toHaveBeenCalledWith(
        'share.api.list.rotation.cooldown',
        expect.objectContaining({
          appId: APP_ID,
          freshestAgeMs: expect.any(Number),
          cooldownMs: expect.any(Number),
        }),
      );
      // The rotation.begin event did NOT fire on the second call.
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'share.api.list.rotation.begin',
        expect.anything(),
      );
    });

    it('allows rotation again after the cooldown is cleared', async () => {
      // Pin: cooldown is per-appId, not global. Reset via the test hook
      // simulates the 60s window elapsing.
      const staleListResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      };
      const mintResponse = {
        ok: true,
        status: 201,
        json: async () => ({
          token: 'fresh-tok',
          appId: APP_ID,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: new Date().toISOString(),
        }),
      };

      // First call: rotates.
      mockAgentFetch.mockResolvedValueOnce(staleListResponse).mockResolvedValueOnce(mintResponse);
      await GET(makeRequest('GET'), { params });
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);

      // Clear the cooldown (simulates 60s window elapsing).
      __clearRotationCooldownForTesting();
      mockAgentFetch.mockClear();

      // Second call: rotation fires again now that cooldown is gone.
      mockAgentFetch.mockResolvedValueOnce(staleListResponse).mockResolvedValueOnce(mintResponse);
      await GET(makeRequest('GET'), { params });
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);
    });

    it('does NOT log the raw token in share.api.list.rotated (uses tokenSuffix)', async () => {
      // Symmetry with the POST path's "does not log the raw token" test.
      // A refactor that swapped shareTokenSuffix for the raw token field
      // would otherwise slip through.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'extremely-secret-fresh-tok',
          appId: APP_ID,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: new Date().toISOString(),
        }),
      });

      await GET(makeRequest('GET'), { params });

      // The raw token must NOT appear in any logger.info payload.
      const allInfoCalls = mockLogger.info.mock.calls;
      for (const call of allInfoCalls) {
        const payload = JSON.stringify(call[1] ?? {});
        expect(payload).not.toContain('extremely-secret-fresh-tok');
      }
    });

    it('does NOT rotate when the freshest active token is within the 24h window', async () => {
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'fresh-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(23 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      // Only the list call fired — no rotation POST.
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
    });

    it('skips rotation when no active token exists (empty list)', async () => {
      // Initial-mint case is the responsibility of the UI/`useCreateShareToken`,
      // not the GET handler. Don't sneak in a hidden mint here.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tokens: [] }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
    });

    it('picks the freshest active token among multiple — only rotates if THAT one is stale', async () => {
      // Steady state after a previous rotation: two active tokens, one old
      // (was rotated yesterday), one new. Should NOT trigger another
      // rotation just because the OLD token is stale — the fresh one
      // already covers the freshness contract.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'older-still-active',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000), // stale
              firstUsedAt: null,
            },
            {
              token: 'recent-fresh',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(1000), // 1s ago — well within freshness window
              firstUsedAt: null,
            },
          ],
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      // Only the list call fired — the freshest token is fresh, no rotation owed.
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to the stale list when rotation POST fails (5xx)', async () => {
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();

      // GET still succeeds with the existing stale token — graceful
      // degradation. Recipient gets a working (if short-validity) link.
      expect(body.tokens).toHaveLength(1);
      expect(body.tokens[0].token).toBe('stale-tok');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.api.list.rotation.failed',
        expect.objectContaining({ appId: APP_ID, status: 503 }),
      );
    });

    it('falls back gracefully when agents returns 2xx but the rotation response lacks a token field', async () => {
      // Defense against schema drift / proxy envelope wrapping. The GET
      // must still return successfully — never 500 just because the
      // optional rotation step misbehaved.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ /* missing token field */ expiresAt: Date.now() + 1000 }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tokens).toHaveLength(1);
      expect(body.tokens[0].token).toBe('stale-tok');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.api.list.rotation.missingToken',
        // status + responseKeys included so a renamed-success-shape
        // future regression is debuggable from Loki without a code dive.
        expect.objectContaining({
          appId: APP_ID,
          status: 201,
          responseKeys: expect.arrayContaining(['expiresAt']),
        }),
      );
    });

    it('skips rotation defensively when active tokens have malformed createdAt (no age signal)', async () => {
      // Older agents binaries (pre-rotation PR) emit GET responses without
      // `createdAt`. Without the field we have no way to compute age, so
      // the only safe action is to skip rotation and return the list as-is.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'unknown-age',
              appId: APP_ID,
              expiresAt: FUTURE,
              // no createdAt field
              firstUsedAt: null,
            },
          ],
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
      // Active token but no parseable createdAt → emit the dedicated warn
      // so an operator can detect a silent rotation-disable fleet-wide.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.api.list.rotation.noParseableCreatedAt',
        expect.objectContaining({ appId: APP_ID, activeTokenCount: 1 }),
      );
    });

    it('emits noParseableCreatedAt warn when createdAt is a non-string type (e.g. epoch number)', async () => {
      // Defense against schema drift where an upstream version starts
      // emitting createdAt as a number. Our narrowing rejects it (only
      // `typeof === 'string'` is accepted) so we'd otherwise silently
      // disable rotation with no log signal.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'numeric-createdat',
              appId: APP_ID,
              expiresAt: FUTURE,
              // Number, not the expected ISO string.
              createdAt: Date.now(),
              firstUsedAt: null,
            },
          ],
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.api.list.rotation.noParseableCreatedAt',
        expect.objectContaining({ appId: APP_ID }),
      );
    });

    it('emits noParseableCreatedAt warn when createdAt is a string that fails Date parsing (NaN)', async () => {
      // Pin the specific NaN-from-Date path: a string that gets through
      // the `typeof === 'string'` check but produces NaN when parsed.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'unparseable-date',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: 'not a date',
              firstUsedAt: null,
            },
          ],
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.api.list.rotation.noParseableCreatedAt',
        expect.objectContaining({ appId: APP_ID }),
      );
    });

    it('does NOT emit noParseableCreatedAt when the list is genuinely empty (no active tokens)', async () => {
      // Empty list is a different scenario — first-mint case, handled by
      // the UI. We must NOT emit the parse warning here or operators
      // would chase a non-issue for any new app on every popover open.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tokens: [] }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      const noParseableCalls = mockLogger.warn.mock.calls.filter(
        (call) => call[0] === 'share.api.list.rotation.noParseableCreatedAt',
      );
      expect(noParseableCalls).toHaveLength(0);
    });

    it('handles a response with no `tokens` field at all (treats as empty)', async () => {
      // Defensive: agents proxy envelope wrapping a 200 with `{}` instead
      // of `{ tokens: [] }`. The Array.isArray check downgrades it to []
      // and no rotation fires (no active tokens to be stale).
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tokens).toEqual([]);
      // No POST fired — only the GET.
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
    });

    it('triggers rotation at exactly the 24h boundary (predicate uses >=)', async () => {
      // Off-by-one pin: `isStaleByFreshness` uses `>=` so rotation fires
      // AT the boundary, not after. A future change to `>` would defer
      // rotation by an extra polling cycle; this test catches that.
      const exactly24h = 24 * 60 * 60 * 1000;
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'at-boundary',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(exactly24h),
              firstUsedAt: null,
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'rotated-at-boundary',
          appId: APP_ID,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: new Date().toISOString(),
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tokens[0].token).toBe('rotated-at-boundary');
    });

    it('picks the freshest among mixed expired + active tokens (does not let an expired-recent one win)', async () => {
      // A token that EXPIRED 1ms ago but has a very recent createdAt must
      // NOT count as "the freshest active." The expiresAt > now filter
      // gates inclusion in the freshness scan. Pin so a future refactor
      // that swaps filter order wouldn't quietly disable rotation.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'expired-but-recent-createdat',
              appId: APP_ID,
              expiresAt: Date.now() - 1, // expired 1ms ago
              createdAt: new Date().toISOString(), // brand new
              firstUsedAt: null,
            },
            {
              token: 'stale-but-active',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000), // 25h old
              firstUsedAt: null,
            },
          ],
        }),
      });
      // Rotation MUST fire because the stale-but-active token's age
      // wins the scan (the expired one is filtered out before the age
      // check).
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'rotated-from-stale',
          appId: APP_ID,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: new Date().toISOString(),
        }),
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      // Both POST + GET fired → rotation happened.
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);
    });

    it('falls back to the stale list when rotation POST throws (network-layer error)', async () => {
      // The !ok branch covers HTTP error responses. The throw branch
      // covers transport-layer failures (DNS, ECONNRESET, agentFetch
      // timeouts before headers arrive). Distinct event name lets
      // operators split "agents rejected" from "couldn't reach agents."
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      });
      mockAgentFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Stale token still returned — graceful degradation.
      expect(body.tokens).toHaveLength(1);
      expect(body.tokens[0].token).toBe('stale-tok');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.api.list.rotation.error',
        expect.objectContaining({ appId: APP_ID, error: 'ECONNRESET' }),
      );
    });

    it('falls back to the stale list when rotation POST returns 2xx with non-JSON body (parseError)', async () => {
      // Proxy timeout HTML wrapping a 201, truncated body, etc. Must be
      // logged with a distinct event so operators can grep without
      // chasing the generic outer-catch error.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              appId: APP_ID,
              expiresAt: FUTURE,
              createdAt: isoMsAgo(25 * 60 * 60 * 1000),
              firstUsedAt: null,
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
      });

      const res = await GET(makeRequest('GET'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tokens).toHaveLength(1);
      expect(body.tokens[0].token).toBe('stale-tok');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.api.list.rotation.parseError',
        expect.objectContaining({ appId: APP_ID, status: 201 }),
      );
    });
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
