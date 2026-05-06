import type { Transcript } from './transcript.js';
import type { EvalResult } from '../evaluators/evaluator.js';
import type {
  Scenario,
  StabilityLevel,
} from '../scenarios/types.js';
import type { RegressionResult } from '../baselines/types.js';

export interface TrialResult {
  trialIndex: number;
  transcript: Transcript;
  evalResults: EvalResult[];
}

export interface AggregatedResult {
  /** At least one trial passed. */
  passAtK: boolean;
  /** All trials passed. */
  passToTheK: boolean;
  passingTrials: number;
  /** Total number of trials run (includes all verdicts). */
  totalTrials: number;
  /** Median score across non-unknown trials; present only for score-mode evaluators. */
  medianScore?: number;
  /**
   * Regression comparison mode for this evaluator.
   * Absent / 'passRate': compare pass-rate across trials (default).
   * 'score': compare median score via relative delta.
   */
  regressionMode?: 'passRate' | 'score';
}

export interface ScenarioResult {
  scenarioName: string;
  category: Scenario['category'];
  stabilityLevel: StabilityLevel;
  trials: TrialResult[];
  /** Keyed by evaluator name. */
  aggregated: Record<string, AggregatedResult>;
  /** Populated after baseline comparison; absent when skipped. */
  regressionStatus?: RegressionResult;
}
