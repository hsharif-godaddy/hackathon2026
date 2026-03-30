# Summarization System Improvements

## Status: Technical Design Draft

## Problem Statement

The current conversation summarization system has several limitations that need data-driven solutions:

1. **No synchronous summarization** - Cannot force immediate summarization before requests
2. **No mid-loop summarization** - Agent tool loops can exceed context limits mid-request
3. **No context buffer** - Threshold doesn't account for agent loop growth
4. **Arbitrary parameters** - 40k tokens, 4 recent turns, 30s debounce lack data justification
5. **Stale testing baseline** - Previous testing predates KnowB fix and cache point optimizations

## Empirical Data Analysis

Data source: `agents/.devtools/generations.json` (AI SDK dev tools telemetry)

### Observed Token Growth Patterns

From a 29-step agent run:

| Step Range | Token Growth | Avg Per Step | Notes                 |
| ---------- | ------------ | ------------ | --------------------- |
| 1 → 5      | 9,114        | 2,278        | Initial tool calls    |
| 5 → 10     | 11,559       | 2,312        | Steady growth         |
| 10 → 15    | 20,009       | 4,002        | Large file operations |
| 15 → 20    | 7,415        | 1,483        | Smaller adjustments   |
| 20 → 29    | 4,346        | 483          | Completion phase      |

**Key Findings:**

- **Max single-step growth: 7,002 tokens** (step 12→13)
- **Average growth: 1,873 tokens/step** across all steps
- **P95 growth: ~6,500 tokens/step** (large file reads/writes)
- Messages grow by 2 per step (assistant + tool result)

### Summarization Effectiveness

**Observed real-world summarization (3 batches):**

- **Before:** 162,918 tokens (210 messages)
- **After:** 1,016 tokens
- **Reduction:** 161,902 tokens saved
- **Compression ratio:** 99.4%

This is dramatically better than initial estimates. The structured summary format captures essential context while eliminating verbose tool call details.

### Cache Behavior

