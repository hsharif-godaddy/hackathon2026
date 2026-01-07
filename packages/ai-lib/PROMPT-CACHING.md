# Dynamic Prompt Caching

Automatic prompt caching implementation inspired by the [Vercel AI SDK pattern](https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching).

## Overview

Dynamic prompt caching reduces API costs and improves performance by automatically caching conversation prefixes (system prompts, early conversation history) that get resent repeatedly across multiple requests.

### Benefits

- **90% cost savings** on cached tokens (Anthropic: $3/M → $0.30/M)
- **Faster response times** due to reduced processing
- **Zero-configuration** - just enable the flag
- **Automatic provider detection** - only applies to supported models
- **Intelligent caching strategy** - caches stable content, leaves recent messages fresh

## Quick Start

```typescript
import { getModel } from "@airo/ai-lib";
import { createAgentFactory } from "@airo/ai-lib";

const model = await getModel("claude4");

const agentFactory = createAgentFactory();

const agents = agentFactory.defineAgents({
  myAgent: {
    name: "My Agent",
    system: "Large system prompt that benefits from caching...",
    model,
    tools: {
      /* ... */
    },

    // ✨ Enable automatic prompt caching
    enablePromptCaching: true,
  },
});

const agent = agents.get("myAgent");

// First request - establishes cache
const stream1 = await agent.streamGenerate("Hello!");

// Subsequent requests - benefits from cache
const stream2 = await agent.streamGenerate("Follow-up question", {
  messages: [
    /* previous conversation */
  ],
});
```

That's it! The system automatically:

1. Detects if the model supports caching (Anthropic/Bedrock only)
2. Marks system prompts for caching
3. Marks early conversation history for caching
4. Leaves recent messages uncached (they change frequently)

## Configuration

### Basic Usage (Recommended)

```typescript
enablePromptCaching: true;
```

Uses intelligent defaults:

- Caches system prompts
- Uses 2 cache breakpoints (system + conversation)

### Custom Strategy

```typescript
enablePromptCaching: {
  // Cache system prompts (default: true)
  cacheSystemPrompts: true,
  // Maximum cache breakpoints (Anthropic limit: 4, default: 2)
  // Use 3-4 only if you have additional stable context to cache
  maxBreakpoints: 2
}
```

## How It Works

### Caching Strategy

**IMPORTANT**: Anthropic's caching works by caching everything **UP TO** a breakpoint. We place breakpoints strategically:

1. **System Prompt** - Applies `cache_control` to system/instructions field (stable across requests)
2. **Final Message** - Breakpoint at the LAST message before new input
3. **Cache Extension** - Each subsequent request moves the breakpoint forward, extending the cache

**Technical Implementation:**

- System prompts are passed as `instructions` parameter to ToolLoopAgent (not in messages array)
- When caching is enabled, string system prompts are converted to `SystemModelMessage` with `providerOptions.anthropic.cacheControl`
- For `SystemModelMessage[]` arrays, `providerOptions` is added to the last message
- Cache metadata is passed through `providerOptions` (not raw content blocks) to comply with AI SDK contract
- This ensures the system prompt is cached separately from conversation messages

This means:

- Request 1: Caches system + first user message
- Request 2: Extends cache to include assistant response + second user message
- Request 3: Extends cache further... and so on

```
Request 1: [System] + [User1] ← breakpoint
  Caches: System + User1

Request 2: [System] + [User1] + [Assistant1] + [User2] ← breakpoint
  From cache: System + User1
  Newly cached: Assistant1 + User2

Request 3: [System] + [User1] + [Assistant1] + [User2] + [Assistant2] + [User3] ← breakpoint
  From cache: System + User1 + Assistant1 + User2
  Newly cached: Assistant2 + User3
```

**Anthropic Limit**: Maximum 4 cache breakpoints per request. We use 2 by default (system + conversation) to stay well under the limit.

### Provider Support

Currently supports:

- ✅ Anthropic Claude (direct API)
- ✅ AWS Bedrock (Anthropic models)
- ❌ OpenAI (pass-through, no caching)
- ❌ Other providers (pass-through, no caching)

The utility automatically detects the provider and only applies caching metadata for supported models.

### Cache Lifetime

- **Type**: Ephemeral cache
- **Duration**: 5 minutes of inactivity
- **Scope**: Per conversation/session
- **Best for**: Multi-turn agent interactions with accumulated context

## Cost Analysis

### Anthropic Claude Sonnet 4.5 Pricing

**Standard Context (≤ 200K tokens):**

| Token Type          | Cost per Million | Savings     |
| ------------------- | ---------------- | ----------- |
| Input tokens        | $3.00            | Baseline    |
| Cached input tokens | $0.30            | **90%**     |
| Cache writes        | $3.75            | 25% premium |
| Output tokens       | $15.00           | N/A         |

