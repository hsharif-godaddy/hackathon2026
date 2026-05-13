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
