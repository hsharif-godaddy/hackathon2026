/**
 * Summarization Cost Model Calculator
 *
 * Calculates break-even points for different summarization scenarios.
 * Accounts for caching within agent loops (multiple steps per user request).
 *
 * Usage:
 *   npx tsx scripts/summarization-cost-model.ts [options]
 *
 * Options:
 *   --system-prompt <tokens>        System prompt size (default: 20000)
 *   --template-desc <tokens>        Template description size (default: 10000)
 *   --summary-size <tokens>         Summary size after compression (default: 1500)
 *   --summarize-threshold <tokens>  When to trigger summarization (default: 10000)
 *   --cached-pairs <count>          Message/response pairs kept unsummarized (default: 4)
 *   --tokens-per-pair <tokens>      Tokens per message/response pair (default: 2000)
 *   --output-tokens <tokens>        Average output tokens per response (default: 1000)
 *   --steps-per-request <count>     Agent loop steps per user request (default: 6)
 *   --scenarios                     Run multiple scenarios for comparison
 */

// Bedrock pricing (Claude Sonnet 4.5)
// Source: AWS Bedrock pricing page, February 2026
// Note: Verify pricing at https://aws.amazon.com/bedrock/pricing/ before critical decisions
const PRICING = {
  cacheWrite: 3.75 / 1_000_000,    // $3.75 per million tokens
  cacheRead: 0.30 / 1_000_000,     // $0.30 per million tokens
  input: 3.00 / 1_000_000,         // $3.00 per million tokens
  output: 15.00 / 1_000_000,       // $15.00 per million tokens
};

interface ScenarioParams {
  systemPromptTokens: number;
  templateDescTokens: number;
  summaryTokens: number;
  summarizeThreshold: number;
  cachedPairs: number;
  tokensPerPair: number;
  outputTokens: number;
  stepsPerRequest: number;  // Agent loop steps per user request
}

interface CostBreakdown {
  cacheablePrefix: number;      // System prompt + template desc + summary
  unsummarizedHistory: number;  // Cached message pairs
  totalInput: number;
  cacheHitCost: number;         // Cost when prefix is cached
  cacheMissCost: number;        // Cost when cache is invalidated
  outputCost: number;
}

function calculateRequestCost(params: ScenarioParams, hasCacheHit: boolean): CostBreakdown {
  const cacheablePrefix = params.systemPromptTokens + params.templateDescTokens + params.summaryTokens;
  const unsummarizedHistory = params.cachedPairs * params.tokensPerPair;
  const totalInput = cacheablePrefix + unsummarizedHistory;

  // Cache behavior:
  // - System prompt + template + summary = stable prefix, CAN be cached
  // - Unsummarized history = changes each user turn, NOT cached between turns
  //   BUT is cached within an agent loop (multiple steps per request)
  //
  // Cache hit: prefix cached, history fresh (steady state)
  // Cache miss: everything fresh (after summarization changes the summary)
  const cacheHitCost = hasCacheHit
    ? (cacheablePrefix * PRICING.cacheRead) + (unsummarizedHistory * PRICING.input)
    : totalInput * PRICING.input;

  const cacheMissCost = totalInput * PRICING.input;
  const outputCost = params.outputTokens * PRICING.output;

  return {
    cacheablePrefix,
    unsummarizedHistory,
    totalInput,
    cacheHitCost,
    cacheMissCost,
    outputCost,
  };
}

/**
 * Calculate cost for a full user request (multiple agent steps)
 * Within the agent loop, the prefix + history is cached between steps
 */
function calculateUserRequestCost(params: ScenarioParams, hasPrefixCached: boolean): number {
  const cacheablePrefix = params.systemPromptTokens + params.templateDescTokens + params.summaryTokens;
  const unsummarizedHistory = params.cachedPairs * params.tokensPerPair;
  const baseContext = cacheablePrefix + unsummarizedHistory;
  const tokensPerStep = 2000; // Approximate tokens added per agent step (tool call + result)

  let totalCost = 0;

  for (let step = 0; step < params.stepsPerRequest; step++) {
    const stepContext = baseContext + (step * tokensPerStep);

    if (step === 0) {
      // First step: prefix may or may not be cached (depends on whether summary just changed)
      if (hasPrefixCached) {
        // Prefix cached, history fresh
        totalCost += (cacheablePrefix * PRICING.cacheRead) + ((stepContext - cacheablePrefix) * PRICING.input);
      } else {
        // Everything fresh (cache miss after summarization)
        totalCost += stepContext * PRICING.input;
      }
    } else {
      // Subsequent steps: entire previous context is cached
      const previousContext = baseContext + ((step - 1) * tokensPerStep);
      const newTokens = tokensPerStep;
      totalCost += (previousContext * PRICING.cacheRead) + (newTokens * PRICING.input);
    }

    // Output cost
    totalCost += params.outputTokens * PRICING.output;
  }

  return totalCost;
}

