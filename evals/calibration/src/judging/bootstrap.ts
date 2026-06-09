/**
 * Bootstrap confidence interval estimation for calibration metrics.
 *
 * Used to quantify uncertainty on aggregate statistics (MAE, bias, variance)
 * when sample sizes are small (typical: 10-50 runs per evaluator).
 */

/**
 * Compute bootstrap confidence interval for a statistic.
 *
 * @param data - Sample data points
 * @param statistic - Function computing the statistic of interest (e.g., mean, median)
 * @param confidence - Confidence level (e.g., 0.95 for 95% CI)
 * @param iterations - Number of bootstrap resamples (default 10000)
 * @returns { lower, upper, point } - CI bounds and point estimate
 */
export function bootstrapCI(
  data: number[],
  statistic: (sample: number[]) => number,
  confidence: number = 0.95,
  iterations: number = 10000,
): { lower: number; upper: number; point: number } | null {
  if (data.length === 0) return null;
  if (data.length === 1) {
    // Single observation: CI is just the value itself
    const val = statistic(data);
    return { lower: val, upper: val, point: val };
  }

  const bootstrapStats: number[] = [];
  const n = data.length;

  for (let i = 0; i < iterations; i++) {
    // Resample with replacement
    const resample: number[] = [];
    for (let j = 0; j < n; j++) {
      resample.push(data[Math.floor(Math.random() * n)]!);
    }
    bootstrapStats.push(statistic(resample));
  }

  // Sort and extract percentiles
  bootstrapStats.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  const lowerIdx = Math.floor(iterations * (alpha / 2));
  const upperIdx = Math.floor(iterations * (1 - alpha / 2));

  return {
    lower: bootstrapStats[lowerIdx]!,
    upper: bootstrapStats[upperIdx]!,
    point: statistic(data),
  };
}

/**
 * Compute bootstrap CI for mean absolute error.
 */
export function bootstrapMAE(
  values: number[],
  confidence: number = 0.95,
  iterations: number = 10000,
): { lower: number; upper: number; point: number } | null {
  return bootstrapCI(
    values,
    (sample) => sample.reduce((sum, x) => sum + Math.abs(x), 0) / sample.length,
    confidence,
    iterations,
  );
}

/**
 * Compute bootstrap CI for bias (mean signed delta).
 */
export function bootstrapBias(
  values: number[],
  confidence: number = 0.95,
  iterations: number = 10000,
): { lower: number; upper: number; point: number } | null {
  return bootstrapCI(
    values,
    (sample) => sample.reduce((sum, x) => sum + x, 0) / sample.length,
    confidence,
    iterations,
  );
}

/**
 * Check if CI excludes zero (for bias significance).
 */
export function isSignificantBias(ci: { lower: number; upper: number } | null): boolean {
  if (!ci) return false;
  return (ci.lower > 0 && ci.upper > 0) || (ci.lower < 0 && ci.upper < 0);
}
