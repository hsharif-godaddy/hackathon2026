import type { Evaluator } from './evaluator.js';
import type { ProbeUsageSource } from '../clients/gocode-client.js';
import { TokenUsageCollector } from './token-usage-collector.js';
import { TokenUsageEvaluator } from './token-usage.js';
import { LLMCostEvaluator } from './llm-cost.js';
import { OutputTokenUsageEvaluator } from './output-token-usage.js';
import { OutputCostEvaluator } from './output-cost.js';

export function createTokenEvaluators(
  gocode: ProbeUsageSource & { getModel(): string },
): Evaluator[] {
  // Single shared collector → one token_usage_summary listener per trial,
  // reused across all four token/cost evaluators.
  const collector = new TokenUsageCollector();
  return [
    new TokenUsageEvaluator({ collector, gocodeClient: gocode }),
    new LLMCostEvaluator({
      collector,
      gocodeClient: gocode,
      probeModel: gocode.getModel(),
    }),
    // Output-only siblings: isolate the cheat-sheet lever (output tokens,
    // priced ~5x input) from the cached-input total that swamps it.
    new OutputTokenUsageEvaluator({ collector, gocodeClient: gocode }),
    new OutputCostEvaluator({
      collector,
      gocodeClient: gocode,
      probeModel: gocode.getModel(),
    }),
  ];
}
