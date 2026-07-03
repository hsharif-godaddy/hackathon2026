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
   * - Non-directional-verdict evaluators: normalized to [0.0, 1.0].
   * - Directional-verdict evaluators (comparisonMode: 'score'): unclamped
   *   raw measurement (e.g. step count, turn count, token count, seconds).
   */
  score: number;
  verdict: 'pass' | 'fail' | 'incomplete' | 'directional';
  reason: string;
  details?: Record<string, unknown>;
  evalVersion?: string;
  /** True when this result was synthesized due to an evaluator exception. */
  evaluatorFailed?: boolean;
  /** Baseline comparison annotation added by score-mode enrichment. */
  baselineComparison?: string;
}

export interface Evaluator {
  name: string;
  evalVersion?: string;
  /**
   * Controls how RegressionComparator handles this evaluator.
   * - 'passRate': compare pass-rate across trials
   * - 'score': compare aggregate score across trials
   */
  comparisonMode: 'passRate' | 'score';
  /**
   * When true, a score *increase* is treated as a regression (lower is better).
   * Only meaningful when comparisonMode is 'score'.
   */
  lowerIsBetter?: boolean;
  /**
   * When true, this evaluator GATES the scenario: a crash (a synthesized
   * `evaluatorFailed` result) must count as a hard fail in pass@k rather than
   * being dropped from the trial sample. A gate that could not run is a broken
   * gate, and a broken gate must fail loud — not silently shrink the denominator
   * (the same fail-open class the skill-eval `requireSkillDiagnostics` work
   * closes, on the aggregation path). Default (false): a crashed trial is
   * excluded from the sample, the historical behavior for best-effort metrics
   * (e.g. an LLM judge parse error).
   */
  gating?: boolean;
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
