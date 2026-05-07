import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

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

type ActiveToken = { token: string; expiresAt: number };
type CachedEntry = ActiveToken & { cachedAt: number };

const tokenCache = new Map<string, CachedEntry>();

/**
 * Test-only hook to drop the module-level cache between cases. Production
 * code does not call this. Marked __ to keep it out of normal autocomplete.
 */
export function __clearTokenCacheForTesting(): void {
  tokenCache.clear();
}

/**
 * Given a 2xx GET /apps/:id/share response, parse it and return the first
 * token whose `expiresAt > Date.now()` — matching agents' own definition
 * of "active." Logs parse failures so an HTML/proxy-envelope body can't
 * silently degrade us to "no active token" with no audit trail.
 *
 * No expiry buffer: agents enforces "one active token per app" with the
 * same `expiresAt > now` cutoff, so any token we filter out here is one
 * that agents would still 409 on if we tried to mint a replacement —
 * burning a round trip for the same final answer.
 */
async function pickActiveToken(
  appId: string,
  res: Response,
  parseErrorEvent: 'share.previewUrl.list.parseError' | 'share.previewUrl.mint.retryParseError',
): Promise<ActiveToken | undefined> {
  try {
    const data = (await res.json()) as {
      tokens?: Array<{ token: string; expiresAt: number }>;
    };
    const now = Date.now();
    const active = data.tokens?.find((t) => t.expiresAt > now);
    return active ? { token: active.token, expiresAt: active.expiresAt } : undefined;
  } catch (parseErr) {
    logger.warn(parseErrorEvent, {
      appId,
      error: parseErr instanceof Error ? parseErr.message : 'Unknown parse error',
    });
    return undefined;
  }
}

async function getOrMintActiveToken(
  appId: string,
  shareEndpoint: string,
): Promise<ActiveToken | undefined> {
  const listRes = await agentFetch(shareEndpoint, { siteId: appId });
  if (listRes.ok) {
    const fromList = await pickActiveToken(appId, listRes, 'share.previewUrl.list.parseError');
    if (fromList) return fromList;
  } else {
    logger.warn('share.previewUrl.list.failure', {
      appId,
      status: listRes.status,
    });
  }

  const createRes = await agentFetch(shareEndpoint, {
    siteId: appId,
    method: 'POST',
    body: JSON.stringify({ expiresIn: SEVEN_DAYS_SECONDS }),
  });
  if (createRes.ok) {
    try {
      const created = (await createRes.json()) as { token?: string; expiresAt?: number };
      if (created.token && typeof created.expiresAt === 'number') {
        return { token: created.token, expiresAt: created.expiresAt };
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
  // body has NO token (see agents/src/server/routes/share.ts:229 — the
  // body is `{ error: '...' }`). Re-GET so parallel mints converge
  // instead of falling open to bare URL.
  if (createRes.status === 409) {
    logger.info('share.previewUrl.mint.alreadyActive', { appId });
    const retryRes = await agentFetch(shareEndpoint, { siteId: appId });
    if (retryRes.ok) {
      const fromRetry = await pickActiveToken(
        appId,
        retryRes,
        'share.previewUrl.mint.retryParseError',
      );
      if (fromRetry) return fromRetry;
    }
    // retryStatus distinguishes a 500/403/network failure on the retry
    // from a successful retry returning an empty list (the latter means
    // the concurrent caller's token was deleted between our POST 409 and
    // the re-GET — rare but distinct).
    logger.warn('share.previewUrl.mint.recoveryFailed', {
      appId,
      retryStatus: retryRes.status,
    });
    return undefined;
  }

  logger.warn('share.previewUrl.mint.failure', {
    appId,
    status: createRes.status,
  });
  return undefined;
}

function appendTokenToUrl(previewUrl: string, token: string): string {
  // Use URL() so any pre-existing query params on previewUrl survive.
  const url = new URL(previewUrl);
  url.searchParams.set('airoShareToken', token);
  return url.toString();
}

/**
 * Append `?airoShareToken=<token>` to the preview URL so cross-browser
 * "Visit Preview" works even when third-party-cookie blocking refuses to
 * store the unpartitioned `preview_auth` cookie set during the iframe
 * bootstrap (Safari ITP, Firefox TCP, Chrome 3PCD opt-in, all incognito).
 *
 * The share-token query-param flow sets a first-party cookie on the preview
 * origin during top-level navigation, which every browser accepts.
 *
 * Token resolution order (against `/apps/<id>/share`):
 *   0. Process-local cache (5-min TTL, expiry-checked) — short-circuits
 *      the agents call entirely on warm hits.
 *   1. GET — return the first active (`expiresAt > now`) token if any.
 *   2. POST — mint a 7-day token if the GET returned nothing usable.
 *   3. On POST 409 (active link already exists between our GET and POST,
 *      body has no token) — re-GET to pick up the concurrent caller's
 *      token so parallel mints converge cleanly.
 *
 * The caller is responsible for checking the `appbuilder-share-links`
 * Switchboard flag and `agentUrl`/`previewUrl` presence before calling
 * this — keeping the helper pure (no Request / flag dependency) lets
 * list-style callers hoist the flag check above the per-site loop.
 *
 * Fails open: any error returns the bare URL. Visit Preview falls back to
 * today's preview_auth-cookie behavior, which works in Chrome (default 3PC)
 * and breaks elsewhere — same as before this fix.
 */
export async function injectShareTokenIntoPreviewUrl(
  appId: string,
  agentUrl: string,
  previewUrl: string,
): Promise<string> {
  try {
    const now = Date.now();
    const cached = tokenCache.get(appId);
    // Belt-and-suspenders: TTL keeps the entry fresh, expiresAt guards
    // against a token that's about to lapse inside the cache window.
    if (cached && now - cached.cachedAt < CACHE_TTL_MS && cached.expiresAt > now) {
      return appendTokenToUrl(previewUrl, cached.token);
    }
    if (cached) tokenCache.delete(appId);

    const shareEndpoint = `${agentUrl}/apps/${appId}/share`;
    const result = await getOrMintActiveToken(appId, shareEndpoint);
    if (!result) return previewUrl;

    tokenCache.set(appId, { ...result, cachedAt: now });
    return appendTokenToUrl(previewUrl, result.token);
  } catch (err) {
    logger.warn('share.previewUrl.inject.error', {
      appId,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    return previewUrl;
  }
}
