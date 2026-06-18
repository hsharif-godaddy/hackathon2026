import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';
import { isStaleByFreshness } from './freshness';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

// Process-local token cache, keyed by appId. Without this, a single
// /api/sites list call for a dashboard with N apps fans out to N
// parallel agentFetch calls — each of which mints an S2S JWT inside
// agent-fetch (`getAgentToken(siteId)`) and then issues the share-list
// HTTP request. For polling-heavy UI surfaces (SitePollingService
// re-fetches /api/sites/[id] every ~10s) that's continuous load on
// agents and the JWT service for no useful change in token state.
//
// 5-minute TTL caps staleness to a single polling window's worth.
// Bounded short staleness is acceptable: even if agents has somehow
// dropped the token mid-window, the worst case is dev-supervisor
// rejecting it and the recipient seeing a bounce — same UX as a token
// expiring mid-session, which already happens for any token that runs
// out near the user's click. The TTL also caps RAM growth in the
// pathological case of millions of one-off appIds touching this code.
const CACHE_TTL_MS = 5 * 60 * 1000;

// Rotation-failure cooldown. When `mintToken(replaceActive=true)` fails
// (agents partial outage, network blip, etc.) we fall back to the stale
// existing token. Without a cooldown, the next call within the cache
// TTL would still see `shouldRotate(cached) === true` (the cache holds
// the stale token by createdAt), evict the cache, and re-attempt
// rotation. Every subsequent call repeats this until rotation succeeds
// or the cache TTL becomes moot — which is a load amplifier on an
// already-degraded agents.
//
// 60s mirrors the route-level rotation cooldown in `rotation-helpers.ts`
// — same intent (collapse a burst into a single attempt), same shape.
// After 60s we re-attempt; on success the cache stores the fresh token
// and the cooldown becomes irrelevant.
const ROTATION_FAILURE_COOLDOWN_MS = 60 * 1000;
const recentRotationFailures = new Map<string, number>();

function recentlyFailedRotation(appId: string, now: number): boolean {
  const last = recentRotationFailures.get(appId);
  return last !== undefined && now - last < ROTATION_FAILURE_COOLDOWN_MS;
}

/**
 * Test-only hook so unit tests can reset the failure-cooldown state
 * between cases. Not called from production code.
 */
export function __clearRotationFailureCooldownForTesting(): void {
  recentRotationFailures.clear();
}

// FRESHNESS_WINDOW_MS lives in ./freshness so both this helper and the
// /api/apps/[id]/share GET handler agree on the boundary. A previous
// drift between `>` and `>=` operators across the two surfaces motivated
// extracting them into a shared predicate — the shared module prevents
// reintroducing that boundary disagreement.
//
// Rotation is opt-in on the agents side via `replaceActive: true`. The
// previous token continues to live with its original `expiresAt` — any
// URL that was already copied keeps working until its natural 7-day
// window elapses. We deliberately do NOT delete the old token to avoid
// breaking in-flight links.

// `createdAt` is intentionally optional. Agents returns it as an ISO
// string in both GET list responses (share.ts:291) and POST create
// responses (share.ts:251), but:
//   (a) Older agents allocations from before the rotation flag landed
//       may not emit it on every code path — defensive parsing keeps
//       the helper backward compat.
//   (b) Test mocks across the repo (route.injection.test.ts, etc.) build
//       token fixtures without `createdAt` — we don't want to require an
//       update to every existing call site to land this change.
// When absent, `shouldRotate` returns false: the token is treated as
// fresh-enough and we fall through to reuse it. That matches the
// pre-freshness behavior — no rotation, no breakage.
type ActiveToken = { token: string; expiresAt: number; createdAt?: number };
type CachedEntry = ActiveToken & { cachedAt: number };

const tokenCache = new Map<string, CachedEntry>();

/**
 * Test-only hook to drop the module-level cache between cases. Production
 * code does not call this. Marked __ to keep it out of normal autocomplete.
 */
export function __clearTokenCacheForTesting(): void {
  tokenCache.clear();
}

