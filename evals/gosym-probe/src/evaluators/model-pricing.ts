// Pricing for the *probe* (synthetic-user) models gosym-probe actually uses.
// Source: Anthropic pricing (ai-lib/src/utils/model-pricing.ts reference).
// Units: USD per 1K tokens.
//
// Single source of truth shared by the cost evaluators (llm-cost = total cost,
// output-cost = output-only). Keeping one table prevents the two arms from
// silently diverging if a price changes — a per-model update here updates both.
//
// STALENESS: this is a hand-maintained mirror with no live link to the upstream
// ai-lib pricing table, so a price change or a new probe model lands here only
// when someone updates it. When you verify/refresh these numbers against
// Anthropic's published pricing, bump MODEL_PRICING_LAST_VERIFIED. The
// model-pricing unit test guards the table's shape and known-model coverage,
// and an unknown probe model degrades gracefully (probe cost = 0, surfaced in
// the evaluator reason) rather than silently mispricing.

export interface ModelPricing {
  inputCostPer1K: number;
  outputCostPer1K: number;
}

/** ISO date the prices below were last reconciled with upstream Anthropic pricing. */
export const MODEL_PRICING_LAST_VERIFIED = '2026-06-09';

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': { inputCostPer1K: 0.003, outputCostPer1K: 0.015 },
  'claude-sonnet-4-5': { inputCostPer1K: 0.003, outputCostPer1K: 0.015 },
  'claude-opus-4-6': { inputCostPer1K: 0.015, outputCostPer1K: 0.075 },
  'claude-haiku-4-5': { inputCostPer1K: 0.0008, outputCostPer1K: 0.004 },
};
