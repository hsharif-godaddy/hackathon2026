import type { StabilityLevel } from '../scenarios/types.js';

export interface BaselineEvalScores {
  /** Absent when regressionMode === 'score'. */
  passAtK?: boolean;
  /** Absent when regressionMode === 'score'. */
  passToTheK?: boolean;
  passingTrials: number;
  totalTrials: number;
  /** Median score across trials; populated for score-mode evaluators. */
  medianScore?: number;
  evalVersion?: string;
  /** When true, score increase = regression. Present only for score-mode evaluators. */
  lowerIsBetter?: boolean;
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

export interface ComparedRegressionEvalResult extends RegressionEvalResultBase {
  type: 'compared';
  /**
   * Pass-rate mode: passingTrials / totalTrials.
   * Score mode: median score across trials.
   * NaN when no data is available.
   */
  currentScore: number;
  /**
   * Pass-rate mode: baseline passingTrials / totalTrials.
   * Score mode: baseline median score.
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
   * Pass-rate mode: true when absolute drop exceeds threshold.
   * Score mode (higher-is-better): true when relative drop
   *   (baseline - current) / baseline exceeds threshold.
   * Score mode (lowerIsBetter): true when relative increase
   *   (current - baseline) / baseline exceeds threshold.
   * False for NaN scores, missing baseline, or zero baseline score.
   */
  exceeded: boolean;
  skipped?: boolean;
  skipReason?: string;
  currentEvalVersion?: string;
  baselineEvalVersion?: string;
}

export interface SkippedRegressionEvalResult extends RegressionEvalResultBase {
  type: 'skipped';
  skipReason: string;
}

export type RegressionEvalResult = ComparedRegressionEvalResult | SkippedRegressionEvalResult;

export interface RegressionResult {
  scenarioName: string;
  /**
   * 'warning'  — low-stability scenario with threshold breach; exit 0
   * 'error'    — medium-stability scenario with threshold breach; exit 1
   * 'critical' — high-stability scenario with threshold breach; exit 1
   * 'pass'     — scenario within thresholds
   */
  gate:
    | 'pass'
    | 'warning'
    | 'error'
    | 'critical'
    | 'version-skipped';
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
