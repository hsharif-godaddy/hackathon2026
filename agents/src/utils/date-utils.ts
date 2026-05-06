/**
 * Returns an ISO 8601 string for the instant `minutesAgo` minutes before `startTimeStampMs`.
 *
 * - `minutesAgo = 0` returns the ISO of `startTimeStampMs`.
 * - Negative `minutesAgo` returns a future ISO timestamp (permissive; callers validate if needed).
 * - Fractional `minutesAgo` is supported (resolves at ms precision).
 */
export function toIsoDateString(startTimeStampMs: number, minutesAgo: number): string {
  return new Date(startTimeStampMs - minutesAgo * 60 * 1000).toISOString();
}