function calculateSummarizationCost(params: ScenarioParams): number {
  // Summarization processes ~threshold tokens and outputs summary
  const inputCost = params.summarizeThreshold * PRICING.input;
  const outputCost = params.summaryTokens * PRICING.output;
  return inputCost + outputCost;
}

function runScenario(params: ScenarioParams, label: string): void {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Scenario: ${label}`);
  console.log('='.repeat(70));

  // Print parameters
  console.log('\nParameters:');
  console.log(`  System prompt:        ${params.systemPromptTokens.toLocaleString()} tokens`);
  console.log(`  Template description: ${params.templateDescTokens.toLocaleString()} tokens`);
  console.log(`  Summary size:         ${params.summaryTokens.toLocaleString()} tokens`);
  console.log(`  Summarize threshold:  ${params.summarizeThreshold.toLocaleString()} tokens`);
  console.log(`  Cached pairs:         ${params.cachedPairs} pairs (${(params.cachedPairs * params.tokensPerPair).toLocaleString()} tokens)`);
  console.log(`  Output tokens:        ${params.outputTokens.toLocaleString()} tokens`);
  console.log(`  Steps per request:    ${params.stepsPerRequest} (agent loop steps)`);

  // Calculate costs
  const withCacheHit = calculateRequestCost(params, true);
  const withCacheMiss = calculateRequestCost(params, false);
  const summarizationCost = calculateSummarizationCost(params);

  console.log('\nContext composition:');
  console.log(`  Cacheable prefix:     ${withCacheHit.cacheablePrefix.toLocaleString()} tokens`);
  console.log(`    - System prompt:    ${params.systemPromptTokens.toLocaleString()}`);
  console.log(`    - Template desc:    ${params.templateDescTokens.toLocaleString()}`);
  console.log(`    - Summary:          ${params.summaryTokens.toLocaleString()}`);
  console.log(`  Unsummarized history: ${withCacheHit.unsummarizedHistory.toLocaleString()} tokens`);
  console.log(`  Total input:          ${withCacheHit.totalInput.toLocaleString()} tokens`);

  console.log('\nPer-request costs:');
  console.log(`  With cache hit:       $${(withCacheHit.cacheHitCost + withCacheHit.outputCost).toFixed(4)}`);
  console.log(`    - Input (cached):   $${withCacheHit.cacheHitCost.toFixed(4)}`);
  console.log(`    - Output:           $${withCacheHit.outputCost.toFixed(4)}`);
  console.log(`  With cache miss:      $${(withCacheMiss.cacheMissCost + withCacheMiss.outputCost).toFixed(4)}`);
  console.log(`    - Input (fresh):    $${withCacheMiss.cacheMissCost.toFixed(4)}`);
  console.log(`    - Output:           $${withCacheMiss.outputCost.toFixed(4)}`);

  console.log('\nSummarization cost:');
  console.log(`  One-time cost:        $${summarizationCost.toFixed(4)}`);
  console.log(`    - Input (${params.summarizeThreshold.toLocaleString()} tokens): $${(params.summarizeThreshold * PRICING.input).toFixed(4)}`);
  console.log(`    - Output (${params.summaryTokens.toLocaleString()} tokens): $${(params.summaryTokens * PRICING.output).toFixed(4)}`);

  // Calculate break-even using full user request cost (includes agent loop caching)
  // Pre-summarization: system + template + history-to-summarize + cached-pairs
  // Post-summarization: system + template + summary + cached-pairs

  const preSummarizationContext = params.systemPromptTokens + params.templateDescTokens +
    params.summarizeThreshold + (params.cachedPairs * params.tokensPerPair);
  const postSummarizationContext = withCacheHit.totalInput;
  const contextReduction = preSummarizationContext - postSummarizationContext;

  // Create params for pre-summarization scenario (no summary, larger history)
  const preSummarizationParams: ScenarioParams = {
    ...params,
    summaryTokens: 0,  // No summary yet
    cachedPairs: Math.ceil((params.summarizeThreshold + params.cachedPairs * params.tokensPerPair) / params.tokensPerPair),
  };

  // Calculate full user request costs (including agent loop steps)
  const preSummarizationRequestCost = calculateUserRequestCost(preSummarizationParams, true);
  const postSummarizationRequestCostCached = calculateUserRequestCost(params, true);
  const postSummarizationRequestCostCacheMiss = calculateUserRequestCost(params, false);

  const savingsPerUserRequest = preSummarizationRequestCost - postSummarizationRequestCostCached;
  const cacheMissPenalty = postSummarizationRequestCostCacheMiss - postSummarizationRequestCostCached;
  const totalSummarizationPenalty = summarizationCost + cacheMissPenalty;

  console.log('\nBreak-even analysis (with agent loop caching):');
  console.log(`  Pre-summarization context:  ${preSummarizationContext.toLocaleString()} tokens`);
  console.log(`  Post-summarization context: ${postSummarizationContext.toLocaleString()} tokens`);
  console.log(`  Context reduction:          ${contextReduction.toLocaleString()} tokens (${((contextReduction / preSummarizationContext) * 100).toFixed(1)}%)`);
  console.log(`  Pre-summary user request:   $${preSummarizationRequestCost.toFixed(4)} (${params.stepsPerRequest} steps)`);
  console.log(`  Post-summary user request:  $${postSummarizationRequestCostCached.toFixed(4)} (${params.stepsPerRequest} steps, cached)`);
  console.log(`  Savings per user request:   $${savingsPerUserRequest.toFixed(4)}`);
  console.log(`  Summarization penalty:      $${totalSummarizationPenalty.toFixed(4)}`);
  console.log(`    - Summarization call:     $${summarizationCost.toFixed(4)}`);
  console.log(`    - Cache miss penalty:     $${cacheMissPenalty.toFixed(4)}`);

  if (savingsPerUserRequest > 0) {
    const breakEvenRequests = Math.ceil(totalSummarizationPenalty / savingsPerUserRequest);
    console.log(`  Break-even after:           ${breakEvenRequests} user requests`);
  } else {
    console.log(`  Break-even after:           N/A (no savings - consider adjusting parameters)`);
  }

  // Show cost over time
  console.log('\nCumulative cost comparison (user requests after summarization):');
  console.log('  Requests | With Summary | Without Summary | Savings');
  console.log('  ' + '-'.repeat(55));

  for (const n of [1, 2, 5, 10, 20, 50]) {
    // With summarization: summarization cost + 1 cache miss request + (n-1) cached requests
    const withSummary = summarizationCost +
      postSummarizationRequestCostCacheMiss +
      (n - 1) * postSummarizationRequestCostCached;

    // Without summarization: all requests at pre-summarization context size
    const withoutSummary = n * preSummarizationRequestCost;

    const savings = withoutSummary - withSummary;
    const savingsIndicator = savings > 0 ? '+' : '';

    console.log(`  ${n.toString().padStart(8)} | $${withSummary.toFixed(4).padStart(10)} | $${withoutSummary.toFixed(4).padStart(14)} | ${savingsIndicator}$${savings.toFixed(4)}`);
  }
}

function parseArgs(): ScenarioParams & { runScenarios: boolean } {
  const args = process.argv.slice(2);
  const params: ScenarioParams & { runScenarios: boolean } = {
    systemPromptTokens: 20000,
    templateDescTokens: 10000,
    summaryTokens: 1500,
    summarizeThreshold: 10000,
    cachedPairs: 4,
    tokensPerPair: 2000,
    outputTokens: 1000,
    stepsPerRequest: 6,  // Default agent loop steps
    runScenarios: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--system-prompt':
        params.systemPromptTokens = parseInt(next || '20000', 10);
        i++;
        break;
      case '--template-desc':
        params.templateDescTokens = parseInt(next || '10000', 10);
        i++;
        break;
      case '--summary-size':
        params.summaryTokens = parseInt(next || '1500', 10);
        i++;
        break;
      case '--summarize-threshold':
        params.summarizeThreshold = parseInt(next || '10000', 10);
        i++;
        break;
      case '--cached-pairs':
        params.cachedPairs = parseInt(next || '4', 10);
        i++;
        break;
      case '--tokens-per-pair':
        params.tokensPerPair = parseInt(next || '2000', 10);
        i++;
        break;
      case '--output-tokens':
        params.outputTokens = parseInt(next || '1000', 10);
        i++;
        break;
      case '--steps-per-request':
        params.stepsPerRequest = parseInt(next || '6', 10);
        i++;
        break;
      case '--scenarios':
        params.runScenarios = true;
        break;
      case '--help':
        console.log(`
Summarization Cost Model Calculator

Usage:
  npx tsx scripts/summarization-cost-model.ts [options]

Options:
  --system-prompt <tokens>        System prompt size (default: 20000)
  --template-desc <tokens>        Template description size (default: 10000)
  --summary-size <tokens>         Summary size after compression (default: 1500)
  --summarize-threshold <tokens>  When to trigger summarization (default: 10000)
  --cached-pairs <count>          Message/response pairs kept unsummarized (default: 4)
  --tokens-per-pair <tokens>      Tokens per message/response pair (default: 2000)
  --output-tokens <tokens>        Average output tokens per response (default: 1000)
  --steps-per-request <count>     Agent loop steps per user request (default: 6)
  --scenarios                     Run multiple scenarios for comparison
  --help                          Show this help message
`);
        process.exit(0);
    }
  }

  return params;
}

function main(): void {
  console.log('Summarization Cost Model Calculator');
  console.log('Pricing: Bedrock Claude Sonnet 4.5');
  console.log(`  Cache Write: $${(PRICING.cacheWrite * 1_000_000).toFixed(2)}/M tokens`);
  console.log(`  Cache Read:  $${(PRICING.cacheRead * 1_000_000).toFixed(2)}/M tokens`);
  console.log(`  Input:       $${(PRICING.input * 1_000_000).toFixed(2)}/M tokens`);
  console.log(`  Output:      $${(PRICING.output * 1_000_000).toFixed(2)}/M tokens`);

  const params = parseArgs();

  if (params.runScenarios) {
    // Run comparison scenarios
    const results: Array<{ label: string; breakEven: number; savingsAt10: number }> = [];

    for (const cachedPairs of [4, 6, 8, 10]) {
      const scenario = { ...params, cachedPairs };
      runScenario(scenario, `${cachedPairs} cached pairs`);

      // Calculate break-even for summary
      const summarizationCost = calculateSummarizationCost(scenario);
      const preSummarizationParams: ScenarioParams = {
        ...scenario,
        summaryTokens: 0,
        cachedPairs: Math.ceil((scenario.summarizeThreshold + scenario.cachedPairs * scenario.tokensPerPair) / scenario.tokensPerPair),
      };
      const preCost = calculateUserRequestCost(preSummarizationParams, true);
      const postCostCached = calculateUserRequestCost(scenario, true);
      const postCostMiss = calculateUserRequestCost(scenario, false);
      const savingsPerRequest = preCost - postCostCached;
      const penalty = summarizationCost + (postCostMiss - postCostCached);
      const breakEven = savingsPerRequest > 0 ? Math.ceil(penalty / savingsPerRequest) : -1;

      // Calculate savings at 10 requests
      const withSummary = summarizationCost + postCostMiss + 9 * postCostCached;
      const withoutSummary = 10 * preCost;
      const savingsAt10 = withoutSummary - withSummary;

      results.push({ label: `${cachedPairs} pairs`, breakEven, savingsAt10 });
    }

    // Summary table
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY: Impact of Cached Pairs');
    console.log('='.repeat(70));
    console.log('  Cached Pairs | Break-even | Savings at 10 requests');
    console.log('  ' + '-'.repeat(50));
    for (const r of results) {
      console.log(`  ${r.label.padEnd(12)} | ${r.breakEven.toString().padStart(10)} | $${r.savingsAt10.toFixed(4)}`);
    }
    console.log('\nKey insight: Break-even is driven by compression ratio, not cached pair count.');
    console.log('More cached pairs = higher total cost, but savings scale proportionally.');
  } else {
    runScenario(params, 'Custom');
  }
}

main();
