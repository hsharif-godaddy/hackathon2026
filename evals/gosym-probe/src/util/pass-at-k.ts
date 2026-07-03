/**
 * Unbiased pass-rate estimators (Chen et al., HumanEval) computed from a
 * finite trial budget. Given `n` non-failed trials of which `c` passed, these
 * estimate the behavior of drawing `k` trials at random.
 *
 * This module is the sole trust boundary for the estimator math: every guard
 * lives here, and no reporter or persistence site recomputes the combinatorics.
 * All functions return `null` for inputs that cannot yield a meaningful
 * estimate (callers render `null` as `—`/`N/A`) rather than throwing.
 */

/**
 * Default reporting vector when no `StatisticalRegressionConfig` is in scope
 * (e.g. a bare `new TrialAggregator()` or the prompt-tax rescore path). Mirrors
 * `REGRESSION_DEFAULTS.reportingK`; resolved per scenario against `n`.
 */
export const DEFAULT_REPORTING_KS: readonly number[] = [1, 2, 3, 5, 10];

/**
 * A single estimator value for a given reporting `k`. Modeled as an explicit
 * `{ k, value }` pair rather than a `Record<number, number>` because these
 * estimators are serialized to disk and reloaded: `JSON` coerces numeric keys
 * to strings, so a `Record<number, number>` misrepresents the post-parse
 * runtime shape and forces every reader to launder keys back through `Number`.
 * The pair array is the honest representation and needs no key laundering.
 */
export interface PassEstimatorEntry {
  k: number;
  value: number;
}

/** Wilson score confidence interval for a proportion. */
export interface WilsonCI {
  /** Lower bound, clamped to [0, 1]. */
  lower: number;
  /** Upper bound, clamped to [0, 1]. */
  upper: number;
  /** Trial count the interval was computed from; the sample size reporters render. */
  n: number;
}

/**
 * Sample-size and interval annotations for a `pass@1` value. Modeled as a
 * single object rather than independent `n`/`ci` parameters so that a caller
 * cannot render a confidence interval without the sample size it was computed
 * from: `n` is always the count the `ci` (when present) was derived from.
 */
export interface Pass1Stats {
  n: number;
  ci?: WilsonCI;
}

/** Estimators bundled onto an aggregated result, one entry per reporting `k`. */
export interface PassEstimators {
  /** Headline probability a task passes on the first try: `c / n`. */
  passAt1?: number;
  /** `pass@k` per reporting `k`: probability at least one of `k` draws passes. */
  passAtK?: PassEstimatorEntry[];
  /** `pass^k` per reporting `k`: probability all `k` draws pass (reliability). */
  passHatK?: PassEstimatorEntry[];
  /** 95% Wilson score CI for `passAt1`. Absent when `n <= 0`. */
  wilsonCI?: WilsonCI;
}

/** Clamp an observed pass count into the valid `[0, n]` range defensively. */
function clampPassCount(n: number, c: number): number {
  return Math.max(0, Math.min(c, n));
}

/**
 * `pass@1 = c / n`. Returns `null` when `n <= 0`.
 */
export function passAt1(n: number, c: number): number | null {
  if (n <= 0) {
    return null;
  }
  return clampPassCount(n, c) / n;
}

/**
 * `pass@k = 1 - C(n-c, k) / C(n, k)` — probability at least one of `k` random
 * draws passes. Computed in product form for numeric stability:
 * `1 - prod_{i=n-c+1..n}(1 - k/i)`, where every divisor `i >= n-k+1 >= 1`.
 *
 * Returns `null` for `n <= 0`, `k < 1`, or `k > n`. Returns `1` when fewer than
 * `k` failing trials remain (`n - c < k`), since no `k`-draw can avoid a pass.
 */
export function passAtK(n: number, c: number, k: number): number | null {
  if (n <= 0 || k < 1 || k > n) {
    return null;
  }
  const passes: number = clampPassCount(n, c);
  if (n - passes < k) {
    return 1;
  }
  let failProbability: number = 1;
  for (let i: number = n - passes + 1; i <= n; i++) {
    failProbability *= 1 - k / i;
  }
  return 1 - failProbability;
}

/**
 * `pass^k = C(c, k) / C(n, k)` — probability all `k` random draws pass.
 * Computed in product form: `prod_{i=0..k-1}((c-i)/(n-i))`, where every divisor
 * `n - i >= n - k + 1 >= 1`.
 *
 * Returns `null` for `n <= 0`, `k < 1`, or `k > n`. Returns `0` when fewer than
 * `k` passing trials exist (`c < k`).
 */
export function passHatK(n: number, c: number, k: number): number | null {
  if (n <= 0 || k < 1 || k > n) {
    return null;
  }
  const passes: number = clampPassCount(n, c);
  if (passes < k) {
    return 0;
  }
  let probability: number = 1;
  for (let i: number = 0; i < k; i++) {
    probability *= (passes - i) / (n - i);
  }
  return probability;
}

