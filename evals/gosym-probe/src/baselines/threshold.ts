/**
 * Shared threshold configuration for regression detection and
 * score-mode enrichment.
 */
export interface ThresholdConfig {
  thresholds: Record<string, number>;
  defaultThreshold: number;
}

/**
 * Returns true when `currentScore` represents a regression past `threshold`
 * relative to `baselineScore`.
 *
 * Shared by RegressionComparator (directly) and score-mode enricher (inverted).
 * Callers that need "passes baseline" semantics negate the result.
 *
 * Edge cases:
 * - Non-finite currentScore or baselineScore: returns false.
 * - baselineScore === 0 + lowerIsBetter: true iff currentScore > 0.
 * - baselineScore === 0 + higherIsBetter: always false.
 * - baselineScore < 0: always false (percentage change is undefined).
 */
export function exceedsThreshold(
  currentScore: number,
  baselineScore: number,
  threshold: number,
  lowerIsBetter: boolean,
): boolean {
  if (!Number.isFinite(currentScore) || !Number.isFinite(baselineScore)) {
    return false;
  }
  if (lowerIsBetter) {
    if (baselineScore === 0) return currentScore > 0;
    if (baselineScore < 0) return false;
    return (currentScore - baselineScore) / baselineScore > threshold;
  }
  if (baselineScore <= 0) return false;
  return (baselineScore - currentScore) / baselineScore > threshold;
}

/**
 * Resolves the effective regression threshold for an evaluator.
 *
 * Cascade: baseline per-evaluator override -> config per-evaluator -> config default.
 * Pass-rate callers omit baselineThresholds to use the 2-level cascade.
 */
export function resolveThreshold(
  name: string,
  config: ThresholdConfig,
  baselineThresholds?: Record<string, number>,
): number {
  return baselineThresholds?.[name]
    ?? config.thresholds[name]
    ?? config.defaultThreshold;
}

/**
 * Returns true when evaluator versions differ between current run and baseline,
 * indicating the baseline must be regenerated before comparison is meaningful.
 *
 * Returns false (no mismatch) when both versions are undefined or equal.
 */
export function hasVersionMismatch(
  currentVersion: string | undefined,
  baselineVersion: string | undefined,
): boolean {
  if (currentVersion === undefined && baselineVersion === undefined) return false;
  return currentVersion !== baselineVersion;
}
