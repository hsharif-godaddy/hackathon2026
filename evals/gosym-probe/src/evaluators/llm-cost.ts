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

// Pricing for models gosym-probe actually uses.
// Source: Anthropic pricing (ai-lib/src/utils/model-pricing.ts reference).
// Units: USD per 1K tokens.
const MODEL_PRICING: Record<
  string,
  { inputCostPer1K: number; outputCostPer1K: number }
> = {
  'claude-sonnet-4-6': { inputCostPer1K: 0.003, outputCostPer1K: 0.015 },
  'claude-sonnet-4-5': { inputCostPer1K: 0.003, outputCostPer1K: 0.015 },
  'claude-opus-4-6': { inputCostPer1K: 0.015, outputCostPer1K: 0.075 },
  'claude-haiku-4-5': { inputCostPer1K: 0.0008, outputCostPer1K: 0.004 },
};

export class LLMCostEvaluator implements Evaluator {
  readonly name = 'llm-cost';
  readonly deterministic = false;
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = true;

  private readonly baselines = new Map<number, ProbeUsage>();
  private readonly afterSnapshots = new Map<number, ProbeUsage>();

  constructor(
    private readonly options: {
      collector: TokenUsageCollector;
      gocodeClient: ProbeUsageSource;
      probeModel?: string;
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
    const { collector, gocodeClient, probeModel } = this.options;
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
        reason: 'no cost data available for this trial (collector returned null)',
      };
    }

    const probeEnd = this.afterSnapshots.get(trialIndex) ?? gocodeClient.getAccumulatedUsage();
    this.afterSnapshots.delete(trialIndex);
    const probeDelta = computeProbeDelta(probeEnd, baseline);

    const unknownModel =
      probeModel !== undefined && !(probeModel in MODEL_PRICING);
    const probeCost = unknownModel
      ? 0
      : computeProbeCost(probeDelta, probeModel);

    const aabCost = aabData.totalCost;
    const totalCost = aabCost + probeCost;

    const details = {
      aab: buildAabDetails(aabData),
      probe: {
        cost: probeCost,
        promptTokens: probeDelta.promptTokens,
        completionTokens: probeDelta.completionTokens,
        model: probeModel ?? 'unknown',
      },
      total: { costUsd: totalCost },
    };

    const unknownModelNote = unknownModel
      ? ` (probe model "${probeModel}" not in pricing table, probe cost=0)`
      : '';

    // Score uses AAB-only cost: regression detection targets agent cost,
    // not probe overhead which varies with model choice and prompt length.
    return {
      evaluator: this.name,
      score: aabCost,
      verdict: 'observed',
      reason:
        `aab=$${aabCost.toFixed(4)} probe=$${probeCost.toFixed(4)}` +
        ` total=$${totalCost.toFixed(4)}` +
        unknownModelNote,
      details,
    };
  }
}

function computeProbeCost(
  delta: ProbeUsage,
  model: string | undefined,
): number {
  if (!model) return 0;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (
    (delta.promptTokens / 1000) * pricing.inputCostPer1K +
    (delta.completionTokens / 1000) * pricing.outputCostPer1K
  );
}

function buildAabDetails(
  data: TrialTokenData | null,
): Record<string, number | string> {
  return {
    totalCost: data?.totalCost ?? 0,
    inputCost: data?.inputCost ?? 0,
    outputCost: data?.outputCost ?? 0,
    cachedInputCost: data?.cachedInputCost ?? 0,
    savings: data?.savings ?? 0,
    currency: data?.currency ?? 'USD',
    lastModelName: data?.lastModelName ?? '',
  };
}
