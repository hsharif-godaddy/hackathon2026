# @airo/ai-lib

A lightweight, type-safe wrapper around AI SDK 5 for building reusable AI agents with factory pattern management.

## Features

- 🏭 **Factory Pattern**: Define all agents in one place, use them everywhere
- 🔧 **AI SDK 5 Native**: Built on the latest AI SDK with agentic loop control
- 🎯 **Type Safe**: Full TypeScript support with proper type inference
- 🔌 **Multi-Provider**: Support for OpenAI, Anthropic, and custom providers
- 🛠️ **Tool System**: Extensible tool system with built-in tools
- 📡 **Streaming**: Full streaming support with custom data parts
- ⚡ **Lightweight**: Minimal overhead, maximum flexibility

## Installation

```bash
npm install @airo/ai-lib ai
```

**OpenAI support included out of the box!** 🎉

For other providers, install as needed:

```bash
# For Anthropic
npm install @ai-sdk/anthropic
```

## Quick Setup

```bash
# 1. Copy environment template
cp env.example .env

# 2. Edit .env and add your API keys
# 3. Run setup check
npm run setup

# 4. Test with examples
npm run example:setup
```

## Quick Start

### 1. Set up providers (Easy Mode)

```typescript
import { AgentFactory, tools, openAIModels } from "@airo/ai-lib";

// OpenAI models work out of the box
const agents = agentFactory.defineAgents({
  openaiAgent: {
    name: "OpenAI Assistant",
    systemPrompt: "You are helpful.",
    model: openAIModels.gpt4oMini(), // Uses OPENAI_API_KEY
  },
});
```

Or with manual configuration:

```typescript
import { AgentFactory, tools, EnvConfig } from "@airo/ai-lib";
import { createOpenAI } from "@ai-sdk/openai";

// Manual configuration
const config = EnvConfig.getDefaultConfig();
const openai = createOpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL, // Supports OPENAI_BASE_URL
});
```

Or with the provider registry:

```typescript
import { setDefaultProvider } from "@airo/ai-lib";

// Configure your default provider
setDefaultProvider("openai", {
  type: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});
```

### 2. Define your agents

```typescript
// agents/index.ts
import { AgentFactory, tools } from "@airo/ai-lib";

const agentFactory = new AgentFactory({
  defaultModel: "gpt-4o",
  defaultTemperature: 0.7,
  globalTools: [tools.webSearch()],
});

export const agents = agentFactory.defineAgents({
  assistant: {
    name: "General Assistant",
    systemPrompt: "You are a helpful AI assistant.",
    model: openai("gpt-4o-mini"), // Use actual model instance
    temperature: 0.7,
  },

  developer: {
    name: "Development Assistant",
    systemPrompt: "You are an expert software developer.",
    model: openai("gpt-4o"), // Use more powerful model for development
    temperature: 0.1,
    tools: [tools.readFile(), tools.writeFile(), tools.listDirectory()],
  },

  writer: {
    name: "Creative Writer",
    systemPrompt: "You are a creative writing assistant.",
    model: openai("gpt-4o"),
    temperature: 0.9,
    maxTokens: 3000,
  },
});

export const getAgent = agents.get;
export type AgentType = keyof typeof agents.definitions;
```

### 3. Use agents anywhere

```typescript
// In an API route
import { getAgent } from "./agents";

export async function POST(request: Request) {
  const { message, agentType = "assistant" } = await request.json();

  const agent = getAgent(agentType);
  const response = await agent.generate(message);

  return Response.json({ response: response.content });
}
```

```typescript
// In a CLI tool
import { getAgent } from "./agents";

const developer = getAgent("developer");
const result = await developer.runAgenticLoop(
  "Create a TypeScript function to calculate fibonacci numbers",
  { maxSteps: 3 },
);
console.log(result.content);
```

```typescript
// Streaming
const writer = getAgent("writer");
for await (const chunk of writer.generateStream("Write a story about AI")) {
  process.stdout.write(chunk);
}
```

## Advanced Usage

### Custom Tools

```typescript
import { createTool } from "@airo/ai-lib";
import { z } from "zod";

const weatherTool = createTool(
  "get_weather",
  "Get current weather for a location",
  z.object({
    location: z.string(),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  }),
  async ({ location, units }) => {
    // Your weather API integration
    return { temperature: 22, units, location };
  },
);

// Use in agent definition
export const agents = agentFactory.defineAgents({
  weatherBot: {
    name: "Weather Assistant",
    systemPrompt: "You help users with weather information.",
    tools: [weatherTool],
  },
});
```

### Environment-Specific Configuration

```typescript
const isDev = process.env.NODE_ENV === "development";

const agentFactory = new AgentFactory({
  defaultModel: isDev ? "gpt-4o-mini" : "gpt-4o",
  defaultTemperature: isDev ? 0.8 : 0.7,
  globalTools: isDev ? [tools.debug()] : [],
});
```

### Multiple Providers

