/**
 * Tests for /api/sites/[id] GET — focused on the airoShareToken injection
 * into `preview_url`. The `preview_auth` cookie is partitioned (CHIPS) and
 * never carries to a top-level visit, so the token is the only auth handoff
 * when owners click "Visit Preview"; injection is unconditional.
 *
 * The injection lives at the BFF layer (this route) so no UI code is
 * affected — every existing consumer of `site.preview_url` automatically
 * picks up the token-bearing URL.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockDeleteSite,
  mockEnforce,
  mockAgentFetch,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockDeleteSite: vi.fn(),
  mockEnforce: vi.fn(),
  mockAgentFetch: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite, deleteSite: mockDeleteSite }; }),
}));
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn().mockResolvedValue(false),
  checkSwitchboardValue: vi.fn().mockResolvedValue(null),
  checkSwitchboardObject: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/authz-fga/multi-user-flag', () => ({
  resolveMultiUserFlag: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/authz-fga/enforce-venture-relation', () => ({
  enforceAabMultiUserVentureRelation: mockEnforce,
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...args: any[]) =>
    handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: { customerId: 'cust-1' } }, ...args),
  customerHasAccount: vi.fn(function () { return true; }),
  createCustomerAuthError: vi.fn((message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status })),
}));

import { __clearTokenCacheForTesting } from '@/lib/share/inject-preview-token';
import { DELETE, GET } from '../route';

const APP_ID = 'app-123';
const AGENT_URL = 'https://agent.test';
const PREVIEW_URL = 'https://app-123.preview.c4.test-airoapp.ai';
const PUBLISHED_URL = 'https://app-123.publish.c4.test-airoapp.ai';
const ACTIVE_TOKEN = 'tokABCDEFGH';
const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;
const PAST = Date.now() - 60 * 1000; // 1 minute ago — already expired

function makeRequest(): NextRequest {
  return new NextRequest(`https://airo.test/api/sites/${APP_ID}`);
}

const params = Promise.resolve({ id: APP_ID });

describe('GET /api/sites/[id] — preview_url airoShareToken injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Module-level cache survives across tests; clear it explicitly so a
    // hit from one case can't satisfy a different case's call expectation.
    __clearTokenCacheForTesting();
    mockGetSite.mockResolvedValue({
      preview_url: PREVIEW_URL,
      published_url: PUBLISHED_URL,
      agent_url: AGENT_URL,
    });
  });

  it('appends the token from an existing active share token', async () => {
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [
          { token: ACTIVE_TOKEN, expiresAt: FUTURE },
        ],
      }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(`${PREVIEW_URL}/?airoShareToken=${ACTIVE_TOKEN}`);
    // Mint endpoint must NOT have fired — we reused the existing token.
    expect(mockAgentFetch).toHaveBeenCalledTimes(1);
    expect(mockAgentFetch.mock.calls[0]![1]).not.toMatchObject({ method: 'POST' });
  });

  it('mints when every token in the list has already expired (multiple expired)', async () => {
    // Pins the .find((t) => t.expiresAt > now) predicate against a future
    // refactor that returns "any token, client will cope" — agents would
    // 409 such a request and we'd serve a dead URL.
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [
          { token: 'old-token-1', expiresAt: PAST },
          { token: 'old-token-2', expiresAt: PAST - 1000 },
          { token: 'old-token-3', expiresAt: PAST - 60_000 },
        ],
      }),
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ token: 'fresh-token', expiresAt: FUTURE }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(`${PREVIEW_URL}/?airoShareToken=fresh-token`);
    expect(mockAgentFetch).toHaveBeenCalledTimes(2);
    expect(mockAgentFetch.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
  });

  it('serves the second call from cache (no extra agent calls within TTL)', async () => {
    // Performance pin: a list endpoint with N apps polled every ~10s
    // should not fan out N agent calls per poll. With the cache, the
    // first /api/sites/[id] call mints/fetches once; subsequent calls
    // within the 5-min TTL serve from memory.
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [{ token: ACTIVE_TOKEN, expiresAt: FUTURE }],
      }),
    });

    // First call — populates cache.
    const res1 = await GET(makeRequest(), { params });
    expect((await res1.json()).preview_url).toBe(
      `${PREVIEW_URL}/?airoShareToken=${ACTIVE_TOKEN}`,
    );
    expect(mockAgentFetch).toHaveBeenCalledTimes(1);

    // Second call — must NOT hit agents.
    const res2 = await GET(makeRequest(), { params });
    expect((await res2.json()).preview_url).toBe(
      `${PREVIEW_URL}/?airoShareToken=${ACTIVE_TOKEN}`,
    );
    expect(mockAgentFetch).toHaveBeenCalledTimes(1); // unchanged
  });

  it('does NOT serve an expired token from cache even within TTL', async () => {
    // Belt-and-suspenders pin: the cache check is
    //   `now - cachedAt < CACHE_TTL_MS && cached.expiresAt > now`.
    // The expiresAt guard is what protects us when agents hands back a
    // near-expiry token (e.g. 1 minute remaining at cache time, expired
    // by the next polling tick). Without it, the cache would happily
    // keep serving an expired token for the rest of the 5-min TTL,
    // causing dev-supervisor to bounce recipients with 401s and the
    // operator seeing no signal.
    //
    // Use fake timers to advance from "1s remaining" through expiry.
    vi.useFakeTimers();
    try {
      const NEAR_EXPIRY = Date.now() + 1000; // 1 second remaining
      mockAgentFetch
        // First call: list returns the near-expiry token.
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            tokens: [{ token: 'near-expiry', expiresAt: NEAR_EXPIRY }],
          }),
        })
        // Second call after the token expires: list returns nothing,
        // mint produces a fresh token.
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ tokens: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ token: 'fresh', expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 }),
        });

      // First call: caches the near-expiry token.
      const res1 = await GET(makeRequest(), { params });
      expect((await res1.json()).preview_url).toContain('?airoShareToken=near-expiry');
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);

      // Advance past the token's expiresAt (and outside the cache hit
      // condition). TTL is still well under 5 min — the only thing
      // that should kick the cache is the expiresAt guard.
      vi.advanceTimersByTime(2000);

      // Second call: cache must NOT serve the expired token. Re-fetch
      // from agents (list + mint).
      const res2 = await GET(makeRequest(), { params });
      expect((await res2.json()).preview_url).toContain('?airoShareToken=fresh');
      expect(mockAgentFetch).toHaveBeenCalledTimes(3); // 1 original + 2 for re-fetch
    } finally {
      vi.useRealTimers();
    }
  });

  it('mints a new token when the only token in the list has already expired', async () => {
    // Filter cutoff is `expiresAt > Date.now()` — same as agents'
    // own definition of "active." An expired token is skipped, mint
    // fires, the fresh token is what we return.
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [{ token: 'expired-token', expiresAt: PAST }],
      }),
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ token: 'fresh-token', expiresAt: FUTURE }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(`${PREVIEW_URL}/?airoShareToken=fresh-token`);
    expect(mockAgentFetch).toHaveBeenCalledTimes(2);
    expect(mockAgentFetch.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
  });

  it('uses any still-active token from GET regardless of remaining lifetime', async () => {
    // No expiry buffer — if agents would 409 on a mint attempt for this
    // token (i.e. expiresAt > now), we just use it. Burning a round trip
    // to "prefer minting fresh" doesn't help: agents won't actually let
    // us mint a replacement while one is active.
    const NEAR_EXPIRY = Date.now() + 30 * 60 * 1000; // 30 minutes left
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [{ token: 'near-expiry-token', expiresAt: NEAR_EXPIRY }],
      }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(`${PREVIEW_URL}/?airoShareToken=near-expiry-token`);
    // Single round trip — no wasteful POST mint that would just 409.
    expect(mockAgentFetch).toHaveBeenCalledTimes(1);
  });

  it('mints when the list returns an empty tokens array', async () => {
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [] }),
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ token: 'newly-minted', expiresAt: FUTURE }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(`${PREVIEW_URL}/?airoShareToken=newly-minted`);
    expect(mockAgentFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to bare preview_url when agents list fails (and logs)', async () => {
    mockAgentFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });
    // Mint also fails — full failure path.
    mockAgentFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(PREVIEW_URL);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.previewUrl.list.failure',
      expect.objectContaining({ appId: APP_ID, status: 500 }),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.previewUrl.mint.failure',
      expect.objectContaining({ appId: APP_ID, status: 500 }),
    );
  });

  it('falls back to bare preview_url when agentFetch throws', async () => {
    mockAgentFetch.mockRejectedValueOnce(new Error('network down'));

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(PREVIEW_URL);
    // Logged at warn level (not error): promoting log level is a behavior
    // change that needs alerting-team coordination, so the helper's outer
    // catch stays at `warn` as a safe default. Stack is still attached
    // for triage value.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.previewUrl.inject.error',
      expect.objectContaining({ appId: APP_ID, error: 'network down' }),
    );
  });

  it('does not modify published_url under any condition', async () => {
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [{ token: ACTIVE_TOKEN, expiresAt: FUTURE }],
      }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    // published_url stays bare even when injection succeeds for preview_url.
    expect(body.published_url).toBe(PUBLISHED_URL);
    expect(body.preview_url).toContain('?airoShareToken=');
  });

  it('skips injection when site has no preview_url (pending app)', async () => {
    mockGetSite.mockResolvedValue({
      preview_url: undefined,
      published_url: undefined,
      agent_url: AGENT_URL,
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBeUndefined();
    // Skip injection entirely — no agents calls fired.
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('skips injection when site has no agent_url (agent not allocated yet)', async () => {
    mockGetSite.mockResolvedValue({
      preview_url: PREVIEW_URL,
      published_url: PUBLISHED_URL,
      agent_url: undefined,
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(PREVIEW_URL);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('preserves pre-existing query params on preview_url when appending the token', async () => {
    // Some envs may already have query params on the URL (e.g. ?dev=1).
    const previewWithQuery = `${PREVIEW_URL}/?dev=1`;
    mockGetSite.mockResolvedValue({
      preview_url: previewWithQuery,
      published_url: PUBLISHED_URL,
      agent_url: AGENT_URL,
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tokens: [{ token: ACTIVE_TOKEN, expiresAt: FUTURE }],
      }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    // Both query params present.
    expect(body.preview_url).toContain('dev=1');
    expect(body.preview_url).toContain(`airoShareToken=${ACTIVE_TOKEN}`);
  });

  it('returns 404 when the site does not exist (no injection attempted)', async () => {
    mockGetSite.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('handles list response without a tokens key (treats as empty list)', async () => {
    // {} should be parsed as "no tokens" (data.tokens?.find returns undefined)
    // and proceed to mint. Documents the optional-chaining contract; an
    // accidental refactor that removes the `?` and crashes on undefined
    // would now fail this test.
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}), // no tokens key at all
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ token: 'minted-token', expiresAt: FUTURE }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(`${PREVIEW_URL}/?airoShareToken=minted-token`);
    expect(mockAgentFetch).toHaveBeenCalledTimes(2);
  });

  it('logs list.parseError when GET 200 body is not valid JSON', async () => {
    // Proxy timeout HTML, truncated body, etc. Must log so an operator
    // can grep — silent fall-through to mint hides the underlying issue.
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ token: 'minted-token', expiresAt: FUTURE }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toContain('?airoShareToken=minted-token');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.previewUrl.list.parseError',
      expect.objectContaining({ appId: APP_ID }),
    );
  });

  it('logs mint.parseError when POST 201 body is not valid JSON (and falls back)', async () => {
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [] }),
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(PREVIEW_URL); // bare URL fallback
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.previewUrl.mint.parseError',
      expect.objectContaining({ appId: APP_ID }),
    );
  });

  it('logs mint.missingToken when POST 201 returns valid JSON without a token field', async () => {
    // 2xx success that isn't — schema drift / proxy envelope. Hardest
    // failure mode to detect without a log: user gets bare URL, polling
    // goes through fine, dev-supervisor returns 401 for Visit Preview,
    // and there's nothing to grep for.
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tokens: [] }),
    });
    mockAgentFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ /* no token field */ expiresAt: FUTURE }),
    });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(PREVIEW_URL); // bare URL fallback
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.previewUrl.mint.missingToken',
      expect.objectContaining({ appId: APP_ID, status: 201 }),
    );
  });

  it('logs retryTokenGone and falls back when 409 retry GET succeeds but returns no active token', async () => {
    // 409 path with re-GET coming back 200 + empty: the concurrent caller's
    // token was deleted between our POST 409 and re-GET (rare). This case
    // has its own log (retryTokenGone) distinct from recoveryFailed —
    // operators searching for "recoveryFailed with retryStatus: 200" would
    // find a contradiction; retryTokenGone names it clearly.
    mockAgentFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tokens: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => 'An active share link already exists for this app',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tokens: [] }), // somehow now empty
      });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(PREVIEW_URL); // bare URL fallback
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share.previewUrl.mint.retryTokenGone',
      // replaceActive: false here because this test sets up a first-mint
      // path (GET returns empty, then POST 409, then retry-GET empty).
      // Distinguishes from rotation-time 409 recovery in Loki.
      expect.objectContaining({ appId: APP_ID, replaceActive: false }),
    );
    // The contradictory `recoveryFailed` with retryStatus: 200 is NOT emitted
    // — retryTokenGone owns this case exclusively now.
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'share.previewUrl.mint.recoveryFailed',
      expect.anything(),
    );
  });

  it('recovers via re-GET when POST mint returns 409 (concurrent mint)', async () => {
    // Race scenario: GET returns no active token (or a near-expiry one),
    // POST returns 409 because a concurrent caller minted between our calls.
    // agents 409 body has no token (just an error string), so the helper
    // must re-GET to pick up the freshly-minted token.
    mockAgentFetch
      // First GET: empty list (no usable active token).
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tokens: [] }),
      })
      // POST: 409 from agents (active link already exists).
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => 'An active share link already exists for this app',
      })
      // Re-GET: the concurrent caller's token is now visible.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [{ token: 'concurrent-token', expiresAt: FUTURE }],
        }),
      });

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(body.preview_url).toBe(`${PREVIEW_URL}/?airoShareToken=concurrent-token`);
    expect(mockAgentFetch).toHaveBeenCalledTimes(3);
    // The 409 was logged at info level (expected condition, not failure).
    expect(mockLogger.info).toHaveBeenCalledWith(
      'share.previewUrl.mint.alreadyActive',
      expect.objectContaining({ appId: APP_ID }),
    );
  });
});

describe('DELETE /api/sites/[id] — FGA delete gate', () => {
  function deleteRequest(): NextRequest {
    return new NextRequest(`https://airo.test/api/sites/${APP_ID}`, { method: 'DELETE' });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforce.mockResolvedValue(null);
    mockGetSite.mockResolvedValue({ id: APP_ID, team_venture_id: 'v1', owner_customer_id: 'owner-9' });
    mockDeleteSite.mockResolvedValue({ success: true });
  });

  it('returns the deny response and does NOT delete when the FGA delete gate denies', async () => {
    mockEnforce.mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(403);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockDeleteSite).not.toHaveBeenCalled();
  });

  it('proceeds to delete when the FGA delete gate allows (null)', async () => {
    mockEnforce.mockResolvedValue(null);

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(200);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockDeleteSite).toHaveBeenCalledTimes(1);
  });
});
