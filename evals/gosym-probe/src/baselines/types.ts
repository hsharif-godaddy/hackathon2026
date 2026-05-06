import type { Scenario, StabilityLevel } from '../scenarios/types.js';

export interface BaselineEvalScores {
  passAtK: boolean;
  passToTheK: boolean;
  passingTrials: number;
  totalTrials: number;
  /** Median score across trials; populated for score-mode evaluators. */
  medianScore?: number;
}

export interface BaselineScores {
  scenarioName: string;
  runId: string;
  createdAt: string;
  category: Scenario['category'];
  stabilityLevel?: StabilityLevel;
  stabilityTrials?: number;
  /** Keyed by evaluator name. */
  scores: Record<string, BaselineEvalScores>;
  /**
   * Per-evaluator regression thresholds for score-mode evaluators.
   * Keyed by evaluator name. Written by save-baseline on first save;
   * preserved on subsequent saves to allow manual tuning.
   */
  regressionThresholds?: Record<string, number>;
}

export interface RegressionEvalResult {
  evaluator: string;
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
  /** currentScore - baselineScore; NaN if either is NaN. */
  delta: number;
  /**
   * Pass-rate mode: true when absolute drop exceeds
   * threshold.
   * Score mode: true when relative drop
   * (baseline - current) / baseline exceeds threshold.
   * False for NaN scores, missing baseline, or zero
   * baseline score.
   */
  exceeded: boolean;
}

export interface RegressionResult {
  scenarioName: string;
  category: Scenario['category'];
  hasBaseline: boolean;
  /**
   * 'warning'          — low-stability scenario with threshold breach; exit 0
   * 'error'            — medium-stability scenario with threshold breach;
   *                      exit 1
   * 'critical'         — high-stability scenario with threshold breach; exit 1
   * 'pass'             — regression-category scenario within thresholds
   * 'informational'    — capability-category scenario; never blocks
   * 'missing-baseline' — regression-category scenario with no saved baseline;
   *                      blocks the run (save a baseline first via
   *                      save-baseline <run-id>)
   */
  gate:
    | 'pass'
    | 'warning'
    | 'error'
    | 'critical'
    | 'informational'
    | 'missing-baseline';
  stabilityLevel: StabilityLevel;
  evaluators: RegressionEvalResult[];
}
