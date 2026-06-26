// ── Private helpers ───────────────────────────────────────────────────────────

function populationSD(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  const variance =
    values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Mulberry32 seeded PRNG. Returns a function producing uniform [0, 1) floats.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wilson score confidence interval for proportion p with n observations.
 * Clamps to [0, 1].
 */
function wilsonCI(
  p: number,
  n: number,
  z: number,
): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 1 };
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const width =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return {
    lower: Math.max(0, center - width),
    upper: Math.min(1, center + width),
  };
}

/**
 * Linear interpolation quantile from a sorted array.
 */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Generates all index combinations of size k from range 0..n-1.
 */
function* combinationIndices(n: number, k: number): Generator<number[]> {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > n) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  yield [...indices];
  while (true) {
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
    yield [...indices];
  }
}

/** Approximation of erf (Abramowitz & Stegun 7.1.26, max error < 1.5e-7). */
function erf(x: number): number {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const poly =
    t * (a[0] + t * (a[1] + t * (a[2] + t * (a[3] + t * a[4]))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

function normCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Inverse normal CDF via rational approximation (A&S 26.2.17).
 * Max error: ~4.5e-4.
 */
function normInvCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const sign = p < 0.5 ? -1 : 1;
  const q = Math.min(p, 1 - p);
  const t = Math.sqrt(-2 * Math.log(q));
  const c = [2.515517, 0.802853, 0.010328];
  const d = [1.432788, 0.189269, 0.001308];
  const numer = c[0] + t * (c[1] + t * c[2]);
  const denom = 1 + t * (d[0] + t * (d[1] + t * d[2]));
  return sign * (t - numer / denom);
}

const PERMUTATION_EXACT_THRESHOLD = 15;
const DEFAULT_MC_SAMPLES = 10_000;

// ── Public types ──────────────────────────────────────────────────────────────

export type TOSTMethod = 'wilson-score' | 'permutation-exact' | 'permutation-mc' | 'uniform-match';

export interface TOSTOpts {
  /** Significance level, e.g. 0.05. */
  alpha: number;
  /**
   * Non-inferiority margin; pre-computed by caller via computeMargin().
   * Higher-is-better: non-inferior when CI_lower > -margin.
   * lowerIsBetter: non-inferior when CI_upper < +margin.
   */
  margin: number;
  /** When true, score increases are regressions. Default false. */
  lowerIsBetter?: boolean;
  /** PRNG seed for the Monte Carlo / bootstrap paths. */
  seed?: number;
  /** Number of Monte Carlo samples for the permutation MC path. */
  mcSamples?: number;
}

export interface TOSTResult {
  /** True when the confidence interval clears the non-inferiority threshold. */
  nonInferiorityProven: boolean;
  /** The margin used for this test. */
  margin: number;
  /** mean(current) - mean(baseline). */
  observedDiff: number;
  /** (1-alpha) confidence interval for observedDiff. */
  confidenceInterval: { lower: number; upper: number };
  /** Which statistical method was used. */
  method: TOSTMethod;
  /** Population SD of the baseline trial scores (for reference). */
  baselineSD: number;
}

// ── computeMargin ─────────────────────────────────────────────────────────────

export interface MarginResult {
  /** The effective non-inferiority margin (after floor). */
  margin: number;
  /** True when the fractional floor strictly exceeded k × SD (raw < floorTerm). */
  floored: boolean;
}

/**
 * Non-inferiority margin = max(k × populationSD(trialScores), floorTerm),
 * where floorTerm = minMarginFraction × max(mean, 0).
 *
 * **Relative floor.** The floor is a *fraction of the baseline mean*, not an
 * absolute constant. Score-mode evaluators store raw measurements (turns,
 * seconds, steps) whose scales differ by orders of magnitude, so a fixed
 * absolute floor is meaningless across metrics. A fractional floor is
 * dimensionless: `minMarginFraction = 0.05` means "tolerate 5% of the baseline
 * mean" for every metric. When baseline variance is near-zero, k × SD is too
 * tight for TOST to prove non-inferiority at small sample sizes; the floor
 * supplies a minimum tolerance so sub-5% jitter is not flagged as a regression.
 * `floored` is true iff the floor term strictly exceeded k × SD.
 *
 * **Four regimes** (with minMarginFraction > 0):
 * - mean>0, SD>0: floor inert when k·SD ≥ frac·mean; else floor engages.
 * - mean>0, SD=0: raw is 0, margin = frac·mean (floored).
 * - mean=0, SD>0: floor term is 0, margin = k·SD.
 * - mean=0, SD=0: margin = 0 → caller routes to strict uniform-match.
 *
 * **Finiteness guard.** Raw scores are unclamped (post-#5369), so a non-finite
 * score can reach this function. If `mean` is not finite, the floor term is
 * forced to 0 — otherwise `frac × Infinity = Infinity` would inflate the margin
 * into an always-pass gate (a regression detector that can never fail). The raw
 * k·SD term may still be NaN on such input (pre-existing, handled at the
 * `isValidTrialScore` boundary as a separate follow-up), but the floor never
 * turns the gate trivially permissive.
 *
 * **Caller responsibility:** When margin=0 (mean=0 AND SD=0), callers must
 * bypass TOST and use a strict uniform-match check instead: the current run
 * passes only if every trial score equals the baseline constant.
 */
export function computeMargin(
  trialScores: readonly number[],
  k: number,
  minMarginFraction: number = 0,
): MarginResult {
  const raw: number = k * populationSD(trialScores);
  const mean: number =
    trialScores.length > 0
      ? trialScores.reduce((s, x) => s + x, 0) / trialScores.length
      : 0;
  const floorTerm: number = Number.isFinite(mean)
    ? minMarginFraction * Math.max(mean, 0)
    : 0;
  const margin: number = Math.max(raw, floorTerm);
  return { margin, floored: margin > raw };
}

// ── tostProportions ───────────────────────────────────────────────────────────

/**
 * TOST non-inferiority test for binary (0/1) evaluators.
 * Uses Newcombe's method (Wilson score intervals) for the CI on the
 * difference of proportions p_current - p_baseline.
 *
 * Non-inferiority proven when:
 * - higher-is-better: CI_lower > -margin
 * - lowerIsBetter: CI_upper < +margin
 */
export function tostProportions(
  baselineScores: readonly number[],
  currentScores: readonly number[],
  opts: TOSTOpts,
): TOSTResult {
  const { alpha, margin, lowerIsBetter = false } = opts;
  const z = normInvCDF(1 - alpha / 2);
  const baselineSD = populationSD(baselineScores);

  const nb = baselineScores.length;
  const nc = currentScores.length;
  const pb =
    nb > 0 ? baselineScores.reduce((s, x) => s + x, 0) / nb : 0;
  const pc =
    nc > 0 ? currentScores.reduce((s, x) => s + x, 0) / nc : 0;
  const observedDiff = pc - pb;

  const ciB = wilsonCI(pb, nb, z);
  const ciC = wilsonCI(pc, nc, z);

  // Newcombe (1998) method 10: CI for difference p_c - p_b
  const ciLower =
    observedDiff -
    Math.sqrt((pc - ciC.lower) ** 2 + (ciB.upper - pb) ** 2);
  const ciUpper =
    observedDiff +
    Math.sqrt((ciC.upper - pc) ** 2 + (pb - ciB.lower) ** 2);

  const nonInferiorityProven = lowerIsBetter
    ? ciUpper < margin
    : ciLower > -margin;

  return {
    nonInferiorityProven,
    margin,
    observedDiff,
    confidenceInterval: { lower: ciLower, upper: ciUpper },
    method: 'wilson-score',
    baselineSD,
  };
}

// ── tostPermutation ───────────────────────────────────────────────────────────

/**
 * Enumerates all C(n, nc) permutation deltas.
 * Called only when n_combined ≤ PERMUTATION_EXACT_THRESHOLD.
 */
function exactNullDeltas(
  baseline: readonly number[],
  current: readonly number[],
): number[] {
  const pool = [...baseline, ...current];
  const n = pool.length;
  const nc = current.length;
  const nb = n - nc;
  const poolSum = pool.reduce((s, x) => s + x, 0);

  const deltas: number[] = [];
  for (const indices of combinationIndices(n, nc)) {
    const currentSum = indices.reduce((s, i) => s + pool[i], 0);
    deltas.push(currentSum / nc - (poolSum - currentSum) / nb);
  }
  return deltas;
}

/**
 * Monte Carlo permutation deltas using a partial Fisher-Yates shuffle.
 */
function mcNullDeltas(
  baseline: readonly number[],
  current: readonly number[],
  B: number,
  prng: () => number,
): number[] {
  const pool = [...baseline, ...current];
  const n = pool.length;
  const nc = current.length;
  const nb = n - nc;
  const poolSum = pool.reduce((s, x) => s + x, 0);

  const deltas: number[] = [];
  // buf is intentionally reused across iterations: partial Fisher-Yates
  // only randomizes indices [0, nc), leaving the full array valid for the next pass.
  const buf = [...pool];
  for (let b = 0; b < B; b++) {
    // Partial Fisher-Yates: randomly place nc items at the front
    for (let i = 0; i < nc; i++) {
      const j = i + Math.floor(prng() * (n - i));
      const tmp = buf[i];
      buf[i] = buf[j];
      buf[j] = tmp;
    }
    let currentSum = 0;
    for (let i = 0; i < nc; i++) currentSum += buf[i];
    deltas.push(currentSum / nc - (poolSum - currentSum) / nb);
  }
  return deltas;
}

/**
 * TOST non-inferiority test for continuous evaluators.
 *
 * Uses exact permutation enumeration when n_combined ≤ 15 (C(15,7) = 6435),
 * and seeded Monte Carlo otherwise.
 *
 * The confidence interval is derived by centering the permutation null
 * distribution at the observed difference:
 *   CI = [observedDiff − q_{1-α/2}(null), observedDiff − q_{α/2}(null)]
 *
 * Non-inferiority proven when:
 * - higher-is-better: CI_lower > -margin
 * - lowerIsBetter: CI_upper < +margin
 */
export function tostPermutation(
  baselineScores: readonly number[],
  currentScores: readonly number[],
  opts: TOSTOpts,
): TOSTResult {
  const {
    alpha,
    margin,
    lowerIsBetter = false,
    seed = 0,
    mcSamples = DEFAULT_MC_SAMPLES,
  } = opts;

  const nb = baselineScores.length;
  const nc = currentScores.length;

  const baselineMean =
    nb > 0 ? baselineScores.reduce((s, x) => s + x, 0) / nb : 0;
  const currentMean =
    nc > 0 ? currentScores.reduce((s, x) => s + x, 0) / nc : 0;
  const observedDiff = currentMean - baselineMean;
  const baselineSD = populationSD(baselineScores);

  const useExact = nb + nc <= PERMUTATION_EXACT_THRESHOLD;
  const method: TOSTResult['method'] = useExact
    ? 'permutation-exact'
    : 'permutation-mc';

  let nullDeltas: number[];
  if (useExact) {
    nullDeltas = exactNullDeltas(baselineScores, currentScores);
  } else {
    const prng = mulberry32(seed);
    nullDeltas = mcNullDeltas(baselineScores, currentScores, mcSamples, prng);
  }

  nullDeltas.sort((a, b) => a - b);

  // Shift the null distribution (centered at ~0) to be centered at observedDiff.
  // CI_lower = observedDiff - q_{1-α/2}(null)
  // CI_upper = observedDiff - q_{α/2}(null)
  const lowerQ = quantile(nullDeltas, alpha / 2);
  const upperQ = quantile(nullDeltas, 1 - alpha / 2);
  const ciLower = observedDiff - upperQ;
  const ciUpper = observedDiff - lowerQ;

  const nonInferiorityProven = lowerIsBetter
    ? ciUpper < margin
    : ciLower > -margin;

  return {
    nonInferiorityProven,
    margin,
    observedDiff,
    confidenceInterval: { lower: ciLower, upper: ciUpper },
    method,
    baselineSD,
  };
}

