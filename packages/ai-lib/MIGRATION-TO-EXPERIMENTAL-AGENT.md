# Migration from Custom Agent Class to Experimental_Agent

This document explains how to migrate from the custom `Agent` class to the new `ExperimentalAgentFactory` which uses AI SDK 5's `Experimental_Agent`.

## 🎯 **Why Migrate?**

- **Simplified Architecture**: Remove custom agentic loop implementation
- **Better Performance**: Built-in AI SDK 5 optimizations
- **Robust Tool Handling**: Improved tool execution and error handling
- **Native Streaming**: Better streaming performance and reliability
- **Future-Proof**: Aligned with AI SDK 5 direction

## 📋 **Key Changes**

### Old Pattern (Custom Agent)
```typescript
import { Agent } from '@airo/ai-lib'

const agent = new Agent({
  name: 'Travel Assistant',
  systemPrompt: 'You help with travel planning...',
  model: await bedrockModels.claudeSonnet4(),
  tools: { weather: weatherTool },
  temperature: 0.3,
  maxTokens: 2000
})

// Streaming
for await (const chunk of agent.generateStream(prompt)) {
  process.stdout.write(chunk)
}
```

### New Pattern (ExperimentalAgentFactory)
```typescript
import { createExperimentalAgentFactory } from '@airo/ai-lib'

const factory = createExperimentalAgentFactory()

const agents = factory.defineAgents({
  travelAssistant: {
    name: 'Travel Assistant',
    system: 'You help with travel planning...',  // Note: 'system' not 'systemPrompt'
    model: await bedrockModels.claudeSonnet4(),
    tools: { weather: weatherTool },
    temperature: 0.3,
    maxOutputTokens: 2000,                       // Note: 'maxOutputTokens' not 'maxTokens'
    maxSteps: 8,                                 // New: control agentic loop steps
    stopAfterTools: ['weather']                  // New: intelligent stopping conditions
  }
})

const agent = agents.get('travelAssistant')

// Streaming
const streamResult = await agent.streamGenerate(prompt)
for await (const chunk of streamResult.textStream) {
  process.stdout.write(chunk)
}
const finalResult = await streamResult.getFinalResult()
console.log('Usage:', finalResult.usage)
```

## 🔧 **API Changes**

### Configuration Changes

| Old Agent Config | New ExperimentalAgentConfig | Notes |
|------------------|------------------------------|-------|
| `systemPrompt` | `system` | Renamed for AI SDK 5 compatibility |
| `maxTokens` | `maxOutputTokens` | Renamed to match AI SDK 5 |
| `enableLoopControl` | `maxSteps` + `stopWhen` | More granular control |
| N/A | `stopAfterTools` | New: Stop after specific tool calls |

### Method Changes

| Old Agent Method | New ExperimentalAgentWrapper Method | Notes |
|------------------|-------------------------------------|-------|
| `generate(prompt)` | `generate(prompt)` | Same interface |
| `generateStream(prompt)` | `streamGenerate(prompt)` | Returns object with `textStream` and `getFinalResult()` |
| N/A | `streamWithContext(prompt, options)` | New: Built-in context injection |

## 📝 **Step-by-Step Migration**

### 1. Update Dependencies
```typescript
// Remove
import { Agent } from '@airo/ai-lib'

// Add
import { createExperimentalAgentFactory } from '@airo/ai-lib'
```

### 2. Update Configuration
```typescript
// OLD
const agent = new Agent({
  name: 'My Agent',
  systemPrompt: 'You are helpful...',
  maxTokens: 2000,
  // ...
})

// NEW
const factory = createExperimentalAgentFactory()
const agents = factory.defineAgents({
  myAgent: {
    name: 'My Agent',
    system: 'You are helpful...',     // systemPrompt → system
    maxOutputTokens: 2000,           // maxTokens → maxOutputTokens
    maxSteps: 8,                     // NEW: control reasoning steps
    stopAfterTools: ['toolName'],    // NEW: intelligent stopping
    // ...
  }
})
const agent = agents.get('myAgent')
```

### 3. Update Streaming Code
```typescript
// OLD
for await (const chunk of agent.generateStream(prompt)) {
  process.stdout.write(chunk)
}

// NEW
const streamResult = await agent.streamGenerate(prompt)
for await (const chunk of streamResult.textStream) {
  process.stdout.write(chunk)
}
const finalResult = await streamResult.getFinalResult()
```

### 4. Update Custom Context Injection
```typescript
// OLD (using custom message builder)
const result = await agent.generate(prompt, { 
  messages: contextMessages 
})

// NEW (built-in context injection)
const streamResult = await agent.streamWithContext(prompt, {
  customContext: 'Weather: sunny, 28°C...',
  conversationHistory: [
    { role: 'user', content: 'Previous message' },
    { role: 'assistant', content: 'Previous response' }
  ]
})
```

## ✅ **Benefits of Migration**

### 1. **Better Tool Control**
```typescript
// Intelligent stopping conditions
stopWhen: [
  stepCountIs(5),              // Max 5 reasoning steps
  hasToolCall('finalTool')     // Stop after specific tool
]
```

### 2. **Built-in Context Management**
```typescript
// Easy context injection without custom message builders
agent.streamWithContext(prompt, {
  customContext: getAppState(),
  conversationHistory: getHistory()
})
```

### 3. **Improved Usage Tracking**
```typescript
const finalResult = await streamResult.getFinalResult()
console.log('Tokens:', finalResult.usage.totalTokens)
console.log('Cost:', calculateCost(finalResult.usage))
```

### 4. **Type Safety with Multiple Agents**
```typescript
const agents = factory.defineAgents({
  travel: { /* config */ },
  weather: { /* config */ },
  booking: { /* config */ }
})

// Fully typed access
const travelAgent = agents.get('travel')  // TypeScript knows this exists
const invalidAgent = agents.get('invalid')  // TypeScript error
```

## 🚨 **Breaking Changes**

1. **Streaming Return Type**: `generateStream()` now returns an object with `textStream` and `getFinalResult()`
2. **Configuration Keys**: `systemPrompt` → `system`, `maxTokens` → `maxOutputTokens`
3. **Factory Pattern**: Must use factory to create agents for type safety
4. **Bedrock Compatibility**: Requires using `createTool()` from `@airo/ai-lib` for tools

## 📚 **Examples**

See these files for complete examples:
- `examples/experimental-agent-factory.ts` - Full factory demo
- `examples/experimental-agent-custom-context.ts` - Context injection
- `examples/experimental-agent-conversation-history.ts` - Conversation management
- `examples/test-experimental-factory.ts` - Simple usage test

## 🔮 **Next Steps**

1. Update your agents to use `ExperimentalAgentFactory`
2. Test streaming and tool usage
3. Verify custom context injection works
4. Remove references to old `Agent` class
5. Update any custom message builders if needed

The migration provides significant benefits in terms of performance, maintainability, and alignment with AI SDK 5's direction!
