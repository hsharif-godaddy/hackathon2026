import type { EvalResult } from './evaluator.js';
import type { TrialTokenData } from './token-usage-collector.js';
import type { ProbeUsage } from '../clients/gocode-client.js';
import {
  ProbeUsageEvaluator,
  type ProbeUsageEvaluatorOptions,
  type ProbeUsageMeasurement,
} from './probe-usage-evaluator.js';
// Shared pricing table — only the output column is consumed here.
import { MODEL_PRICING } from './model-pricing.js';

/**
 * Output-cost-only sibling of {@link LLMCostEvaluator}.
 *
 * Output tokens are priced at ~5x input, so output cost is where prompt-side
 * levers (compression, output constraints, framing) show up in dollars. The
 * headline `llm-cost` evaluator scores on TOTAL cost, which on a tool-heavy
 * agent is ~99% cached input — drowning the output-cost signal the cheat sheet
 * targets. This evaluator gates output cost on its own so the lever is directly
 * measurable.
 *
 * Score = AAB-only output cost (mirrors LLMCostEvaluator's AAB-only convention).
 */
export class OutputCostEvaluator extends ProbeUsageEvaluator {
  readonly name = 'output-cost';

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
    const probeOutputCost = unknownModel
      ? 0
      : computeProbeOutputCost(probeDelta, probeModel);

    const aabOutputCost = aabData.outputCost;
    const totalOutputCost = aabOutputCost + probeOutputCost;

    const details = {
      aab: buildAabDetails(aabData),
      probe: {
        outputCost: probeOutputCost,
        completionTokens: probeDelta.completionTokens,
        model: probeModel ?? 'unknown',
      },
      total: { outputCostUsd: totalOutputCost },
    };

    const unknownModelNote = unknownModel
      ? ` (probe model "${probeModel}" not in pricing table, probe output cost=0)`
      : '';

    // Score uses AAB-only output cost: regression detection targets agent
    // output cost, not probe overhead which varies with model and prompt length.
    return {
      evaluator: this.name,
      score: aabOutputCost,
      verdict: 'directional',
      reason:
        `aab=$${aabOutputCost.toFixed(4)} probe=$${probeOutputCost.toFixed(4)}` +
        ` total=$${totalOutputCost.toFixed(4)} output cost` +
        unknownModelNote,
      details,
    };
  }
}

function computeProbeOutputCost(
  delta: ProbeUsage,
  model: string | undefined,
): number {
  if (!model) return 0;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (delta.completionTokens / 1000) * pricing.outputCostPer1K;
}

function buildAabDetails(
  data: TrialTokenData | null,
): Record<string, number | string> {
  return {
    outputCost: data?.outputCost ?? 0,
    inputCost: data?.inputCost ?? 0,
    totalCost: data?.totalCost ?? 0,
    currency: data?.currency ?? 'USD',
    lastModelName: data?.lastModelName ?? '',
  };
}