With new cache points (PR #1606):

- Initial cache write: 26,145 tokens
- Cache reads per step: 26,145 tokens (100% cache hit on prefix)
- Total cache reads in run: 732,060 tokens
- **Effective cache hit rate:** ~35% of input tokens served from cache

### Derived Thresholds

Based on observed data:

```typescript
// Data-driven configuration
const CONTEXT_BUDGET = {
  // Model limit (Claude Sonnet 4.5)
  modelLimit: 200000,

  // Reserve for worst-case step growth (p95 + buffer)
  perStepReserve: 8000, // 7002 p95 + 1000 safety buffer

  // Max steps in agent loop
  maxSteps: 8, // Default from agent-factory.ts

  // Calculated safe starting point
  // 200k - (8 steps × 8k) = 136k safe start
  safeTriggerThreshold: 136000,

  // Current threshold for comparison
  currentThreshold: 40000, // Way too conservative!
};
```

### Threshold Selection: 10k Based on Cost Analysis

The 10k threshold is chosen based on cost-effectiveness, not context limits:

- **Break-even:** 2-4 requests with typical cache hit rates
- **Compression:** 99% reduction (10k → ~100 tokens)
- **Batch size:** 12k max to maintain summarization relevancy

With 99% compression and ~$0.032 per summarization, the cost savings on subsequent requests justify summarizing early rather than waiting for large context accumulation.

## Cost Analysis Framework

### LLM Pricing (Claude Sonnet 4.5)

| Token Type       | Cost per Million |
| ---------------- | ---------------- |
| Cache Write      | $3.75            |
| Cache Read       | $0.30            |
| Non-cached Input | $3.00            |
| Output           | $15.00           |

### Cost Tradeoffs

**Scenario A: No Summarization (Longer Context)**

- Higher input tokens per request
- BUT: With caching, prefix is served at $0.30/M instead of $3.00/M (90% savings)
- Cache invalidation only on new user messages
- Effective cost: `(fresh_tokens × $3/M) + (cached_tokens × $0.30/M) + (output × $15/M)`

**Scenario B: Frequent Summarization (Shorter Context)**

- Lower input tokens per request
- BUT: Summarization itself costs ~$15/M output (expensive!)
- Cache invalidated when summary changes (every summarization)
- Effective cost: `(input × $3/M) + (output × $15/M) + (summary_output × $15/M)`

### Example Cost Calculation (Updated with Real Data)

**Real compression ratio: 99.4%** (162k → 1k tokens)

For a conversation with 160k tokens:

**Full summarization cost:**

```
Summarization (3 batches × ~10k each):
  Input:  ~30k tokens × $3/M = $0.09
  Output: ~1k tokens × $15/M = $0.015
  Total: ~$0.11 per full summarization
```

**Savings per subsequent request:**

```
Without summary: 160k input tokens × $3/M = $0.48/request
With summary:    1k input tokens × $3/M   = $0.003/request
Savings: $0.477/request (99.4% reduction)
```

**Break-even:** Full summarization pays for itself in < 1 request!

**Key Insight:** With 99% compression, summarization is extremely cost-effective. The question is not WHETHER to summarize, but HOW OFTEN and WHAT TYPE (incremental vs full).

### Incremental vs Full Summarization

| Type            | Cost                 | Quality                                   | When to Use                                |
| --------------- | -------------------- | ----------------------------------------- | ------------------------------------------ |
| **Incremental** | Low (~$0.01-0.03)    | Merges new messages into existing summary | Frequent updates, low message volume       |
| **Full**        | Higher (~$0.10-0.15) | Reprocesses all messages from scratch     | Periodic cleanup, ensures no messages lost |

**Full regeneration concerns:**

- Processes ALL messages (expensive for long conversations)
- Current threshold of 2 incremental updates is too aggressive
- Recommend: Full regeneration every 5-10 incremental updates

**Incremental mode:** (FIXED)

- Skip last 4 messages (simple count)
- If <= 4 new messages, skip incremental update entirely
- Full mode still uses `keepRecentTurns` (counts user turns)

**Batch size:** 12k tokens max per batch (reduced from 25k for better relevancy)

### Data Needed for Accurate Model

To build an accurate cost model, we need:

1. **Summarization compression ratio** - How much does summary reduce tokens?
2. **Summarization output tokens** - How expensive is each summarization?
3. **Cache hit rate before/after summarization** - What's lost on invalidation?
4. **Steps per conversation** - How many requests benefit from compression?

**Current blocker:** Summarization is broken (only capturing first 2 messages), so we can't measure real compression ratios.

## Bug Fix: Array Index Mismatch Between DB and LLM Messages

### Problem Identified

**Root cause:** The slice index for excluding recent turns was calculated based on database message count but applied to the LLM message array, which has a different count.

**Why the counts differ:**

- 1 database message from an agent with 5 tool calls expands to ~11 LLM messages:
  - 5 assistant messages (for each tool call)
  - 5 tool result messages
  - 1 assistant message (final content)

**Example scenario:**

```
allMessages.length = 20        (database messages)
recentDbMessageCount = 8       (last 4 user turns + agent responses)
summarizableMessageCount = 12  (DB message count)

BUT: allLlmMessages.length = 100+  (expanded LLM messages)

BUG: allLlmMessages.slice(0, 12) only gets first 12 LLM messages
     which might represent only 2-3 actual user turns!
```

**Previous code (WRONG):**

```typescript
// Converted ALL messages first
const allLlmMessages = this.convertToLLMMessages(allMessages);

// Calculated slice based on DB message count
const summarizableMessageCount = allMessages.length - recentMessageCount;

// Applied DB count to LLM array - MISMATCH!
const fullHistoryMessages = allLlmMessages.slice(0, summarizableMessageCount);
```

### Fix Applied

**Slice DB messages FIRST, then convert to LLM format:**

```typescript
// Calculate cutoff based on DB messages
const summarizableDbMessageCount = allMessages.length - recentDbMessageCount;

// CRITICAL: Slice DB messages first, then convert
const fullHistoryMessagesDb = allMessages.slice(0, summarizableDbMessageCount);
const fullHistoryMessages = this.convertToLLMMessages(fullHistoryMessagesDb);

// Convert all messages separately for operation log extraction
const allLlmMessages = this.convertToLLMMessages(allMessages);
```

### Files Changed

- `agents/src/services/summarization/BackgroundSummarizer.ts` (lines 261-269)

### Result

With 14 user messages and `keepRecentTurns=4`:

- **Before fix:** Only 2 "User:" entries in summarization input
- **After fix:** 10 "User:" entries as expected (14 - 4 = 10)

### Fix #2: Simplified Incremental Mode

**Problem:** In incremental mode, `keepRecentTurns=4` (which counts user turns) could exclude ALL new messages if the batch had fewer than 4 user turns.

**Solution:** Simplified incremental mode logic:

- Skip last 4 messages (simple count, not user turns)
- If <= 4 new messages total, skip incremental update entirely
- Full mode still uses `keepRecentTurns` (counts user turns) for the total conversation

**Regeneration threshold:** Reverted to 5 incremental updates (was temporarily set to 2).

**Files changed:**

- `agents/src/services/summarization/BackgroundSummarizer.ts` - Simplified incremental mode with fixed 4-message skip
- `agents/src/services/summarization/DetailedLLMSummarizationStrategy.ts` - Threshold reverted to 5

## Current Architecture

### Trigger Flow

```
Request Complete → onTokenUsage callback → checkAndSummarize
                                                    ↓
                                         30s debounce delay
                                                    ↓
                                         processSummarization
                                                    ↓
                                         Count tokens of summarizable messages
                                         (excludes 4 most recent messages)
                                                    ↓
                                         if (summarizableTokens > 10k) → summarize
```

### Current Configuration

```typescript
// BackgroundSummarizer defaults
maxPromptTokens: 10000; // Trigger threshold (summarizable tokens only)
debounceMs: 3000; // Short delay for GC, not batching (reduced from 30s)
keepRecentTurns: 4; // Recent turns excluded (full mode only)

// DetailedLLMSummarizationStrategy
maxTokensPerBatch: 12000; // Max tokens per summarization batch
```

### Cost Analysis (10k threshold)

- Summarization cost: ~$0.032 per 10k batch
- Break-even: 2-4 requests (with typical 50-70% cache hit rate)
- With 99% compression, summarization pays for itself almost immediately

### Key Components

| Component            | File                                                        | Purpose                    |
| -------------------- | ----------------------------------------------------------- | -------------------------- |
| BackgroundSummarizer | `agents/src/services/summarization/BackgroundSummarizer.ts` | Async summarization        |
| WebSocket Server     | `agents/src/server/ai-lib-websocket-server.ts`              | Trigger point              |
| Agent Factory        | `packages/ai-lib/src/core/agent-factory.ts`                 | Agent loop hooks           |
| AI-SDK ToolLoopAgent | External                                                    | Multi-step agent execution |

## Proposed Improvements

### 1. Context Budget System

**Concept**: Reserve context space for agent loop growth

```typescript
interface ContextBudget {
  totalContextLimit: number; // Model's max context (e.g., 200k for Claude)
  safeOperatingLimit: number; // Target limit for request start (e.g., 180k)
  summarizationThreshold: number; // When to trigger summarization
  perStepReserve: number; // Reserved per tool step (configurable)
  maxSteps: number; // Agent loop step limit
}

// Example for Claude 3.5 Sonnet
const budget: ContextBudget = {
  totalContextLimit: 200000,
  safeOperatingLimit: 180000, // Leave 20k buffer
  summarizationThreshold: 160000, // Trigger summarization at 80%
  perStepReserve: 3000, // ~3k per tool call/result
  maxSteps: 8,
};

// Pre-request check
function shouldSummarizeBeforeRequest(
  currentTokens: number,
  budget: ContextBudget,
): boolean {
  const projectedMax = currentTokens + budget.perStepReserve * budget.maxSteps;
  return projectedMax > budget.safeOperatingLimit;
}
```

### 2. Synchronous Summarization Option

**Add forced summarization for pre-request use:**

```typescript
// New method on BackgroundSummarizer
async forceSummarize(appId: string): Promise<SummaryResult> {
  // Skip debounce, run immediately
  // Used when context budget indicates summarization needed before request
}

// Integration point in WebSocket server
async handleMessage(message, context) {
  const tokenEstimate = await estimateCurrentContextTokens(appId)

  if (shouldSummarizeBeforeRequest(tokenEstimate, contextBudget)) {
    logger.info('summarization.pre_request.triggered', { appId, tokenEstimate })
    await backgroundSummarizer.forceSummarize(appId)
  }

  // Proceed with agent call
  await agent.call(...)
}
```

### 3. Step-Aware Summarization Hook

**Monitor token growth during agent loop:**

```typescript
// In agent-factory.ts onStepFinish hook
const onStepFinish = async (stepResult) => {
  const inputTokens = stepResult.usage?.inputTokens || 0;

  // Track per-request token growth for analysis
  logger.info("agent.step.token_tracking", {
    stepNumber: this.currentStepNumber,
    inputTokens,
    deltaFromPreviousStep: inputTokens - previousInputTokens,
    percentOfLimit: (inputTokens / contextLimit) * 100,
  });

  // Early termination if approaching limit
  if (inputTokens > contextBudget.safeOperatingLimit) {
    logger.warn("agent.step.context_limit_approaching", {
      inputTokens,
      safeLimit: contextBudget.safeOperatingLimit,
    });
    // Could return early termination signal
  }
};
```

### 4. Data Collection for Parameter Tuning

**Instrument to collect data:**

```typescript
interface SummarizationMetrics {
  // Per-request metrics
  requestId: string;
  appId: string;
  startTokens: number;
  endTokens: number;
  stepCount: number;
  tokenGrowthPerStep: number[];

  // Summarization metrics
  preSummaryTokens: number;
  postSummaryTokens: number;
  compressionRatio: number;
  recentTurnsKept: number;

  // Cache metrics (with new cache points)
  cacheHitRate: number;
  cachedTokens: number;
  freshTokens: number;
}

// Log to ai-sdk dev tools compatible format
function logMetrics(metrics: SummarizationMetrics) {
  logger.info("summarization.metrics", {
    ...metrics,
    // Computed values for analysis
    avgTokenGrowthPerStep: mean(metrics.tokenGrowthPerStep),
    maxTokenGrowth: max(metrics.tokenGrowthPerStep),
    effectiveCompression:
      1 - metrics.postSummaryTokens / metrics.preSummaryTokens,
  });
}
```

### 5. Adaptive Threshold Calculation

**Data-driven threshold based on observed patterns:**

```typescript
interface ThresholdConfig {
  // Model-specific limits
  modelContextLimit: number

  // Observed from data collection
  p95ToolCallTokens: number     // 95th percentile of tool call result sizes
  avgStepsPerRequest: number     // Average tool loop steps
  summarizationOverhead: number  // Time/cost of summarization

  // Derived thresholds
  calculateSafeThreshold(): number {
    const maxPossibleGrowth = this.p95ToolCallTokens * this.avgStepsPerRequest * 1.2 // 20% buffer
    return this.modelContextLimit - maxPossibleGrowth
  }
}
```

## Implementation Phases

### Phase 1: Instrumentation (1 week)

- Add detailed token tracking per step
- Add token growth metrics logging
- Log summarization effectiveness metrics
- Compatible with ai-sdk dev tools (localhost:4983)

### Phase 2: Data Collection (2 weeks)

- Run instrumented version in test environment
- Collect metrics across different conversation patterns
- Analyze:
  - Token growth per tool step
  - Optimal recent turns to keep
  - Cache hit rates with new cache points
  - Summarization frequency and compression ratios

### Phase 3: Implement Context Budget (1 week)

- Add pre-request token estimation
- Add synchronous summarization option
- Add context budget configuration

### Phase 4: Parameter Tuning (1 week)

- Analyze collected data
- Calculate optimal thresholds
- Implement adaptive configuration

## Questions for Data Collection

1. **Token growth per step**: What's the average/p95/max token growth per tool call?
2. **Optimal recent turns**: What context from recent turns is actually used by the agent?
3. **Cache effectiveness**: With new cache points, what's the real cost savings?
4. **Summarization quality**: Does keeping 4 turns provide enough context?
5. **KnowB impact**: How much does KnowB contribute to token growth?

## Success Metrics

- No context limit errors during agent loops
- Summarization triggers at optimal threshold (minimal wasted tokens)
- Cache hit rate improved with proper cache point placement
- Predictable token growth within budget

## References

- `docs/prompt-caching-architecture.md` - Cache point strategy
- PR #1606 - Security fix + caching optimization
- AI SDK `ToolLoopAgent` - Agent loop implementation
