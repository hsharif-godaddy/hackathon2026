import type { EvalResult } from './evaluator.js';
import type { TrialTokenData } from './token-usage-collector.js';
import {
  ProbeUsageEvaluator,
  type ProbeUsageMeasurement,
} from './probe-usage-evaluator.js';

/**
 * Output-token-only sibling of {@link TokenUsageEvaluator}.
 *
 * Output tokens are priced at ~5x input and are the lever the prompting-tax
 * cheat sheet actually pulls (compression, output constraints, emotional
 * framing). The headline `token-usage` evaluator scores on TOTAL tokens, where
 * a tool-heavy agent's ~1.16M cached input swamps the ~13K output signal. This
 * evaluator surfaces output tokens as a first-class, separately-gated metric so
 * the cheat-sheet lever is directly measurable instead of buried in the total.
 *
 * Score = AAB-only output tokens (mirrors TokenUsageEvaluator's AAB-only
 * convention: regression detection targets agent output, not probe overhead
 * which varies with model choice and prompt length).
 */
export class OutputTokenUsageEvaluator extends ProbeUsageEvaluator {
  readonly name = 'output-token-usage';

  protected get noDataReason(): string {
    return 'no token data available for this trial (collector returned null)';
  }

  protected score({ aabData, probeDelta }: ProbeUsageMeasurement): EvalResult {
    const aabOutputTokens = aabData.outputTokens;
    // Probe's completion tokens are its output tokens.
    const totalOutputTokens = aabOutputTokens + probeDelta.completionTokens;

    const details = {
      aab: buildAabDetails(aabData),
      probe: {
        completionTokens: probeDelta.completionTokens,
        calls: probeDelta.calls,
      },
      total: { outputTokens: totalOutputTokens },
    };

    // Score uses AAB-only output tokens: regression detection targets agent
    // output, not probe overhead which varies with model and prompt length.
    return {
      evaluator: this.name,
      score: aabOutputTokens,
      verdict: 'observed',
      reason:
        `aab=${aabOutputTokens} probe=${probeDelta.completionTokens}` +
        ` total=${totalOutputTokens} output tokens`,
      details,
    };
  }
}

function buildAabDetails(
  data: TrialTokenData | null,
): Record<string, number> {
  return {
    outputTokens: data?.outputTokens ?? 0,
    inputTokens: data?.inputTokens ?? 0,
    totalTokens: data?.totalTokens ?? 0,
  };
}
