/**
 * Rotation helpers consumed by the GET `/api/apps/[id]/share` route
 * handler in `./route.ts`.
 *
 * These live in a sibling module rather than directly in `route.ts`
 * because Next.js route files have a fixed export allowlist (`GET`,
 * `POST`, `dynamic`, etc.). Exporting helpers / types from a route
 * file fails the Next.js type-check at build:
 *
 *   Route ".../route.ts" does not match the required types of a
 *   Next.js Route. "<symbol>" is not a valid Route export field.
 *
 * Co-located here so the discovery path is obvious and the helpers can
 * be unit-tested directly without going through the route wiring.
 */
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';
import { isStaleByFreshness } from '@/lib/share/freshness';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/**
 * Shape of a single token entry in the agents GET response.
 *
 * `createdAt`/`expiresAt`/`firstUsedAt` are intentionally `unknown` because
 * the agents response is over the wire — the BFF must defensively narrow
 * before reading. The narrowing happens inside `scanForRotation` and
 * `rotateShareTokenForList`.
 */
export interface AgentsTokenEntry {
  token?: unknown;
  expiresAt?: unknown;
  createdAt?: unknown;
  firstUsedAt?: unknown;
  shareUrl?: unknown;
}

/**
 * Outcome of the freshness scan. Distinguishes "stale active token found,
 * rotation owed" from "all-active-tokens-have-unparseable-createdAt"
 * (older agents binaries, schema drift) — the latter case is operationally
 * interesting because it silently disables rotation fleet-wide. Caller
 * uses `noParseableCreatedAt` to emit a warn log for that scenario.
 *
 * `activeTokenCount` is carried in the `noParseableCreatedAt` variant so
 * the caller's warn log doesn't have to re-traverse the input.
 */
export type FreshnessScanResult =
  | { kind: 'stale'; freshestAgeMs: number }
  | { kind: 'fresh' }
  | { kind: 'noActiveTokens' }
  | { kind: 'noParseableCreatedAt'; activeTokenCount: number };

/**
 * Inspect the token list and decide if rotation is owed. Defensive narrowing
 * on each entry — a malformed agents response (missing createdAt, non-string
 * types, NaN-producing date strings) is treated as "no usable age signal"
 * rather than thrown, so the GET response always succeeds.
 *
 * Distinguishes `noActiveTokens` (empty list — initial-mint case, handled
 * by the UI) from `noParseableCreatedAt` (active tokens exist but all have
 * malformed createdAt — silent rotation-disable, warrants a warn log).
 *
 * Pure function — direct unit tests live in `__tests__/scanForRotation.test.ts`
 * pinning the discriminated-union contract independent of route wiring.
 */
export function scanForRotation(
  tokens: AgentsTokenEntry[],
  now: number,
): FreshnessScanResult {
  let freshestCreatedAtMs: number | undefined;
  let activeTokenCount = 0;
  for (const t of tokens) {
    if (typeof t.expiresAt !== 'number' || t.expiresAt <= now) continue;
    activeTokenCount++;
    if (typeof t.createdAt !== 'string') continue;
    const createdAtMs = new Date(t.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) continue;
    if (freshestCreatedAtMs === undefined || createdAtMs > freshestCreatedAtMs) {
      freshestCreatedAtMs = createdAtMs;
    }
  }
  if (activeTokenCount === 0) return { kind: 'noActiveTokens' };
  if (freshestCreatedAtMs === undefined) {
    return { kind: 'noParseableCreatedAt', activeTokenCount };
  }
  if (isStaleByFreshness(freshestCreatedAtMs, now)) {
    return { kind: 'stale', freshestAgeMs: now - freshestCreatedAtMs };
  }
  return { kind: 'fresh' };
}

/**
 * Mint a fresh share-link via agents with `replaceActive: true` so it lands
 * alongside any existing active token. Fails open: errors are logged and
 * undefined is returned, leaving the caller to fall back to the existing
 * (stale) list — the GET response still succeeds.
 *
 * `replaceActive: true` is the opt-in flag handled in
 * `agents/src/server/routes/share.ts`. Older agents binaries that don't
 * recognize it will 409; that's acceptable here because the caller falls
 * back to the existing list silently.
 *
 * Return type narrows `token` to `string` on the success path — the
 * function already does the `typeof === 'string'` check internally
 * before returning, so the caller can use `result.token` without a
 * cast or repeated narrowing.
 */
