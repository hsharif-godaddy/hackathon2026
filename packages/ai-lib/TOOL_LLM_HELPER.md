# Tool LLM Helper

## Overview

The Tool LLM Helper provides utilities for tools that need to make internal LLM calls with proper tracking, metadata injection, and observability.

## Problem

When tools need to make LLM calls internally (e.g., for creative tasks like color scheme generation), direct use of AI SDK's `generateText` bypasses critical infrastructure:

- **Missing metadata injection** - No subscriptionId/customerId for cost tracking
- **No token usage tracking** - Usage not recorded to database
- **No observability** - LLM call start/end events not sent
- **Missing S2S auth** - Auth tokens not injected for proxied requests

## Solution

The `generateTextWithTracking` helper wraps AI SDK's `generateText` to provide:

- Automatic usage tracking via callback
- Structured logging for observability
- Error handling with proper logging
- Metadata propagation for context

## Usage

### Basic Example

```typescript
import { generateTextWithTracking, calculateCostEstimate } from "@airo/ai-lib";
import { getAgentModelWithName } from "./model-selection";
import { TokenUsageRepository } from "./TokenUsageRepository";

const tokenUsageRepo = new TokenUsageRepository();

async function generateColorPalettes(
  description: string,
  appId?: string,
  sessionId?: string,
) {
  const { model, modelName } = await getAgentModelWithName("fast");

  const result = await generateTextWithTracking({
    model,
    modelName,
    system: "You are a color scheme expert...",
    prompt: `Generate color palettes for: ${description}`,
    temperature: 0.8,
    context: {
      appId,
      conversationId: sessionId,
      description: "Color scheme generation",
      toolName: "colorScheme",
    },
    onUsage: async (usage) => {
      if (!appId) return;

      const costEstimate = calculateCostEstimate(
        {
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          ...(usage.cachedTokens && {
            cachedInputTokensRead: usage.cachedTokens,
          }),
        },
        modelName,
      );

      await tokenUsageRepo.recordUsage(
        appId,
        "llm_request",
        usage.promptTokens,
        usage.completionTokens,
        {
          model: modelName,
          conversationId: sessionId,
          description: "Color scheme generation (tool-initiated LLM call)",
          cost: costEstimate.totalCost,
          cacheReadTokens: usage.cachedTokens,
        },
      );
    },
  });

  return JSON.parse(result.text);
}
```

### Without Usage Tracking

If you don't need usage tracking (e.g., for testing or non-production use):

```typescript
const result = await generateTextWithTracking({
  model,
  modelName,
  prompt: "Generate a haiku about coding",
});

console.log(result.text);
console.log(`Used ${result.usage.totalTokens} tokens`);
```

## API Reference

### `generateTextWithTracking(options)`

Generate text with automatic usage tracking and observability.

#### Parameters

- `options.model` (LanguageModel, required) - The language model to use
- `options.modelName` (string, required) - Model name for cost calculation and tracking
- `options.system` (string, optional) - System prompt
- `options.prompt` (string, required) - User prompt
- `options.temperature` (number, optional) - Temperature (0-1)
- `options.maxTokens` (number, optional) - Maximum tokens to generate
- `options.context` (ToolLLMContext, optional) - Context for tracking and observability
  - `appId` (string, optional) - App ID for usage tracking
  - `conversationId` (string, optional) - Conversation/session ID for grouping
  - `description` (string, optional) - Description of what this LLM call is for
  - `toolName` (string, optional) - Tool name that initiated the call
