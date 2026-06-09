/**
 * Intraclass Correlation Coefficient (ICC) for inter-rater reliability.
 *
 * ICC measures the proportion of variance due to between-subject differences
 * rather than within-subject (judge) differences. Higher ICC = more reliable.
 *
 * References:
 * - Shrout & Fleiss (1979). "Intraclass correlations: uses in assessing rater reliability"
 * - Koo & Li (2016). "A Guideline of Selecting and Reporting Intraclass Correlation Coefficients"
 */

/**
 * ICC interpretation brackets (Koo & Li, 2016)
 */
export function interpretICC(icc: number): string {
  if (icc < 0.5) return 'Poor';
  if (icc < 0.75) return 'Moderate';
  if (icc < 0.9) return 'Good';
  return 'Excellent';
}

/**
 * Compute ICC(2,1) for a set of ratings.
 *
 * ICC(2,1) = Two-way random effects model, single rater.
 * Appropriate when:
 * - Judges are a random sample of possible judges
 * - Each simulation is rated by the same set of judges
 * - We want reliability of a single judge's score
 *
 * @param data - Array of simulations, each with an array of judge scores
 *              Example: [[75, 80, 78], [60, 65, 62], ...]
 * @returns ICC coefficient [0,1] or null if insufficient data
 */
export function computeICC(data: number[][]): number | null {
  // Filter out simulations with <2 valid scores
  const filtered = data.filter((scores) => scores.length >= 2);
  if (filtered.length < 2) return null; // Need at least 2 simulations

  const k = filtered[0]!.length; // Number of judges
  const n = filtered.length; // Number of simulations

  // Validate consistent panel size
  if (!filtered.every((scores) => scores.length === k)) {
    // Inconsistent panel size - fall back to mean panel size
    // This is a simplification; proper ICC(2,1) requires complete data
    return null;
  }

  // Compute grand mean
  const allScores = filtered.flat();
  const grandMean = allScores.reduce((a, b) => a + b, 0) / allScores.length;

  // Compute row means (mean score per simulation)
  const rowMeans = filtered.map((scores) => scores.reduce((a, b) => a + b, 0) / scores.length);

  // Compute column means (mean score per judge)
  const colMeans: number[] = [];
  for (let j = 0; j < k; j++) {
    const colSum = filtered.reduce((sum, scores) => sum + scores[j]!, 0);
    colMeans.push(colSum / n);
  }

  // Between-subjects sum of squares (BMS)
  let ssRows = 0;
  for (let i = 0; i < n; i++) {
    ssRows += (rowMeans[i]! - grandMean) ** 2;
  }
  const msRows = (ssRows * k) / (n - 1);

  // Between-judges sum of squares (JMS)
  let ssCols = 0;
  for (let j = 0; j < k; j++) {
    ssCols += (colMeans[j]! - grandMean) ** 2;
  }
  const msCols = (ssCols * n) / (k - 1);

  // Error sum of squares (EMS)
  let ssError = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      const predicted = grandMean + (rowMeans[i]! - grandMean) + (colMeans[j]! - grandMean);
      ssError += (filtered[i]![j]! - predicted) ** 2;
    }
  }
  const msError = ssError / ((n - 1) * (k - 1));

  // ICC(2,1) formula
  const icc = (msRows - msError) / (msRows + (k - 1) * msError + (k / n) * (msCols - msError));

  // Clamp to [0, 1] (negative ICC can occur but is typically interpreted as 0)
  return Math.max(0, Math.min(1, icc));
}

/**
 * Compute ICC from consensus data structure used in aggregate.ts
 *
 * @param consensusData - Array of { validScores: number[] } from consensus.json files
 * @returns ICC coefficient or null
 */
export function computeICCFromConsensus(
  consensusData: Array<{ validScores: number[] }>,
): { icc: number; interpretation: string; n: number; k: number } | null {
  // Extract score arrays
  const data = consensusData
    .map((c) => c.validScores)
    .filter((scores) => scores.length >= 2);

  if (data.length < 2) return null;

  const icc = computeICC(data);
  if (icc === null) return null;

  return {
    icc,
    interpretation: interpretICC(icc),
    n: data.length, // Number of simulations
    k: data[0]!.length, // Number of judges (assuming consistent)
  };
}

/**
 * Bootstrap confidence interval for ICC.
 *
 * ICC point estimates are unstable at small sample sizes (n < 30). This function
 * computes bootstrap CIs to quantify uncertainty on the ICC coefficient itself.
 *
 * @param data - Array of simulations, each with judge scores
 * @param confidence - Confidence level (default 0.95)
 * @param iterations - Number of bootstrap resamples (default 2000, lower than typical
 *                     10k due to ICC computation cost)
 * @returns { lower, upper, point } or null if insufficient data
 */
export function bootstrapICC(
  data: number[][],
  confidence: number = 0.95,
  iterations: number = 2000,
): { lower: number; upper: number; point: number; reliable: boolean } | null {
  const filtered = data.filter((scores) => scores.length >= 2);
  if (filtered.length < 2) return null;

  const bootstrapICCs: number[] = [];
  const n = filtered.length;

  for (let i = 0; i < iterations; i++) {
    // Resample simulations with replacement
    const resample: number[][] = [];
    for (let j = 0; j < n; j++) {
      resample.push(filtered[Math.floor(Math.random() * n)]!);
    }
    const icc = computeICC(resample);
    if (icc !== null) bootstrapICCs.push(icc);
  }

  if (bootstrapICCs.length === 0) return null;

  bootstrapICCs.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  const lowerIdx = Math.floor(bootstrapICCs.length * (alpha / 2));
  const upperIdx = Math.floor(bootstrapICCs.length * (1 - alpha / 2));

  const point = computeICC(filtered) ?? 0;
  const lower = bootstrapICCs[lowerIdx] ?? 0;
  const upper = bootstrapICCs[upperIdx] ?? 1;

  // ICC is reliable when sample size >= 30 (Koo & Li 2016 threshold)
  // Below this, interpretation brackets lose meaning
  const reliable = n >= 30;

  return { lower, upper, point, reliable };
}
