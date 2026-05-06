import type { Evaluator } from './evaluator.js';
import type { ProbeUsageSource } from '../clients/gocode-client.js';
import { TokenUsageCollector } from './token-usage-collector.js';
import { TokenUsageEvaluator } from './token-usage.js';
import { LLMCostEvaluator } from './llm-cost.js';

export function createTokenEvaluators(
  gocode: ProbeUsageSource & { getModel(): string },
): Evaluator[] {
  const collector = new TokenUsageCollector();
  return [
    new TokenUsageEvaluator({ collector, gocodeClient: gocode }),
    new LLMCostEvaluator({
      collector,
      gocodeClient: gocode,
      probeModel: gocode.getModel(),
    }),
  ];
}