/**
 * Resolve a configured reporting vector against a scenario's trial count `n`:
 * keep integers `1 <= k <= ceil(n/2)`, always include `1`, dedupe, sort
 * ascending. Returns `[]` when `n <= 0`.
 */
export function resolveReportingKs(vector: readonly number[], n: number): number[] {
  if (n <= 0) {
    return [];
  }
  const cap: number = Math.ceil(n / 2);
  const ks: Set<number> = new Set<number>([1]);
  for (const value of vector) {
    if (Number.isInteger(value) && value >= 1 && value <= cap) {
      ks.add(value);
    }
  }
  return [...ks].sort((a, b) => a - b);
}

/**
 * Wilson score confidence interval for `c` passes in `n` trials at z-score `z`
 * (default 1.96 for 95% CI). Returns `null` for degenerate inputs.
 *
 * Uses `(n, c)` rather than `(p, n)` so this function shares the same trust
 * boundary as the other estimators -- `c` is clamped here, not by callers.
 */
export function wilsonConfidenceInterval(n: number, c: number, z: number = 1.96): WilsonCI | null {
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  if (!Number.isFinite(c)) {
    return null;
  }
  if (!Number.isFinite(z) || z <= 0) {
    return null;
  }
  const passes: number = clampPassCount(n, c);
  const p: number = passes / n;
  const z2: number = z * z;
  const center: number = (p + z2 / (2 * n)) / (1 + z2 / n);
  const width: number =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return {
    lower: Math.max(0, center - width),
    upper: Math.min(1, center + width),
    n,
  };
}

/**
 * Compute every estimator once for a producer to store on its aggregated
 * result. `ks` is the configured reporting vector; it is resolved against `n`
 * internally so each keyed entry is guaranteed non-null. Returns an empty
 * object when `n <= 0` so spread guards omit the fields entirely.
 */
export function buildPassEstimators(n: number, c: number, ks: readonly number[]): PassEstimators {
  const resolvedKs: number[] = resolveReportingKs(ks, n);
  if (resolvedKs.length === 0) {
    return {};
  }
  const pass1: number | null = passAt1(n, c);
  if (pass1 === null) {
    return {};
  }
  const atK: PassEstimatorEntry[] = [];
  const hatK: PassEstimatorEntry[] = [];
  for (const k of resolvedKs) {
    const atKValue: number | null = passAtK(n, c, k);
    const hatKValue: number | null = passHatK(n, c, k);
    if (atKValue === null || hatKValue === null) {
      continue;
    }
    atK.push({ k, value: atKValue });
    hatK.push({ k, value: hatKValue });
  }
  const ci: WilsonCI | null = wilsonConfidenceInterval(n, c);
  return {
    passAt1: pass1,
    passAtK: atK,
    passHatK: hatK,
    ...(ci !== null ? { wilsonCI: ci } : {}),
  };
}

/**
 * Render a `WilsonCI` as `[lower, upper]` with 2 decimal places, or return
 * `emptySentinel` when absent.
 */
export function formatWilsonCI(ci: WilsonCI | undefined, emptySentinel: string): string {
  if (ci === undefined) {
    return emptySentinel;
  }
  return `[${ci.lower.toFixed(2)}, ${ci.upper.toFixed(2)}]`;
}

/**
 * Render a headline `pass@1` value for a report, using `emptySentinel` for
 * absent or non-finite values. When `stats` is provided the trial count is
 * appended as `(n=N)`; when `stats.ci` is also present its Wilson interval is
 * appended. Sourcing the sample size from `stats` (rather than a separate
 * parameter) keeps the rendered count and interval from ever disagreeing.
 * Shared by every reporter so the formatting contract lives next to the
 * estimator math.
 */
export function formatPass1(
  value: number | undefined,
  emptySentinel: string,
  stats?: Pass1Stats,
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return emptySentinel;
  }
  let result: string = value.toFixed(2);
  if (stats !== undefined) {
    result += ` (n=${stats.n})`;
    if (stats.ci !== undefined) {
      result += ` ${formatWilsonCI(stats.ci, emptySentinel)}`;
    }
  }
  return result;
}

/**
 * Render a `pass@k` / `pass^k` vector as `k:value` pairs sorted by ascending
 * `k`, dropping non-finite entries and falling back to `emptySentinel` when the
 * vector is absent or empty. Shared by every reporter.
 */
export function formatEstimatorVector(
  estimators: PassEstimatorEntry[] | undefined,
  emptySentinel: string,
): string {
  if (estimators === undefined) {
    return emptySentinel;
  }
  const parts: string[] = [...estimators]
    .sort((a, b) => a.k - b.k)
    .filter((entry) => Number.isFinite(entry.value))
    .map((entry) => `${entry.k}:${entry.value.toFixed(2)}`);
  return parts.length > 0 ? parts.join('; ') : emptySentinel;
}
