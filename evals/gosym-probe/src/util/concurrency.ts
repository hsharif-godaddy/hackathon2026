/**
 * Clamps a concurrency override to the hard ceiling.
 * Returns undefined when no override is provided (caller uses its own default).
 */
export function clampConcurrency(
  override: number | undefined,
  max: number,
): number | undefined {
  if (override === undefined) return undefined;
  return Math.min(override, max);
}

/**
 * Resolves effective concurrency: applies override if present, otherwise uses max.
 * Result is always clamped to max.
 */
export function effectiveConcurrency(
  override: number | undefined,
  max: number,
): number {
  return Math.min(override ?? max, max);
}

/**
 * Clamps a requested capture concurrency to a hard ceiling. Unlike
 * {@link effectiveConcurrency}, the fallback is the resolved config value
 * (not the ceiling), so the default capture concurrency is preserved while a
 * runaway override (e.g. a `--capture-concurrency 100` typo) is bounded.
 * Returns `clamped` so the caller can warn when the ceiling bites.
 */
export function clampCaptureConcurrency(
  requested: number,
  ceiling: number,
): { value: number; clamped: boolean } {
  const value = Math.min(requested, ceiling);
  return { value, clamped: value < requested };
}
