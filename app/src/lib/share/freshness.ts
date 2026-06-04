/**
 * Shared freshness predicate for share-token rotation. Used by both BFF
 * rotation surfaces:
 *
 *   - `app/src/lib/share/inject-preview-token.ts` (iframe / Visit Preview /
 *     Slack feedback Preview button — the URL-injection helper)
 *   - `app/src/app/api/apps/[id]/share/route.ts` GET handler (ShareLink
 *     popover — the share-list endpoint that backs `useShareTokens`)
 *
 * Centralizing the constant + predicate prevents the two surfaces from
 * drifting — an earlier iteration of this work had a `>` vs `>=`
 * discrepancy between the two routes that would have caused
 * sub-millisecond boundary disagreement. Any future change to the
 * freshness window applies uniformly.
 */

/**
 * Tokens older than this trigger rotation. Aligned across every BFF
 * surface that emits share-token-bearing URLs so the recipient always
 * gets ≥6 days of remaining validity for the standard 7-day TTL.
 *
 * Trade-off: smaller windows rotate more often (faster DB growth, more
 * agents load), larger windows hand out near-expiry tokens to recipients.
 * 24h is a defensible middle ground for daily share-link refresh.
 */
export const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a token with the given `createdAtMs` (UTC ms since epoch) is past
 * the freshness window and should be rotated. Uses `>=` so rotation fires
 * AT the boundary, not after — matches the intent "tokens older than 24h
 * get refreshed" rather than "tokens older than 24h + 1 millisecond."
 *
 * Returns `false` when `createdAtMs` is undefined, indicating the caller
 * has no age signal (older agents binary, malformed response). Refusing
 * to rotate in that case is the conservative default: rotation has cost
 * (DB row, JWT mint, agents POST) and "unknown age" is not a reason to
 * incur it.
 */
export function isStaleByFreshness(
  createdAtMs: number | undefined,
  now: number,
): boolean {
  if (createdAtMs === undefined) return false;
  return now - createdAtMs >= FRESHNESS_WINDOW_MS;
}
