export interface TokenRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

const records: TokenRecord[] = [];

// Approximate pricing per million tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5': { input: 2.00, output: 8.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
};
const DEFAULT_PRICING = { input: 2.00, output: 8.00 };

export function track(record: TokenRecord): void {
  records.push(record);
}

export function reset(): void {
  records.length = 0;
}

export interface CostSummary {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  estimatedCost: number;
}

function estimate(): CostSummary {
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let estimatedCost = 0;

  for (const r of records) {
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
    reasoningTokens += r.reasoningTokens;

    const pricing = PRICING[r.model] ?? DEFAULT_PRICING;
    estimatedCost += (r.promptTokens / 1_000_000) * pricing.input;
    estimatedCost += (r.completionTokens / 1_000_000) * pricing.output;
  }

  return { calls: records.length, promptTokens, completionTokens, reasoningTokens, estimatedCost };
}

export function print(): void {
  const s = estimate();
  if (!s.calls) {
    console.log('\n  No LLM calls recorded.');
    return;
  }

  const sep = '-'.repeat(55);
  console.log(`\n  LLM Cost Summary:`);
  console.log(`  ${sep}`);
  console.log(`  API calls:             ${s.calls}`);
  console.log(`  Prompt tokens:         ${s.promptTokens.toLocaleString()}`);
  console.log(`  Completion tokens:     ${s.completionTokens.toLocaleString()}`);
  if (s.reasoningTokens > 0) {
    console.log(`    ↳ Reasoning tokens:  ${s.reasoningTokens.toLocaleString()}`);
    console.log(`    ↳ Output tokens:     ${(s.completionTokens - s.reasoningTokens).toLocaleString()}`);
  }
  console.log(`  Estimated cost:        $${s.estimatedCost.toFixed(4)}`);
  console.log(`  ${sep}`);
}
