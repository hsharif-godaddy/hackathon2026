import type {
  DOMSnapshot,
  Transcript,
} from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type {
  AgentClient,
} from '../clients/agent-client.js';

export interface EvalResult {
  evaluator: string;
  /**
   * Evaluator-specific numeric score.
   * - Non-observed-verdict evaluators: normalized to [0.0, 1.0].
   * - Observed-verdict evaluators (regressionMode: 'score'): either a
   *   normalized (0,1) value (e.g. sigmoid-mapped counts) or an
   *   unclamped raw measurement (e.g. token count, USD cost),
   *   depending on the evaluator.
   */
  score: number;
  verdict: 'pass' | 'partial' | 'fail' | 'unknown' | 'observed';
  reason: string;
  details?: Record<string, unknown>;
  evalVersion?: string;
  /** True when this result was synthesized due to an evaluator exception. */
  evaluatorFailed?: boolean;
}

export interface Evaluator {
  name: string;
  evalVersion?: string;
  /**
   * Controls how RegressionComparator handles this evaluator.
   * - 'passRate' (default): compare pass-rate across trials
   * - 'score': compare median score across trials
   */
  regressionMode?: 'passRate' | 'score';
  /**
   * When true, a score *increase* is treated as a regression (lower is better).
   * Only meaningful when regressionMode is 'score'.
   */
  lowerIsBetter?: boolean;
  evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult>;

  /**
   * Optional per-trial hook called by SuiteRunner before
   * each trial's simulation starts. Register event
   * listeners on the client here (e.g. timing collectors).
   */
  hookClient?(
    client: AgentClient,
    trialIndex: number,
  ): void;

  /**
   * Optional hook called by SuiteRunner immediately after each trial's
   * simulation completes (success only). Snapshot per-trial probe usage
   * here so evaluate() can diff afterSnapshot - baseline instead of
   * liveState - baseline.
   */
  afterSimulation?(trialIndex: number): void;

  /**
   * Optional cleanup called by SuiteRunner after each
   * trial completes or crashes. Implementations must be
   * idempotent (no-op if trial data was already consumed
   * by evaluate()).
   */
  unhookTrial?(trialIndex: number): void;
}
