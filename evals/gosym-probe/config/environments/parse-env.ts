/**
 * Read MAX_CONCURRENCY from the environment.
 * Returns {@link fallback} when the var is unset, empty,
 * non-numeric, or less than 1.
 */
export function parseMaxConcurrency(
  fallback: number,
): number {
  const raw = process.env.MAX_CONCURRENCY;
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

/**
 * Read MAX_TURNS from the environment.
 * Returns {@link fallback} when the var is unset, empty,
 * non-numeric, or less than 1.
 */
export function parseMaxTurns(fallback: number): number {
  const raw = process.env.MAX_TURNS;
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}
