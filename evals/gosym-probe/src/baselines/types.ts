import type { StabilityLevel } from '../scenarios/types.js';
import type { TOSTMethod } from './statistical-tests.js';

export interface BaselineEvalScores {
  /** Absent when regressionMode === 'score'. */
  passAtK?: boolean;
  /** Absent when regressionMode === 'score'. */
  passToTheK?: boolean;
  passingTrials: number;
  totalTrials: number;
  /** Aggregate score across trials; populated for score-mode evaluators. */
  aggregateScore?: number;
  evalVersion?: string;
  /** When true, score increase = regression. Present only for score-mode evaluators. */
  lowerIsBetter?: boolean;
  /**
   * Per-trial scores used for statistical regression gating (TOST).
   * Excludes trials with evaluatorFailed=true or verdict='unknown'.
   * Absent on legacy baselines saved before this field was introduced.
   */
  trialScores?: readonly number[];
}

export interface BaselineScores {
  scenarioName: string;
  runId: string;
  createdAt: string;
  stabilityLevel?: StabilityLevel;
  stabilityTrials?: number;
  /** Short git SHA of the commit that produced this baseline. */
  gitSha?: string | null;
  /** Git branch name at the time this baseline was saved. */
  gitBranch?: string | null;
  /** Keyed by evaluator name. */
  scores: Record<string, BaselineEvalScores>;
  /**
   * Per-evaluator regression thresholds for score-mode evaluators.
   * Keyed by evaluator name. Written by save-baseline on first save;
   * preserved on subsequent saves to allow manual tuning.
   */
  regressionThresholds?: Record<string, number>;
}

interface RegressionEvalResultBase {
  evaluator: string;
  currentEvalVersion?: string;
  baselineEvalVersion?: string;
}

/**
 * Metadata from a TOST (Two One-Sided Tests) statistical comparison.
 * Present only when baseline had trialScores and current run had extractable scores.
 */
export interface StatisticalMetadata {
  method: TOSTMethod;
  /** Non-inferiority margin used: max(k·SD(baselineTrialScores), frac·max(mean,0)). */
  margin: number;
  /** Population SD of baseline trial scores. */
  baselineSD: number;
  /** SD multiplier used to derive the margin. */
  k: number;
  /** Trial count for each side of the comparison. */
  n: { baseline: number; current: number };
  /** (1 - alpha) confidence interval on mean(current) - mean(baseline). */
  confidenceInterval: { lower: number; upper: number };
  /** True when CI proves current is within margin of baseline (gate passes). */
  nonInferiorityProven: boolean;
  /**
   * True when the fractional floor (frac·mean) strictly exceeded k·SD, so the
   * floor set the margin. Signals that the baseline has insufficient variance
   * and the pass should carry a warning.
   */
  marginFloored?: boolean;
}

export interface ComparedRegressionEvalResult extends RegressionEvalResultBase {
  type: 'compared';
  /**
   * Pass-rate mode: passingTrials / totalTrials.
   * Score mode: aggregate score across trials.
   * NaN when no data is available.
   */
  currentScore: number;
  /**
   * Pass-rate mode: baseline passingTrials / totalTrials.
   * Score mode: baseline aggregate score.
   * NaN when no baseline data exists.
   */
  baselineScore: number;
  /**
   * currentScore - baselineScore; NaN if either is NaN.
   * Sign interpretation depends on evaluator direction:
   * - higher-is-better: negative delta = regression.
   * - lowerIsBetter: positive delta = regression.
   */
  delta: number;
  /**
   * Statistical path: true when TOST fails to prove non-inferiority.
   * Fallback path: true when threshold is exceeded.
   * False for NaN scores, missing baseline, or zero baseline score.
   */
  exceeded: boolean;
  skipped?: boolean;
  skipReason?: string;
  currentEvalVersion?: string;
  baselineEvalVersion?: string;
  /**
   * Present when the statistical (TOST) path was used.
   * Absent when falling back to threshold-based comparison.
   */
  statistical?: StatisticalMetadata;
}

export interface SkippedRegressionEvalResult extends RegressionEvalResultBase {
  type: 'skipped';
  skipReason: string;
}

export type RegressionEvalResult = ComparedRegressionEvalResult | SkippedRegressionEvalResult;

export interface RegressionResult {
  scenarioName: string;
  /**
   * 'pass'    — non-inferiority proven (TOST/uniform-match) or within thresholds; exit 0
   * 'fail'    — statistical regression (TOST/uniform-match failed) or version-mismatch skips; exit 1
   * 'warning' — fallback threshold breach (no statistical backing) or all evaluators skipped (no data); exit 0
   */
  gate: 'pass' | 'warning' | 'fail';
  stabilityLevel: StabilityLevel;
  evaluators: RegressionEvalResult[];
}

/**
 * Extracts non-undefined git fields from metadata for spreading into
 * baseline save options. Preserves explicit null (meaning "git info
 * unavailable") while omitting undefined (meaning "field absent").
 */
export function pickGitFields(
  meta: { gitSha?: string | null; gitBranch?: string | null } | null | undefined,
): { gitSha?: string | null; gitBranch?: string | null } {
  if (!meta) return {};
  const result: { gitSha?: string | null; gitBranch?: string | null } = {};
  if (meta.gitSha !== undefined) result.gitSha = meta.gitSha;
  if (meta.gitBranch !== undefined) result.gitBranch = meta.gitBranch;
  return result;
}