export type RotatedToken = AgentsTokenEntry & { token: string };
export async function rotateShareTokenForList(
  appId: string,
  url: string,
): Promise<RotatedToken | undefined> {
  try {
    const rotateRes = await agentFetch(url, {
      siteId: appId,
      method: 'POST',
      body: JSON.stringify({
        expiresIn: SEVEN_DAYS_SECONDS,
        replaceActive: true,
      }),
    });
    if (!rotateRes.ok) {
      logger.warn('share.api.list.rotation.failed', {
        appId,
        status: rotateRes.status,
      });
      return undefined;
    }
    // Parse with try/catch so a 2xx + non-JSON envelope (proxy timeout HTML
    // wrapping a 201, truncated response) is logged with the same shape as
    // the missingToken/failure paths instead of throwing into the outer
    // catch with a generic error string.
    let created: AgentsTokenEntry;
    try {
      created = (await rotateRes.json()) as AgentsTokenEntry;
    } catch (parseErr) {
      logger.warn('share.api.list.rotation.parseError', {
        appId,
        status: rotateRes.status,
        error: parseErr instanceof Error ? parseErr.message : 'Unknown parse error',
      });
      return undefined;
    }
    if (typeof created.token !== 'string' || created.token.length === 0) {
      // Include status + the keys actually present so a renamed-success-shape
      // future regression is debuggable from Loki without a code dive.
      logger.warn('share.api.list.rotation.missingToken', {
        appId,
        status: rotateRes.status,
        responseKeys: Object.keys(created),
      });
      return undefined;
    }
    // Narrowed: at this point `created.token` is a non-empty string, so
    // the return type can promise `RotatedToken` (with `token: string`).
    return created as RotatedToken;
  } catch (err) {
    // Network-layer errors (DNS, ECONNRESET, agentFetch timeouts) land
    // here, not in the `!ok` branch above. Keep a distinct event name so
    // operators can split "agents rejected" from "couldn't reach agents."
    logger.warn('share.api.list.rotation.error', {
      appId,
      error: err instanceof Error ? err.message : 'Unknown rotation error',
    });
    return undefined;
  }
}

// Per-process cooldown between rotation attempts for the same app. Without
// this, a tab-storm (user opens N tabs simultaneously, React Strict Mode
// double-renders, concurrent users on the same app, etc.) all hit the
// stale-token check before any of them have minted, and each fires its
// own `replaceActive: true` POST. Result: 1 stale token → N new tokens
// in one burst, growing the `share_tokens` DB row count proportionally.
//
// 60s is short enough to feel "fresh" (next legitimate stale check still
// fires) but long enough to collapse same-event bursts from the UI layer
// (Strict Mode double-fire, multiple useShareTokens callers on one page,
// quick navigation in/out of ShareLink).
//
// Limitations: per-process only. With multiple Katana BFF workers, each
// worker has its own Map — N workers can still race to N mints. The
// inject-preview-token.ts path has its own 5-min token cache that covers
// the same concern from a different angle; together they bound the
// proliferation rate to ~(workers + 1) mints per real stale event.
export const ROTATION_COOLDOWN_MS = 60 * 1000;
const recentRotationAttempts = new Map<string, number>();

/**
 * Returns true if no rotation attempt has been recorded for this appId
 * within the cooldown window, and records the attempt. Returns false if
 * another caller in this process already attempted recently — caller
 * should skip the rotation and serve the existing list.
 *
 * The mark fires whether or not the rotation actually succeeds. A failed
 * mint shouldn't unblock another immediate retry; the 60s gives transient
 * agents flakiness room to recover without a rotation storm.
 */
export function shouldAttemptRotation(appId: string, now: number): boolean {
  const last = recentRotationAttempts.get(appId);
  if (last !== undefined && now - last < ROTATION_COOLDOWN_MS) return false;
  recentRotationAttempts.set(appId, now);
  return true;
}

/**
 * Test-only hook so unit tests can reset the per-process cooldown state
 * between cases. Not called from production code.
 */
export function __clearRotationCooldownForTesting(): void {
  recentRotationAttempts.clear();
}
