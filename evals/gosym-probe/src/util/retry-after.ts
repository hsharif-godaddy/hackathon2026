const DEFAULT_MAX_WAIT_MS = 300_000; // 5 min cap to guard against absurd server values

/**
 * Parses the `Retry-After` header from an API error response into milliseconds.
 *
 * Returns `null` when the header is absent, unparseable, non-positive, or non-finite.
 * Caps the result at `maxWaitMs` (default 5 minutes).
 */
export function parseRetryAfterMs(
  headers: Headers | undefined,
  maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
): number | null {
  const raw = headers?.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, maxWaitMs);
}
