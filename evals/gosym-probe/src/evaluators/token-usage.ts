import type { EvalResult } from './evaluator.js';
import type { TrialTokenData } from './token-usage-collector.js';
import {
  ProbeUsageEvaluator,
  type ProbeUsageMeasurement,
} from './probe-usage-evaluator.js';

export class TokenUsageEvaluator extends ProbeUsageEvaluator {
  readonly name = 'token-usage';

  protected get noDataReason(): string {
    return 'no token data available for this trial (collector returned null)';
  }

  protected score({ aabData, probeDelta }: ProbeUsageMeasurement): EvalResult {
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
