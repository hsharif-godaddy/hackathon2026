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
   * Evaluator-specific numeric score in [0.0, 1.0].
   */
  score: number;
  verdict: 'pass' | 'partial' | 'fail' | 'unknown' | 'observed';
  reason: string;
  details?: Record<string, unknown>;
}

export interface Evaluator {
  name: string;
  deterministic: boolean;
  /**
   * Controls how RegressionComparator handles this evaluator.
   * - 'passRate' (default): compare pass-rate across trials
   * - 'score': compare median score across trials
   */
  regressionMode?: 'passRate' | 'score';
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
