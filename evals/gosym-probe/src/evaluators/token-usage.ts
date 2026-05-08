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

export class TokenUsageEvaluator implements Evaluator {
  readonly name = 'token-usage';
  readonly deterministic = false;
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = true;

  private readonly baselines = new Map<number, ProbeUsage>();
  private readonly afterSnapshots = new Map<number, ProbeUsage>();

  constructor(
    private readonly options: {
      collector: TokenUsageCollector;
      gocodeClient: ProbeUsageSource;
    },
  ) {}

  hookClient(client: AgentClient, trialIndex: number): void {
    this.options.collector.hook(client, trialIndex);
    this.baselines.set(
      trialIndex,
      this.options.gocodeClient.getAccumulatedUsage(),
    );
  }

  // In parallel execution mode, the shared GocodeClient accumulator may
  // include tokens from concurrent trials. Probe deltas are approximate
  // when trials overlap. Accurate per-trial isolation requires per-trial
  // GocodeClient instances.
  afterSimulation(trialIndex: number): void {
    this.afterSnapshots.set(trialIndex, this.options.gocodeClient.getAccumulatedUsage());
  }

  unhookTrial(trialIndex: number): void {
    this.options.collector.unhook(trialIndex);
    this.baselines.delete(trialIndex);
    this.afterSnapshots.delete(trialIndex);
  }

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const { collector, gocodeClient } = this.options;
    const { trialIndex } = transcript;

    const baseline = this.baselines.get(trialIndex);
    this.baselines.delete(trialIndex);

    if (baseline === undefined) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'evaluate() called without a prior hookClient() for this trial',
      };
    }

    const aabData = collector.collect(trialIndex);
    if (aabData === null) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'no token data available for this trial (collector returned null)',
      };
    }

    const probeEnd = this.afterSnapshots.get(trialIndex) ?? gocodeClient.getAccumulatedUsage();
    this.afterSnapshots.delete(trialIndex);
    const probeDelta = computeProbeDelta(probeEnd, baseline);

    const aabTotalTokens = aabData.totalTokens;
    const totalTokens = aabTotalTokens + probeDelta.totalTokens;

    const details = {
      aab: buildAabDetails(aabData),
      probe: {
        promptTokens: probeDelta.promptTokens,
        completionTokens: probeDelta.completionTokens,
        totalTokens: probeDelta.totalTokens,
        calls: probeDelta.calls,
      },
      total: { tokens: totalTokens },
    };

    // Score uses AAB-only tokens: regression detection targets agent cost,
    // not probe overhead which varies with model choice and prompt length.
    return {
      evaluator: this.name,
      score: aabTotalTokens,
      verdict: 'observed',
      reason:
        `aab=${aabTotalTokens} probe=${probeDelta.totalTokens}` +
        ` total=${totalTokens} tokens`,
      details,
    };
  }

}

function buildAabDetails(
  data: TrialTokenData | null,
): Record<string, number> {
  return {
    inputTokens: data?.inputTokens ?? 0,
    outputTokens: data?.outputTokens ?? 0,
    totalTokens: data?.totalTokens ?? 0,
    cachedInputTokensRead: data?.cachedInputTokensRead ?? 0,
    cachedInputTokensWrite: data?.cachedInputTokensWrite ?? 0,
  };
}
