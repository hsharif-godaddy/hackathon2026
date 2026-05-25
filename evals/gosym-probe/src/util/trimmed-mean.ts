/**
 * Returns the trimmed mean of the given values.
 *
 * Non-finite values (NaN, +Infinity, -Infinity) are silently excluded
 * before computation.
 *
 * When count > 2, the lowest and highest values are dropped and the
 * remaining values are averaged. When count <= 2, all values are averaged
 * (no trimming). Returns null for an empty array or when all values are
 * non-finite.
 *
 * The aggregate score for score-mode evaluators uses this instead of the
 * median so that more data points contribute while outliers are suppressed.
 */
export function trimmedMean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;

  const sorted = [...finite].sort((a, b) => a - b);

  const inner = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  return inner.reduce((sum, v) => sum + v, 0) / inner.length;
}
