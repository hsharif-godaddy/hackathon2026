import type { EvalResult, Evaluator } from './evaluator.js';
import type {
  DOMSnapshot,
  Transcript,
} from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { AgentClient } from '../clients/agent-client.js';
import type {
  TokenUsageCollector,
  TrialTokenData,
} from './token-usage-collector.js';
import type {
  ProbeUsage,
  ProbeUsageSource,
} from '../clients/gocode-client.js';
import { computeProbeDelta } from './eval-utils.js';

export interface ProbeUsageEvaluatorOptions {
  collector: TokenUsageCollector;
  gocodeClient: ProbeUsageSource;
}

/**
 * Per-trial inputs a concrete token/cost evaluator scores on, resolved by the
 * shared lifecycle once the baseline and AAB data are both confirmed present.
 */
export interface ProbeUsageMeasurement {
  /** Accumulated AAB-side token/cost data for the trial (never null here). */
  readonly aabData: TrialTokenData;
  /** Probe (synthetic-user) usage for the trial: afterSnapshot − baseline. */
  readonly probeDelta: ProbeUsage;
}

/**
 * Shared lifecycle for the AAB token/cost score-mode evaluators
 * (`token-usage`, `llm-cost`, `output-token-usage`, `output-cost`).
 *
 * These four differ only in how they turn a trial's AAB data + probe delta into
 * a score; the surrounding bookkeeping is identical and was previously copied
 * verbatim across all four files (per-trial baseline/after-snapshot Maps, the
 * collector hook/unhook delegation, and the evaluate() prologue that guards the
 * missing-baseline and null-collector paths before computing the probe delta).
 * Centralizing it here means a lifecycle fix lands once instead of four times.
 *
 * Subclasses implement {@link score}; the base owns everything else.
 */
export abstract class ProbeUsageEvaluator implements Evaluator {
  abstract readonly name: string;
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = true;

  protected readonly collector: TokenUsageCollector;
  protected readonly gocodeClient: ProbeUsageSource;

  // Per-trial probe-usage snapshots. baselines is captured at hookClient (trial
  // start); afterSnapshots at afterSimulation (trial end). evaluate() diffs
  // after − baseline so the probe delta reflects only this trial's overhead,
  // even when trials run concurrently and share the accumulating gocodeClient.
  private readonly baselines = new Map<number, ProbeUsage>();
  private readonly afterSnapshots = new Map<number, ProbeUsage>();

  constructor(options: ProbeUsageEvaluatorOptions) {
    this.collector = options.collector;
    this.gocodeClient = options.gocodeClient;
  }

  hookClient(client: AgentClient, trialIndex: number): void {
    this.collector.hook(client, trialIndex);
    this.baselines.set(trialIndex, this.gocodeClient.getAccumulatedUsage());
  }

  afterSimulation(trialIndex: number): void {
    this.afterSnapshots.set(
      trialIndex,
      this.gocodeClient.getAccumulatedUsage(),
    );
  }

  unhookTrial(trialIndex: number): void {
    this.collector.unhook(trialIndex);
    this.baselines.delete(trialIndex);
    this.afterSnapshots.delete(trialIndex);
  }

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const { trialIndex } = transcript;

    const baseline = this.baselines.get(trialIndex);
    this.baselines.delete(trialIndex);

    if (baseline === undefined) {
      return this.unknown(
        'evaluate() called without a prior hookClient() for this trial',
      );
    }

    const aabData = this.collector.collect(trialIndex);
    if (aabData === null) {
      return this.unknown(this.noDataReason);
    }

    const probeEnd =
      this.afterSnapshots.get(trialIndex) ??
      this.gocodeClient.getAccumulatedUsage();
    this.afterSnapshots.delete(trialIndex);
    const probeDelta = computeProbeDelta(probeEnd, baseline);

    return this.score({ aabData, probeDelta });
  }

  /**
   * Reason surfaced when the collector has no data for the trial. Subclasses
   * override to use their own noun ("token data" / "cost data"); the
   * "(collector returned null)" suffix is shared so callers can match on it.
   */
  protected get noDataReason(): string {
    return 'no data available for this trial (collector returned null)';
  }

  /** Turn the resolved per-trial measurement into the evaluator's result. */
  protected abstract score(measurement: ProbeUsageMeasurement): EvalResult;

  private unknown(reason: string): EvalResult {
    return {
      evaluator: this.name,
      score: 0,
      verdict: 'unknown',
      reason,
    };
  }
}
