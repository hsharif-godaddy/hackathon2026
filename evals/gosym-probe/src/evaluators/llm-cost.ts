import type { EvalResult } from './evaluator.js';
import type { TrialTokenData } from './token-usage-collector.js';
import type { ProbeUsage } from '../clients/gocode-client.js';
import {
  ProbeUsageEvaluator,
  type ProbeUsageEvaluatorOptions,
  type ProbeUsageMeasurement,
} from './probe-usage-evaluator.js';
import { MODEL_PRICING } from './model-pricing.js';

export class LLMCostEvaluator extends ProbeUsageEvaluator {
  readonly name = 'llm-cost';

  private readonly probeModel: string | undefined;

  constructor(options: ProbeUsageEvaluatorOptions & { probeModel?: string }) {
    super(options);
    this.probeModel = options.probeModel;
  }

  protected get noDataReason(): string {
    return 'no cost data available for this trial (collector returned null)';
  }

  protected score({ aabData, probeDelta }: ProbeUsageMeasurement): EvalResult {
    const { probeModel } = this;

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
