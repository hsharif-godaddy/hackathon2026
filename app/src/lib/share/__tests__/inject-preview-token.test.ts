/**
 * Tests for the freshness-rotation logic in inject-preview-token.ts.
 *
 * The route-level integration tests (app/src/app/api/sites/__tests__/route.injection.test.ts)
 * already cover the surface contract (token gets injected, fail-open behavior,
 * Promise.all parallelism). This file focuses on the rotation behavior itself:
 * when does the helper reuse vs rotate, and how does it interact with the
 * `replaceActive` opt-in flag handled in `agents/src/server/routes/share.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAgentFetch, mockLogger } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

import {
  __clearRotationFailureCooldownForTesting,
  __clearTokenCacheForTesting,
  injectShareTokenIntoPreviewUrl,
} from '../inject-preview-token';

const APP_ID = 'app-rotate';
const AGENT_URL = 'https://app-rotate.agent.c4.test-airoapp.ai';
const PREVIEW_URL = 'https://app-rotate.preview.c4.test-airoapp.ai';
const SHARE_ENDPOINT = `${AGENT_URL}/apps/${APP_ID}/share`;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000;

function isoMsAgo(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

describe('injectShareTokenIntoPreviewUrl — freshness and rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearTokenCacheForTesting();
    // Module-level failure-cooldown Map persists across tests; reset so
    // a cooldown set in one test can't suppress rotation in another.
    __clearRotationFailureCooldownForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('reuse when token is fresh', () => {
    it('reuses an existing token when its createdAt is within the freshness window', async () => {
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'fresh-tok',
              expiresAt: Date.now() + SEVEN_DAYS_MS,
              createdAt: isoMsAgo(TWENTY_THREE_HOURS_MS),
            },
          ],
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=fresh-tok`);
      // No POST — only the list GET fired.
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
      expect(mockAgentFetch).toHaveBeenCalledWith(SHARE_ENDPOINT, { siteId: APP_ID });
    });

    it('reuses when createdAt is missing (backward compat with pre-rotation agents)', async () => {
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            { token: 'no-createdat-tok', expiresAt: Date.now() + SEVEN_DAYS_MS },
          ],
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=no-createdat-tok`);
      // No POST. Without createdAt we don't know the age — default is "treat
      // as fresh," matching pre-rotation behavior.
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
    });

    it('picks the freshest token when multiple active tokens exist', async () => {
      // After a rotation event there are two simultaneously-active tokens.
      // The newer one (longer remaining validity) is the right pick for
      // anyone embedding the URL right now.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            // Older token — still active for 6 more days.
            {
              token: 'older-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(24 * 60 * 60 * 1000),
            },
            // Newer token — full 7-day window remaining.
            {
              token: 'newer-tok',
              expiresAt: Date.now() + SEVEN_DAYS_MS,
              createdAt: isoMsAgo(1000), // 1s ago
            },
          ],
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=newer-tok`);
      expect(mockAgentFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('rotation when token is stale', () => {
    it('mints a new token via replaceActive=true when existing token is past the freshness window', async () => {
      // GET returns a 25h-old token — beyond the 24h window.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
            },
          ],
        }),
      });
      // POST with replaceActive=true returns the rotated token.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'rotated-tok',
          expiresAt: Date.now() + SEVEN_DAYS_MS,
          createdAt: new Date().toISOString(),
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=rotated-tok`);
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);
      // Verify the POST sent replaceActive: true (the SSRF-safe rotation request).
      const [, postOpts] = mockAgentFetch.mock.calls[1];
      const body = JSON.parse(postOpts.body);
      expect(body.replaceActive).toBe(true);
      expect(body.expiresIn).toBe(7 * 24 * 60 * 60);
      // Observability: rotation begin log fires.
      expect(mockLogger.info).toHaveBeenCalledWith(
        'share.previewUrl.rotation.begin',
        expect.objectContaining({ appId: APP_ID }),
      );
    });

    it('falls back to the stale token when rotation fails (agents 500)', async () => {
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
            },
          ],
        }),
      });
      // Rotation POST fails.
      mockAgentFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      // Stale token is still valid (until its natural expiresAt) — falling
      // back to it is strictly better than emitting a bare URL.
      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=stale-tok`);
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);
    });

    it('suppresses the rotation POST within the failure-cooldown window after a recent failure', async () => {
      // Operational scenario: persistent agents 500s. Without the
      // failure cooldown, every BFF call within the cache window
      // (5 min) would re-attempt rotation because the cached token's
      // stale createdAt makes shouldRotate return true. That turns
      // every popover/iframe load into a wasted GET+POST round-trip.
      //
      // With the cooldown, the second call within 60s still does the
      // GET (cheap), but skips the POST and reuses the existing stale
      // token. POST suppression is the load-shedding behavior we want.
      const staleList = {
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
            },
          ],
        }),
      };
      // First call: GET + failing rotation POST → marks failure cooldown.
      mockAgentFetch
        .mockResolvedValueOnce(staleList)
        .mockResolvedValueOnce({ ok: false, status: 500 });
      await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);

      // Second call (within 5-min cache TTL, within failure cooldown):
      // cache is bypassed (stale createdAt), so a fresh GET fires —
      // but the failure cooldown then short-circuits before the POST.
      // Provide a single GET response; no POST should be queued.
      mockAgentFetch.mockClear();
      mockAgentFetch.mockResolvedValueOnce(staleList);

      const result2 = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);
      // The important assertion: no POST fires (rotation is suppressed).
      // Only the GET hit agents.
      const postCalls = mockAgentFetch.mock.calls.filter(
        ([, opts]) => opts?.method === 'POST',
      );
      expect(postCalls).toHaveLength(0);
      expect(mockAgentFetch).toHaveBeenCalledTimes(1); // GET only
      expect(result2).toBe(`${PREVIEW_URL}/?airoShareToken=stale-tok`);
    });

    it('clears the failure cooldown after a successful rotation', async () => {
      const staleList = {
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
            },
          ],
        }),
      };

      // First call: rotation fails — marks the failure cooldown.
      mockAgentFetch
        .mockResolvedValueOnce(staleList)
        .mockResolvedValueOnce({ ok: false, status: 500 });
      await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      // Clear caches + failure cooldown to simulate time advancing past
      // the 60s window. After cooldown elapses, the next call should
      // re-attempt rotation, succeed, and clear the marker so future
      // calls don't have to think about it anymore.
      __clearTokenCacheForTesting();
      __clearRotationFailureCooldownForTesting();
      mockAgentFetch.mockClear();
      mockAgentFetch
        .mockResolvedValueOnce(staleList)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            token: 'fresh-tok',
            expiresAt: Date.now() + SEVEN_DAYS_MS,
            createdAt: new Date().toISOString(),
          }),
        });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);
      // Rotation succeeded — fresh token used.
      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=fresh-tok`);
      // Pin: the in-flight call exercised the rotation path again.
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);
    });

    it('recovers gracefully when agents 409s on replaceActive=true (version skew before agents rotation flag is live)', async () => {
      // Older agents doesn't recognize replaceActive — still 409s. Our retry
      // path re-GETs and lands on the existing stale token. End result: same
      // as pre-rotation behavior. No regression.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
            },
          ],
        }),
      });
      // POST 409 — older agents ignored replaceActive flag.
      mockAgentFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
      });
      // Retry GET finds the same stale token.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
            },
          ],
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=stale-tok`);
      expect(mockAgentFetch).toHaveBeenCalledTimes(3);
      // Logs the 409 with replaceActive: true so an operator can grep for
      // version-skew incidents.
      expect(mockLogger.info).toHaveBeenCalledWith(
        'share.previewUrl.mint.alreadyActive',
        expect.objectContaining({ appId: APP_ID, replaceActive: true }),
      );
    });

    it('logs recoveryFailed with retryStatus + replaceActive when 409 retry GET itself fails', async () => {
      // Worst-case version-skew: POST 409s AND the retry GET hits a transient
      // outage (503). Operator-facing failure log must include retryStatus
      // for diagnostics and replaceActive to distinguish rotation failures
      // from initial-mint failures during the agents rotation-flag rollout
      // window.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({ ok: false, status: 409 });
      mockAgentFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      // Fall back to the existing stale token rather than emitting a bare URL.
      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=stale-tok`);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.previewUrl.mint.recoveryFailed',
        expect.objectContaining({
          appId: APP_ID,
          replaceActive: true,
          retryStatus: 503,
        }),
      );
    });

    it('logs retryTokenGone (not recoveryFailed) when 409 retry succeeds but returns no active token', async () => {
      // Race-corner: another caller mints (causing our 409), then deletes
      // the token between our POST and our retry GET. Retry returns 200
      // with an empty active list. Distinct from "retry GET failed" — needs
      // its own log so an operator searching for "token-gone races" can
      // grep retryTokenGone instead of guessing what `recoveryFailed` with
      // retryStatus: 200 means (which would look contradictory).
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'stale-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({ ok: false, status: 409 });
      // Retry: 200 with no active tokens (concurrent caller's was deleted).
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tokens: [] }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      // Fallback to the existing stale token from the original list call.
      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=stale-tok`);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.previewUrl.mint.retryTokenGone',
        expect.objectContaining({ appId: APP_ID, replaceActive: true }),
      );
      // Critically: the contradictory `recoveryFailed` with retryStatus 200
      // is NOT emitted. retryTokenGone owns this case exclusively.
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'share.previewUrl.mint.recoveryFailed',
        expect.anything(),
      );
    });

    it('triggers rotation at exactly the 24h boundary (shouldRotate uses >=)', async () => {
      // Off-by-one pin: `>=` means rotation fires AT the freshness window
      // boundary, not after. A future change to `>` would defer rotation
      // by an extra polling cycle; this test catches that.
      const exactly24h = 24 * 60 * 60 * 1000;
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'boundary-tok',
              expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
              createdAt: isoMsAgo(exactly24h),
            },
          ],
        }),
      });
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'rotated-at-boundary',
          expiresAt: Date.now() + SEVEN_DAYS_MS,
          createdAt: new Date().toISOString(),
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=rotated-at-boundary`);
      const [, postOpts] = mockAgentFetch.mock.calls[1];
      expect(JSON.parse(postOpts.body).replaceActive).toBe(true);
    });

    it('does not trigger rotation when createdAt is missing (no age signal)', async () => {
      // Older agents binaries (before the rotation flag landed) didn't
      // emit createdAt: helper has no way to detect age, so it must
      // reuse the token as-is. Conservative default.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            { token: 'old-but-unknown-age', expiresAt: Date.now() + SEVEN_DAYS_MS },
          ],
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=old-but-unknown-age`);
      expect(mockAgentFetch).toHaveBeenCalledTimes(1); // GET only, no POST
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'share.previewUrl.rotation.begin',
        expect.anything(),
      );
    });
  });

  describe('initial mint (no existing token)', () => {
    it('POSTs without replaceActive when GET returns no active tokens', async () => {
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tokens: [] }),
      });
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'first-tok',
          expiresAt: Date.now() + SEVEN_DAYS_MS,
          createdAt: new Date().toISOString(),
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=first-tok`);
      const [, postOpts] = mockAgentFetch.mock.calls[1];
      const body = JSON.parse(postOpts.body);
      // First mint: replaceActive must be false. The 409-on-race recovery
      // still applies for the initial race window with a concurrent caller.
      expect(body.replaceActive).toBe(false);
    });

    it('skips POST entirely when GET returns no expired tokens but null tokens field', async () => {
      // Defensive: a malformed response with missing `tokens` field is
      // treated as "no active token" → fresh mint path. Important because
      // GET filtering uses `data.tokens ?? []` internally.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          token: 'first-tok',
          expiresAt: Date.now() + SEVEN_DAYS_MS,
          createdAt: new Date().toISOString(),
        }),
      });

      const result = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);

      expect(result).toBe(`${PREVIEW_URL}/?airoShareToken=first-tok`);
    });
  });

  describe('cache freshness gate', () => {
    it('serves a freshly-minted token from cache on the second call (no extra GET)', async () => {
      // Standard happy path: first call mints, second call hits cache.
      // Cache entry is fresh on both criteria (just minted, well within
      // 5-min TTL, createdAt is "now").
      mockAgentFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ tokens: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            token: 'fresh-mint',
            expiresAt: Date.now() + SEVEN_DAYS_MS,
            createdAt: new Date().toISOString(),
          }),
        });

      const first = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);
      expect(first).toBe(`${PREVIEW_URL}/?airoShareToken=fresh-mint`);
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);

      // Cache hit — no extra agent calls.
      mockAgentFetch.mockClear();
      const second = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);
      expect(second).toBe(`${PREVIEW_URL}/?airoShareToken=fresh-mint`);
      expect(mockAgentFetch).not.toHaveBeenCalled();
    });

    it('cache bypasses a stale token even when the cache TTL has not expired', async () => {
      // First call sees a stale token, tries to rotate, but rotation fails
      // (e.g., agents 500). Falls back to the stale token and caches it.
      mockAgentFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            tokens: [
              {
                token: 'cached-stale',
                expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
                createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
              },
            ],
          }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      const first = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);
      // Stale token returned as fallback when rotation failed.
      expect(first).toBe(`${PREVIEW_URL}/?airoShareToken=cached-stale`);

      // Second call (within 5-min cache TTL): the cache freshness gate
      // must NOT serve the stale token. It re-fetches and re-attempts
      // rotation. This is the key invariant — cache TTL alone is not
      // enough to suppress rotation; the freshness window also gates the
      // cache.
      //
      // Clear the failure cooldown to simulate the 60s window elapsing
      // since the first call's rotation failure. Without this, the
      // cooldown would suppress the rotation re-attempt on the second
      // call — which is correct behavior for the cooldown's purpose
      // (covered by its own tests above) but orthogonal to the cache
      // freshness gate this test pins.
      __clearRotationFailureCooldownForTesting();
      mockAgentFetch.mockClear();
      mockAgentFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            tokens: [
              {
                token: 'cached-stale',
                expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
                createdAt: isoMsAgo(TWENTY_FIVE_HOURS_MS),
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            token: 'rotation-succeeds-now',
            expiresAt: Date.now() + SEVEN_DAYS_MS,
            createdAt: new Date().toISOString(),
          }),
        });

      const second = await injectShareTokenIntoPreviewUrl(APP_ID, AGENT_URL, PREVIEW_URL);
      // Cache was bypassed, rotation re-attempted, succeeded this time.
      expect(second).toBe(`${PREVIEW_URL}/?airoShareToken=rotation-succeeds-now`);
      expect(mockAgentFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('URL query-param handling', () => {
    it('preserves pre-existing query params on the preview URL', async () => {
      // `appendTokenToUrl` uses `new URL().searchParams.set()` — anything
      // already on the URL must survive. If we ever switched to a naive
      // string concat, this test would catch the regression.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'tok',
              expiresAt: Date.now() + SEVEN_DAYS_MS,
              createdAt: isoMsAgo(1000),
            },
          ],
        }),
      });

      const previewWithExisting = `${PREVIEW_URL}/?foo=bar&utm_source=email`;
      const result = await injectShareTokenIntoPreviewUrl(
        APP_ID,
        AGENT_URL,
        previewWithExisting,
      );

      // Both pre-existing params survive AND the token was added.
      const parsed = new URL(result);
      expect(parsed.searchParams.get('foo')).toBe('bar');
      expect(parsed.searchParams.get('utm_source')).toBe('email');
      expect(parsed.searchParams.get('airoShareToken')).toBe('tok');
    });

    it('overwrites a pre-existing airoShareToken rather than appending a duplicate', async () => {
      // BFF callers up the stack may have injected a stale token already
      // (e.g., /api/sites' own injection ran first). `searchParams.set`
      // overwrites the key cleanly — no `?airoShareToken=stale&airoShareToken=fresh`
      // pair that would make dev-supervisor's URL-param extraction ambiguous.
      mockAgentFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tokens: [
            {
              token: 'fresh-tok',
              expiresAt: Date.now() + SEVEN_DAYS_MS,
              createdAt: isoMsAgo(1000),
            },
          ],
        }),
      });

      const previewWithStaleToken = `${PREVIEW_URL}/?airoShareToken=stale-tok`;
      const result = await injectShareTokenIntoPreviewUrl(
        APP_ID,
        AGENT_URL,
        previewWithStaleToken,
      );

      // Only ONE airoShareToken value in the final URL, and it's the fresh one.
      const parsed = new URL(result);
      expect(parsed.searchParams.getAll('airoShareToken')).toEqual(['fresh-tok']);
    });
  });
});