- `options.onUsage` (function, optional) - Callback for usage tracking
  - Receives: `{ promptTokens, completionTokens, totalTokens, cachedTokens, modelName, context }`
  - Can be async or sync
  - Errors in callback are caught and logged (won't fail the generation)

#### Returns

Promise resolving to:

```typescript
{
  text: string              // Generated text
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedTokens?: number
  }
  finishReason: string      // 'stop', 'length', etc.
  modelName: string         // Model name used
}
```

## Logging

The helper provides structured logging for observability:

### Start Event

```typescript
logger.info("tool_llm.generate.begin", {
  modelName,
  toolName,
  appId,
  conversationId,
  description,
  promptLength,
  hasSystem,
});
```

### Success Event

```typescript
logger.info("tool_llm.generate.complete", {
  modelName,
  toolName,
  appId,
  conversationId,
  durationMs,
  textLength,
  usage,
  finishReason,
});
```

### Usage Tracked Event

```typescript
logger.info("tool_llm.usage.tracked", {
  modelName,
  toolName,
  appId,
  totalTokens,
});
```

### Error Events

```typescript
logger.error("tool_llm.generate.failed", {
  modelName,
  toolName,
  appId,
  conversationId,
  durationMs,
  error,
  stack,
});

logger.error("tool_llm.usage.tracking_failed", {
  modelName,
  toolName,
  appId,
  error,
});
```

## Best Practices

### 1. Always Provide Context

```typescript
// ✅ Good - provides full context
const result = await generateTextWithTracking({
  model,
  modelName,
  prompt: "Generate...",
  context: {
    appId: "app-123",
    conversationId: "conv-456",
    description: "Feature generation",
    toolName: "myTool",
  },
});

// ❌ Bad - no context for tracking
const result = await generateTextWithTracking({
  model,
  modelName,
  prompt: "Generate...",
});
```

### 2. Always Track Usage in Production

```typescript
// ✅ Good - tracks usage with cost calculation
onUsage: async (usage) => {
  const cost = calculateCostEstimate(usage, modelName);
  await tokenRepo.recordUsage(
    appId,
    "llm_request",
    usage.promptTokens,
    usage.completionTokens,
    {
      model: modelName,
      cost: cost.totalCost,
    },
  );
};

// ❌ Bad - no usage tracking (only OK for testing)
// (no onUsage callback)
```

### 3. Use Descriptive Descriptions

```typescript
// ✅ Good - clear description of purpose
description: "Color scheme generation from user description";

// ❌ Bad - vague description
description: "LLM call";
```

### 4. Handle Errors Appropriately

```typescript
try {
  const result = await generateTextWithTracking({...})
  return processResult(result.text)
} catch (error) {
  // Log and handle appropriately
  logger.error('Failed to generate', { error })
  throw new Error('Generation failed')
}
```

## Integration with Existing Tools

### Before (Direct AI SDK Usage)

```typescript
import { generateText } from "ai";

const result = await generateText({
  model,
  system: SYSTEM_PROMPT,
  prompt: userPrompt,
  temperature: 0.8,
});

// No tracking, no observability, no metadata
```

### After (With Tracking)

```typescript
import { generateTextWithTracking, calculateCostEstimate } from "@airo/ai-lib";

const result = await generateTextWithTracking({
  model,
  modelName,
  system: SYSTEM_PROMPT,
  prompt: userPrompt,
  temperature: 0.8,
  context: {
    appId,
    conversationId,
    description: "My feature generation",
    toolName: "myTool",
  },
  onUsage: async (usage) => {
    const cost = calculateCostEstimate(usage, modelName);
    await tokenRepo.recordUsage(
      appId,
      "llm_request",
      usage.promptTokens,
      usage.completionTokens,
      {
        model: modelName,
        cost: cost.totalCost,
      },
    );
  },
});

// Full tracking, observability, and metadata injection
```

## Testing

For testing, you can omit the `onUsage` callback:

```typescript
// Test without tracking
const result = await generateTextWithTracking({
  model: mockModel,
  modelName: "test-model",
  prompt: "Test prompt",
});

expect(result.text).toBe("Expected output");
```

## See Also

- [Model Selection Guide](../agents/src/utils/model-selection.ts) - How to get properly configured models
- [Token Usage Repository](../agents/src/database/repositories/TokenUsageRepository.ts) - Recording usage
- [Cost Calculator](./src/utils/model-pricing.ts) - Calculating costs from usage