**Extended Context (> 200K tokens):**

| Token Type          | Cost per Million |
| ------------------- | ---------------- |
| Input tokens        | $6.00            |
| Cached input tokens | $0.60            |
| Cache writes        | $7.50            |
| Output tokens       | $22.50           |

_Note: Cost calculations in this library use standard context pricing._

### Example Scenario

Multi-turn conversation with 2000-token system prompt:

```
Request 1 (establish cache):
- Input: 2000 tokens (system) + 50 tokens (user)
- Cost: (2050 / 1M) × $3.00 = $0.0062
- Cache write: (2000 / 1M) × $3.75 = $0.0075 (one-time)
- Total: $0.0137

Request 2 (cache hit):
- Input: 2000 tokens (cached) + 100 tokens (history) + 50 tokens (user)
- Cost: (2000 / 1M) × $0.30 + (150 / 1M) × $3.00 = $0.0011
- Savings: $0.0051 (82% cheaper!)

Request 3-10 (continued cache hits):
- Each request saves ~$0.005
- Total savings over 10 requests: ~$0.045
```

## Monitoring

The system automatically logs caching statistics:

```json
{
  "event": "prompt_caching.stats",
  "data": {
    "newInputTokens": 150,
    "cachedInputTokens": 2000,
    "totalInputTokens": 2150,
    "cacheHitRate": "93.0%",
    "estimatedSavings": "$0.0051",
    "savingsPercentage": "82.3%"
  }
}
```

## Best Practices

### When to Use Caching

✅ **Good candidates:**

- Large system prompts (>1000 tokens)
- Multi-turn conversations with accumulated context
- Agents with heavy tool definitions
- High-volume applications with repeated patterns

❌ **Not beneficial:**

- Single-turn requests
- Conversations shorter than 3 messages
- Frequently changing system prompts
- Low-volume applications

### Optimization Tips

1. **Consolidate system prompts** - Larger stable prompts = better caching
2. **Structure conversations carefully** - Keep recent context small
3. **Monitor cache hit rates** - Aim for >50% hit rate to justify cache writes
4. **Consider conversation length** - Caching pays off after 3-4 requests

### Common Pitfalls

❌ **Don't cache frequently changing content**

```typescript
// Bad: System prompt changes every request
system: `Current time: ${new Date().toISOString()}...`;
```

✅ **Cache stable content only**

```typescript
// Good: Stable system prompt, inject dynamic data separately
system: "You are an AI assistant...";
// Pass dynamic data in user messages
```

## Examples

### Basic Multi-Turn Conversation

See `examples/dynamic-prompt-caching-demo.ts` for a complete working example.

### Custom Caching Strategy

```typescript
const agents = agentFactory.defineAgents({
  aggressiveCaching: {
    name: "Aggressive Caching Agent",
    system: longSystemPrompt,
    model,
    enablePromptCaching: {
      cacheSystemPrompts: true,
      maxBreakpoints: 3, // Use more breakpoints (stay under Anthropic's limit of 4)
    },
  },
});
```

### Programmatic Cost Tracking

```typescript
import { estimateCachingSavings } from "@airo/ai-lib";

const result = await agent.streamGenerate(prompt);
const finalResult = await result.getFinalResult();
const usage = await finalResult.usage;

if (usage.cachedInputTokens) {
  const savings = estimateCachingSavings(
    usage.inputTokens,
    usage.cachedInputTokens,
    0, // Assume cache already written
  );

  console.log(
    `Saved $${savings.savings.toFixed(4)} (${savings.savingsPercentage.toFixed(1)}%)`,
  );
}
```

## Implementation Details

### Files

- `src/utils/prompt-caching.ts` - Core caching utility
- `src/core/agent-factory.ts` - Integration with AgentFactory
- `src/core/types.ts` - Type definitions
- `examples/dynamic-prompt-caching-demo.ts` - Working example

### Key Functions

- `supportsPromptCaching(model)` - Detect if model supports caching
- `addCacheControlToSystemPrompt(systemPrompt, model, strategy)` - Apply caching to system/instructions field
- `addCacheControlToMessages(messages, model, strategy)` - Apply caching metadata to messages
- `estimateCachingSavings(...)` - Calculate cost savings
- `logCachingStats(usage)` - Log caching performance

## References

- [Vercel AI SDK: Dynamic Prompt Caching](https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching)
- [Anthropic: Prompt Caching](https://docs.anthropic.com/claude/docs/prompt-caching)
- [AWS Bedrock: Prompt Caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)

## Future Enhancements

Potential improvements:

- [ ] Support for other providers (OpenAI, etc.)
- [ ] Per-tool caching strategies
- [ ] Automatic cache invalidation based on content changes
- [ ] Cache analytics dashboard
- [ ] Dynamic strategy adjustment based on usage patterns