function parseCreatedAt(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Returns true when the token has aged past the freshness window and we
 * should rotate it via `replaceActive: true`. Thin wrapper over the
 * shared `isStaleByFreshness` predicate; kept as a local function so call
 * sites read naturally ("if shouldRotate this token, rotate it").
 */
function shouldRotate(token: ActiveToken, now: number): boolean {
  return isStaleByFreshness(token.createdAt, now);
}

/**
 * Given a 2xx GET /apps/:id/share response, parse it and return the
 * freshest active (`expiresAt > Date.now()`) token. "Freshest" means the
 * one with the most recent `createdAt`, which is the right choice after
 * a rotation event when multiple tokens are simultaneously active —
 * embedding the newest token gives the recipient the longest remaining
 * validity window.
 *
 * Logs parse failures so an HTML/proxy-envelope body can't silently
 * degrade us to "no active token" with no audit trail.
 */
async function pickFreshestActiveToken(
  appId: string,
  res: Response,
  parseErrorEvent: 'share.previewUrl.list.parseError' | 'share.previewUrl.mint.retryParseError',
): Promise<ActiveToken | undefined> {
  try {
    const data = (await res.json()) as {
      tokens?: Array<{ token: string; expiresAt: number; createdAt?: string }>;
    };
    const now = Date.now();
    const active = (data.tokens ?? []).filter((t) => t.expiresAt > now);
    if (active.length === 0) return undefined;
    // Among active tokens, pick the most recently created. Tokens with
    // missing `createdAt` sort to the bottom (treated as oldest) so a
    // fresh token with known timestamp always wins. If ALL tokens lack
    // `createdAt` (older agents response shape), order is preserved and
    // the first one wins — matches the legacy "first active" behavior.
    const freshest = active.reduce((best, t) => {
      const bestMs = parseCreatedAt(best.createdAt) ?? -Infinity;
      const tMs = parseCreatedAt(t.createdAt) ?? -Infinity;
      return tMs > bestMs ? t : best;
    });
    return {
      token: freshest.token,
      expiresAt: freshest.expiresAt,
      createdAt: parseCreatedAt(freshest.createdAt),
    };
  } catch (parseErr) {
    logger.warn(parseErrorEvent, {
      appId,
      error: parseErr instanceof Error ? parseErr.message : 'Unknown parse error',
    });
    return undefined;
  }
}

/**
 * POST a fresh token via agents. `replaceActive` is the opt-in rotation
 * flag handled in `agents/src/server/routes/share.ts` — when true, agents
 * bypasses the one-active-token guard and creates a new token alongside
 * any existing active one. When false, the legacy 409-on-conflict
 * behavior applies (which we recover from by re-GET'ing the active token
 * below).
 *
 * Version skew: if a BFF that sends `replaceActive: true` is deployed
 * against an older agents that doesn't recognize the flag, agents will
 * 409 and we fall through to the re-GET path — i.e., we surface the
 * existing stale token unchanged. Same UX as before this change; no
 * regression.
 */
async function mintToken(
  appId: string,
  shareEndpoint: string,
  replaceActive: boolean,
): Promise<ActiveToken | undefined> {
  const createRes = await agentFetch(shareEndpoint, {
    siteId: appId,
    method: 'POST',
    body: JSON.stringify({ expiresIn: SEVEN_DAYS_SECONDS, replaceActive }),
  });
  if (createRes.ok) {
    try {
      const created = (await createRes.json()) as {
        token?: string;
        expiresAt?: number;
        createdAt?: string;
      };
      if (created.token && typeof created.expiresAt === 'number') {
        return {
          token: created.token,
          expiresAt: created.expiresAt,
          createdAt: parseCreatedAt(created.createdAt),
        };
      }
      // 2xx with no token field — schema drift, proxy envelope wrapping,
      // or future agents change. Without this log the operator gets a
      // bare URL with zero signal: nothing to grep for.
      logger.warn('share.previewUrl.mint.missingToken', {
        appId,
        status: createRes.status,
      });
    } catch (parseErr) {
      logger.warn('share.previewUrl.mint.parseError', {
        appId,
        error: parseErr instanceof Error ? parseErr.message : 'Unknown parse error',
      });
    }
    return undefined;
  }

  // agents 409 means a concurrent caller (or a token that became active
  // between our GET and POST) already has an active link. The agents 409
  // body has NO token (see agents/src/server/routes/share.ts — the body
  // is `{ error: '...' }`). Re-GET so parallel mints converge instead of
  // falling open to bare URL.
  //
  // With `replaceActive: true` and the agents-side flag handler in
  // `agents/src/server/routes/share.ts` live, this branch should not
  // fire — that's the whole point of the flag. If it does, we're either
  // racing against another rotating caller (rare; both would have
  // minted alongside the original token without conflict anyway) OR
  // the agents deploy hasn't caught up yet. Recovery is the same.
  if (createRes.status === 409) {
    logger.info('share.previewUrl.mint.alreadyActive', { appId, replaceActive });
    const retryRes = await agentFetch(shareEndpoint, { siteId: appId });
    if (retryRes.ok) {
      const fromRetry = await pickFreshestActiveToken(
        appId,
        retryRes,
        'share.previewUrl.mint.retryParseError',
      );
      if (fromRetry) return fromRetry;
      // Retry GET succeeded but returned no active token — the concurrent
      // caller's token was deleted between our POST 409 and the re-GET.
      // Rare but distinct from "retry GET itself failed" below. Named log
      // so an operator searching for token-gone races can grep it directly
      // instead of having to interpret `recoveryFailed` with `retryStatus: 200`
      // (which looks contradictory at a glance).
      logger.warn('share.previewUrl.mint.retryTokenGone', { appId, replaceActive });
      return undefined;
    }
    // Retry GET itself failed (500/403/network). `replaceActive` is
    // included so rotation failures (replaceActive=true) and initial-mint
    // failures (replaceActive=false) are distinguishable in Loki during
    // the agents rotation-flag rollout window — otherwise both would
    // emit identical log entries.
    logger.warn('share.previewUrl.mint.recoveryFailed', {
      appId,
      replaceActive,
      retryStatus: retryRes.status,
    });
    return undefined;
  }

  logger.warn('share.previewUrl.mint.failure', {
    appId,
    replaceActive,
    status: createRes.status,
  });
  return undefined;
}

/**
 * Resolve the listing response into a freshest active token, or undefined on
 * any failure (logging the failure for observability). Extracted so the
 * caller can use a `const` binding without deferred null-then-assign — the
 * `let existing` shape was a small step down the gradient toward closures
 * over mutable bindings, which this repo's guidelines push back on.
 */
async function listExistingActiveToken(
  appId: string,
  listRes: Response,
): Promise<ActiveToken | undefined> {
  if (!listRes.ok) {
    logger.warn('share.previewUrl.list.failure', {
      appId,
      status: listRes.status,
    });
    return undefined;
  }
  return pickFreshestActiveToken(appId, listRes, 'share.previewUrl.list.parseError');
}

async function getOrMintFreshToken(
  appId: string,
  shareEndpoint: string,
): Promise<ActiveToken | undefined> {
  const listRes = await agentFetch(shareEndpoint, { siteId: appId });
  const existing = await listExistingActiveToken(appId, listRes);

  const now = Date.now();

  // No existing active token → mint a new one. `replaceActive: false` so
  // any concurrent caller that's also minting hits 409 and recovers via
  // re-GET — preserves the legacy convergence behavior for the first-mint
  // race window.
  if (!existing) {
    return mintToken(appId, shareEndpoint, false);
  }

  // Existing token is within the freshness window → reuse as-is.
  if (!shouldRotate(existing, now)) {
    return existing;
  }

  // Suppress rotation attempts for ROTATION_FAILURE_COOLDOWN_MS after a
  // failure on this appId. Without this, a persistent agents outage
  // would have every BFF call re-attempt rotation (since the cached
  // token's stale createdAt makes shouldRotate return true), burning a
  // GET+POST round-trip every request until either rotation recovers
  // or the cache TTL expires. The cooldown turns that into one attempt
  // per minute under sustained failure.
  if (recentlyFailedRotation(appId, now)) {
    logger.debug('share.previewUrl.rotation.failureCooldown', {
      appId,
      existingAgeMs: existing.createdAt !== undefined ? now - existing.createdAt : undefined,
    });
    return existing;
  }

  // Existing token is past the freshness window → rotate. The old token
  // is left alive so already-copied URLs keep working until their natural
  // expiry. New token has a full 7-day window.
  logger.info('share.previewUrl.rotation.begin', {
    appId,
    existingAgeMs: existing.createdAt !== undefined ? now - existing.createdAt : undefined,
  });
  const rotated = await mintToken(appId, shareEndpoint, true);
  if (!rotated) {
    // Rotation failure (agents down, parse error, version skew falling
    // through to 409, etc.) → mark the cooldown so the next call within
    // 60s reuses `existing` directly without re-attempting. After 60s
    // we'll try again — short enough to recover quickly when agents is
    // back, long enough to throttle the failure-load amplification.
    recentRotationFailures.set(appId, now);
    return existing;
  }
  // Successful rotation clears any prior failure marker — back to normal.
  recentRotationFailures.delete(appId);
  return rotated;
}

function appendTokenToUrl(previewUrl: string, token: string): string {
  // Use URL() so any pre-existing query params on previewUrl survive.
  const url = new URL(previewUrl);
  url.searchParams.set('airoShareToken', token);
  return url.toString();
}

/**
 * Append `?airoShareToken=<token>` to the preview URL so "Visit Preview"
 * can authenticate the top-level visit. The `preview_auth` cookie set
 * during the iframe bootstrap is partitioned (CHIPS) and keyed to the
 * builder origin, so it is never sent on a top-level navigation to the
 * preview — this query-param token is the only handoff path, in every
 * browser.
 *
 * The share-token query-param flow sets a partitioned cookie keyed to the
 * preview origin itself during top-level navigation, which every browser
 * accepts.
 *
 * Token resolution order (against `/apps/<id>/share`):
 *   0. Process-local cache — short-circuits the agents call entirely when
 *      ALL three conditions hold:
 *        (a) cache entry not expired (5-min TTL)
 *        (b) token not expired (`expiresAt > now`)
 *        (c) token still within freshness window (≤24h old, when known)
 *   1. GET — pick the freshest active token if any.
 *   2. If the freshest active token is past the freshness window → POST
 *      with `replaceActive: true` to mint a rotation. Old token stays
 *      alive for already-copied URLs.
 *   3. If no active token exists → POST without `replaceActive` (legacy
 *      mint path). 409 falls through to re-GET to converge with a
 *      concurrent first-mint.
 *
 * The caller is responsible for checking `agentUrl`/`previewUrl` presence
 * before calling this. Injection is NOT gated by the
 * `appbuilder-share-links` Switchboard flag — the token is the only auth
 * handoff for top-level preview visits, so callers inject unconditionally
 * (the flag still gates the share-links UI and BFF share CRUD routes).
 *
 * Fails open: any error returns the bare URL. Without the token the
 * top-level visit has no carried-over cookie (preview_auth is partitioned
 * to the builder origin), so the user lands on the dev-supervisor login
 * page instead of the preview.
 */
export async function injectShareTokenIntoPreviewUrl(
  appId: string,
  agentUrl: string,
  previewUrl: string,
): Promise<string> {
  try {
    const now = Date.now();
    const cached = tokenCache.get(appId);
    // Three independent guards:
    //   - TTL: cache entry not too old
    //   - expiry: token still valid against agents/dev-supervisor
    //   - freshness: token young enough that we don't owe a rotation
    // If any fails, fall through to the GET+rotate flow.
    if (
      cached &&
      now - cached.cachedAt < CACHE_TTL_MS &&
      cached.expiresAt > now &&
      !shouldRotate(cached, now)
    ) {
      return appendTokenToUrl(previewUrl, cached.token);
    }
    if (cached) tokenCache.delete(appId);

    const shareEndpoint = `${agentUrl}/apps/${appId}/share`;
    const result = await getOrMintFreshToken(appId, shareEndpoint);
    if (!result) return previewUrl;

    tokenCache.set(appId, { ...result, cachedAt: now });
    return appendTokenToUrl(previewUrl, result.token);
  } catch (err) {
    // Kept at `warn` level: an earlier iteration promoted this to `error`
    // on the theory that infrastructure failures (agentFetch throwing on
    // JWT-service / Secrets Manager unavailability, URL parse failures)
    // warrant alerting attention. A later review pushed back — promoting
    // a log level is itself a behavior change that needs coordination
    // with whoever owns the alert config, since a suddenly-firing alert
    // on an infrastructure-adjacent path could page during an unrelated
    // incident. We keep `warn` as the safe default. The `stack` field is
    // retained for triage value — it costs nothing on warn-level entries
    // and lets an operator inspect the throw site without re-reproducing.
    // If a Loki alert is later wired explicitly to this event name,
    // upgrade to `error` then.
    logger.warn('share.previewUrl.inject.error', {
      appId,
      error: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
    });
    return previewUrl;
  }
}
