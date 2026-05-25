import type { Transcript } from './transcript.js';
import type { EvalResult } from '../evaluators/evaluator.js';
import type { StabilityLevel } from '../scenarios/types.js';
import type { RegressionResult } from '../baselines/types.js';

export interface TrialResult {
  trialIndex: number;
  transcript: Transcript;
  evalResults: EvalResult[];
}

export interface AggregatedResult {
  /**
   * At least one trial passed. For pass-rate evaluators this is always present.
   * For score-mode evaluators (`regressionMode === 'score'`): present when a
   * baseline exists and is derived from per-trial comparison against the
   * baseline aggregate score; absent when no baseline is available.
   */
  passAtK?: boolean;
  /**
   * All trials passed. For pass-rate evaluators this is always present.
   * For score-mode evaluators (`regressionMode === 'score'`): present when a
   * baseline exists and is derived from per-trial comparison against the
   * baseline aggregate score; absent when no baseline is available.
   */
  passToTheK?: boolean;
  /**
   * Count of trials that passed based on their own verdict (verdict === 'pass').
   */
  passingTrials: number;
  /**
   * Count of trials whose score fell within the regression threshold of the
   * baseline aggregate score. Only present for enriched score-mode evaluators with a
   * baseline comparison.
   */
  baselinePassingTrials?: number;
  /** Total number of trials run (excludes evaluator-failed trials). */
  totalTrials: number;
  /** Number of trials where the evaluator itself failed (e.g. judge parse error). */
  failedTrials?: number;
  /** Aggregate score across non-unknown trials; present only for score-mode evaluators. */
  aggregateScore?: number;
  /**
   * Regression comparison mode for this evaluator.
   * Absent / 'passRate': compare pass-rate across trials (default).
   * 'score': compare aggregate score via relative delta.
   */
  regressionMode?: 'passRate' | 'score';
  evalVersion?: string;
  /**
   * When true, a score increase is treated as a regression.
   * Propagated from Evaluator.lowerIsBetter.
   */
  lowerIsBetter?: boolean;
}

export interface ScenarioResult {
  scenarioName: string;
  stabilityLevel: StabilityLevel;
  trials: TrialResult[];
  /** Keyed by evaluator name. */
  aggregated: Record<string, AggregatedResult>;
  /** Populated after baseline comparison; absent when skipped. */
  regressionStatus?: RegressionResult;
  /** Path to the baseline file used for regression comparison, when one was loaded. */
  baselineFilePath?: string;
  /** Number of trials that failed during execution and were dropped from aggregation. */
  droppedTrials?: number;
}