```typescript
import { configureProvider } from "@airo/ai-lib";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

// Configure multiple providers
configureProvider("openai-gpt4", {
  type: "openai",
  apiKey: process.env.OPENAI_API_KEY,
});

configureProvider("claude", {
  type: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Use specific models
export const agents = agentFactory.defineAgents({
  fastAgent: {
    name: "Fast Agent",
    model: createOpenAI()("gpt-4o-mini"),
    systemPrompt: "You provide quick responses.",
  },

  smartAgent: {
    name: "Smart Agent",
    model: createAnthropic()("claude-3-5-sonnet-20241022"),
    systemPrompt: "You provide detailed, thoughtful responses.",
  },
});
```

## API Reference

### AgentFactory

````typescript
class AgentFactory {
  constructor(globalConfig?: GlobalAgentConfig)
  defineAgents<T>(configs: T): AgentRegistry<T>
  createAgent(config: AgentConfig & { id: string }): Agent
  updateGlobalConfig(config: Partial<GlobalAgentConfig>): void
}

### Retry Logic (Resilient LLM Calls)

`@airo/ai-lib` automatically supports resilient retries for both `generate()` and streaming calls when you supply a `retryConfig` in an `AgentConfig`.

Defaults (when `retryConfig` omitted):
- 5 total attempts (initial + 4 retries)
- Exponential backoff delays (approx): 1s, 2s, 4s, 8s, 16s (full jitter)
- Retry categories: network/transient errors (timeouts, 5xx, connection resets) and rate limits (429)
- Non‑retryable: standard 4xx client errors (400, 401, 403, etc.)

Add custom retry behavior:
```typescript
import { AgentFactory, openAIModels } from '@airo/ai-lib'

const agentFactory = new AgentFactory()

const agents = agentFactory.defineAgents({
  resilientAssistant: {
    name: 'Resilient Assistant',
    model: openAIModels.gpt4oMini(),
    // Override defaults (only provide what you need)
    retryConfig: {
      maxAttempts: 6,        // increase attempts
      baseDelayMs: 750,       // lower initial delay
      maxDelayMs: 12000,      // cap maximum backoff
      jitter: true            // keep full jitter
    },
    // Optional unified structured logger (receives retry events)
    logger: {
      info: (e, d) => console.log(e, d),
      warn: (e, d) => console.warn(e, d),
      error: (e, d) => console.error(e, d)
    }
  }
})

const agent = agents.get('resilientAssistant')
const result = await agent.generate('Explain retry backoff')
console.log(result.content)
````

Structured events emitted (if a logger is provided):

- `llm.api_call.retry` (warn) – a retry attempt will occur (includes delay, attempt number, classification)
- `llm.api_call.retry_success` (info) – final successful attempt after ≥1 retries
- `llm.api_call.retry_exhausted` (error) – all attempts failed; metadata attached to the thrown error

Access retry failure metadata:

```typescript
import { hasRetryMetadata, getRetryMetadata } from "@airo/ai-lib";

try {
  await agent.generate("Force an error scenario");
} catch (err) {
  if (hasRetryMetadata(err)) {
    const meta = getRetryMetadata(err);
    console.log("Attempts:", meta.attempts);
    console.log("Elapsed ms:", meta.elapsedMs);
    console.log("Category:", meta.category); // 'transient' | 'rate_limit'
    console.log("Last message:", meta.lastMessage);
  }
}
```

Tuning tips:

- Increase `maxAttempts` cautiously—each retry increases worst‑case latency.
- Use jitter in multi‑instance deployments to reduce synchronized retry storms.
- Consider surfacing `category` + `statusCode` in your own analytics for reliability dashboards.

The retry utility is exported directly if you need manual control:

```typescript
import { retryWithBackoff, DEFAULT_RETRY_CONFIG } from "@airo/ai-lib";
const value = await retryWithBackoff(
  () => expensiveCall(),
  DEFAULT_RETRY_CONFIG,
  { operation: "generate" },
);
```

````

### Agent

```typescript
class Agent {
  generate(input: string, context?: AgentContext): Promise<AgentResult>
  generateStream(input: string, context?: AgentContext): AsyncGenerator<string>
  runAgenticLoop(input: string, options?: AgenticLoopOptions): Promise<AgentResult>
  executeWithTools(input: string, context?: AgentContext): Promise<AgentResult & { toolExecutions: ToolExecutionResult[] }>
}
````

### Tools

```typescript
// Built-in tools
import { tools } from '@airo/ai-lib'

tools.webSearch()      // Web search tool
tools.readFile()       // Read file tool
tools.writeFile()      // Write file tool
tools.listDirectory()  // Directory listing tool

// Create custom tools
createTool(name, description, schema, execute, options?)
```

## Examples

See the `examples/` directory for more detailed examples:

- `test-basic.ts` - Basic functionality test (no API calls)
- `simple-openai.ts` - Simple OpenAI example with built-in helpers
- `with-openai.ts` - Comprehensive OpenAI example with tools and streaming
- `simple-prompt-caching.ts` - Simple prompt caching demo with performance metrics
- `easy-setup.ts` - Auto-detect provider setup

### Running Examples

```bash
# Test basic functionality (no API required)
npm run example:basic

# Simple OpenAI example (requires OPENAI_API_KEY)
npm run example:simple

# Comprehensive OpenAI example with tools
npm run example:openai


# Simple prompt caching demo with metrics (cost optimization)
npm run example:caching

# Auto-detect provider setup
npm run example:setup

# Check your setup
npm run setup
```

## License

MIT
