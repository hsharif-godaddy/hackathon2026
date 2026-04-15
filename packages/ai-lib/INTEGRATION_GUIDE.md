# AI-Lib Integration Guide

Complete guide for integrating the ai-lib package into your application.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Basic Usage](#basic-usage)
- [Advanced Features](#advanced-features)
- [Provider Configuration](#provider-configuration)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)

## Installation

### 1. Install the Package

```bash
# If integrating within the same monorepo
pnpm add ../packages/ai-lib

# Or if published to npm
pnpm add @airo/ai-lib

# Install required peer dependencies
pnpm add @ai-sdk/openai
```

### 2. Install Optional Dependencies

```bash
# For WebSocket features
pnpm add socket.io socket.io-client

# For file processing
pnpm add zod
```

## Quick Start

### Basic Agent Setup

```typescript
import { createAgentFactory, getModel } from "@airo/ai-lib";

const factory = createAgentFactory();

// Create a simple agent
const model = await getModel("gpt4o");

const agents = factory.defineAgents({
  assistant: {
    name: "Assistant",
    systemPrompt: "You are a helpful AI assistant.",
    model: model,
    temperature: 0.7,
  },
});

// Generate a response
const agent = agents.get("assistant");
const result = await agent.generate("Hello, how are you?");
console.log(result.content);
```

### With AWS Bedrock

```typescript
import { createAgentFactory, getModel } from "@airo/ai-lib";

// Set AWS credentials in environment
process.env.AWS_REGION = "us-west-2";
process.env.AWS_PROFILE = "your-profile";

const factory = createAgentFactory();
const model = await getModel("sonnet");

const agents = factory.defineAgents({
  claude: {
    name: "Claude Assistant",
    model: model,
    systemPrompt: "You are Claude, an AI assistant.",
  },
});

const result = await agents.get("claude").generate("Explain quantum computing");
```

## Core Concepts

### Agents

Agents are created via `AgentFactory.defineAgents()` and returned as `AgentWrapper` instances:

```typescript
interface AgentConfig {
  name: string; // Agent identifier
  systemPrompt?: string; // System instructions
  model: LanguageModel | string; // AI model instance or string ID
  tools?: ToolSet; // Available tools
  temperature?: number; // Response randomness (0-1)
  maxTokens?: number; // Maximum response length
  messageBuilder?: MessageBuilder; // Custom message formatting
}
```

### Models

The library uses a unified `getModel()` function that auto-routes to the correct provider:

```typescript
import { getModel, getEmbeddingModel } from "@airo/ai-lib";

// OpenAI models
const gpt4 = await getModel("gpt4o");
const gptMini = await getModel("gpt4o-mini");

// Claude models (via Bedrock or Anthropic)
const sonnet = await getModel("sonnet");
const haiku = await getModel("haiku");

// Embedding models
const embedModel = await getEmbeddingModel("text-embedding-3-small");
```

### Tools

Tools extend agent capabilities:

```typescript
import { createTool } from "@airo/ai-lib";
import { z } from "zod";

const weatherTool = createTool(
  "Get weather information",
  z.object({
    location: z.string().describe("City name"),
  }),
  async ({ location }) => {
    // Implement weather API call
    return { temperature: 22, condition: "Sunny" };
  },
);

const agents = factory.defineAgents({
  weatherBot: {
    name: "Weather Bot",
    model: await getModel("gpt4o"),
    tools: { weather: weatherTool },
  },
});
```

## Basic Usage

### Simple Text Generation

```typescript
const agent = agents.get("assistant");

// Basic generation
const result = await agent.generate("Write a haiku about coding");
console.log(result.content);
console.log("Tokens used:", result.usage?.totalTokens);
```

### Streaming Responses

```typescript
// Stream text as it generates
const stream = agent.generateStream("Tell me a story");

for await (const chunk of stream) {
  if (typeof chunk === "string") {
    process.stdout.write(chunk);
  } else {
    // Final result
    console.log("\nFinal result:", chunk);
    break;
  }
}
```

### Tool Execution

```typescript
const result = await agent.generate("What is the weather in London?");

// Check if tools were called
if (result.toolCalls && result.toolCalls.length > 0) {
  for (const call of result.toolCalls) {
    console.log(`Called ${call.name} with:`, call.input);
    console.log(`Result:`, call.result);
  }
}
```

### File Processing

```typescript
import { processFiles, type FileInput } from "@airo/ai-lib";

const files: FileInput[] = [
  {
    path: "./document.pdf",
    description: "Technical specification",
  },
  {
    content: "Raw text content",
    filename: "notes.txt",
  },
];

const fileContext = await processFiles(files);
console.log("Processed files:", fileContext.files.length);

const result = await agent.generate("Summarize these documents", {
  files: fileContext.files,
});
```

### Embeddings

```typescript
import {
  getEmbeddingModel,
  cosineSimilarity,
  findMostSimilar,
} from "@airo/ai-lib";

const embedModel = await getEmbeddingModel("text-embedding-3-small");

const texts = [
  "Machine learning is fascinating",
  "AI will transform the world",
  "The weather is nice today",
];

// Generate embeddings using the embedding model directly
// ...

// Find similarity
const queryEmbedding = [
  /* embedding vector */
];
const allEmbeddings = [
  /* array of embedding vectors */
];
const similarTexts = findMostSimilar(queryEmbedding, allEmbeddings, texts, 2);
console.log("Most similar:", similarTexts);
```

## Advanced Features

### Agent Factory

Create and manage agents centrally:

```typescript
import { createAgentFactory, getModel } from "@airo/ai-lib";

const factory = createAgentFactory({
  defaultTemperature: 0.7,
});

// Define specialized agents
const agents = factory.defineAgents({
  coder: {
    name: "Code Assistant",
    systemPrompt: "You are an expert programmer.",
    model: await getModel("gpt4o"),
  },
  writer: {
    name: "Content Writer",
    systemPrompt: "You write engaging content.",
    model: await getModel("gpt4o-mini"),
    temperature: 0.9,
  },
});

const coder = agents.get("coder");
const writer = agents.get("writer");
```

### Custom Message Builders

Control message formatting:

```typescript
import {
  createCachingMessageBuilder,
  createConversationMessageBuilder,
} from "@airo/ai-lib";

// Caching message builder (for Anthropic)
const cachingBuilder = createCachingMessageBuilder("You are helpful.", {
  cacheSystemPrompt: true,
});

// Conversation memory
const conversationBuilder = createConversationMessageBuilder(
  "You are helpful.",
  { maxHistory: 10 },
);

const agents = factory.defineAgents({
  memoryAgent: {
    name: "Memory Agent",
    model: await getModel("gpt4o"),
    messageBuilder: conversationBuilder,
  },
});

// Context persists across calls
const agent = agents.get("memoryAgent");
await agent.generate("My name is John");
await agent.generate("What is my name?"); // Remembers "John"
```

### WebSocket Integration

For real-time applications:

```typescript
import { createWebSocketServer } from "@airo/ai-transport";

const wsServer = createWebSocketServer({
  port: 8080,
  agents: {
    assistant: agents.get("assistant"),
    coder: agents.get("coder"),
  },
  onConnection: (socket, agentId) => {
    console.log(`Client connected to ${agentId}`);
  },
});

// Client side (browser/Node.js)
import { io } from "socket.io-client";

const socket = io("http://localhost:8080");
socket.emit("agent:message", {
  agentId: "assistant",
  message: "Hello!",
  stream: true,
});

socket.on("agent:chunk", (chunk) => {
  console.log("Received:", chunk);
});
```

## Provider Configuration

### OpenAI Setup

```typescript
import { getModel } from "@airo/ai-lib";

// Set OPENAI_API_KEY in environment, then:
const model = await getModel("gpt4o");

// Or with explicit config:
const model = await getModel("gpt4o", {
  openaiApiKey: "sk-...",
  openaiBaseUrl: "https://your-proxy.com/v1",
});
```

### AWS Bedrock Setup

```typescript
import { getModel } from "@airo/ai-lib";

// Environment variables
process.env.AWS_REGION = "us-west-2";
process.env.AWS_PROFILE = "your-profile";

// Or programmatic credentials
const model = await getModel("sonnet", {
  awsRegion: "us-east-1",
  awsAccessKeyId: "your-key",
  awsSecretAccessKey: "your-secret",
});

// Available Claude models via getModel():
const sonnet = await getModel("sonnet");
const haiku = await getModel("haiku");
```

### Checking Available Models

```typescript
import { getAvailableModels, isModelSupported } from "@airo/ai-lib";

// List all available model short names
const models = getAvailableModels();
console.log(models); // ['gpt4o', 'gpt4o-mini', 'sonnet', 'haiku', ...]

// Check if a model name is supported
console.log(isModelSupported("gpt4o")); // true
console.log(isModelSupported("fake")); // false
```

## Error Handling

### Basic Error Handling

```typescript
try {
  const result = await agent.generate("Hello");
  console.log(result.content);
} catch (error) {
  if (error.name === "InvalidArgumentError") {
    console.error("Invalid input:", error.message);
  } else if (error.name === "NoOutputGeneratedError") {
    console.error("No response generated");
  } else {
    console.error("Unexpected error:", error);
  }
}
```

### Tool Execution Errors

```typescript
const result = await agent.executeWithTools("Use the broken tool");

// Check for tool execution errors
for (const execution of result.toolExecutions) {
  if (!execution.success) {
    console.error(`Tool ${execution.toolName} failed:`, execution.error);
  }
}
```

### Provider-Specific Errors

```typescript
try {
  const result = await agent.generate("Hello");
} catch (error) {
  if (error.message.includes("credentials")) {
    console.error("AWS credentials issue. Run: aws sso login");
  } else if (error.message.includes("rate limit")) {
    console.error("Rate limited. Wait before retrying.");
  } else if (error.message.includes("model access")) {
    console.error("Model not available in your region/account");
  }
}
```

### Retry Logic

```typescript
async function generateWithRetry(
  agent: AgentWrapper,
  prompt: string,
  maxRetries = 3,
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await agent.generate(prompt);
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      const delay = Math.pow(2, i) * 1000; // Exponential backoff
      console.log(`Retry ${i + 1} in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

## Best Practices

### 1. Environment Configuration

```typescript
// .env file
OPENAI_API_KEY=sk-...

// Validation
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required')
}
```

### 2. Model Selection

```typescript
import { getModel } from "@airo/ai-lib";

// Use short names — getModel() resolves the full model ID automatically
const production = await getModel("sonnet");
const fast = await getModel("gpt4o-mini");
```

### 3. Resource Management

```typescript
// Reuse agents — define once, use everywhere
const factory = createAgentFactory();
const agents = factory.defineAgents({
  assistant: {
    name: "Assistant",
    model: await getModel("gpt4o"),
    systemPrompt: "...",
  },
  coder: { name: "Coder", model: await getModel("gpt4o"), systemPrompt: "..." },
});

// Get agents by ID
const assistant = agents.get("assistant");
const coder = agents.get("coder");
```

### 4. Token Usage Monitoring

```typescript
class TokenTracker {
  private usage = new Map<string, number>();

  track(agentName: string, tokens: number) {
    const current = this.usage.get(agentName) || 0;
    this.usage.set(agentName, current + tokens);
  }

  getUsage(agentName: string): number {
    return this.usage.get(agentName) || 0;
  }
}

const tracker = new TokenTracker();

// After each generation
const result = await agent.generate(prompt);
if (result.usage) {
  tracker.track(agent.getConfig().name, result.usage.totalTokens);
}
```

### 5. Structured Output

```typescript
import { z } from "zod";

const ResponseSchema = z.object({
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  categories: z.array(z.string()),
});

// Add schema validation to your prompts
const prompt = `
Analyze this text and respond with JSON matching this schema:
${JSON.stringify(ResponseSchema.shape, null, 2)}

Text: "${inputText}"
`;

const result = await agent.generate(prompt);
const parsed = ResponseSchema.parse(JSON.parse(result.content));
```

## Troubleshooting

### Common Issues

**"Failed to generate Bedrock embeddings"**

```typescript
// Fix: Check AWS credentials and region
console.log("AWS Region:", process.env.AWS_REGION);
console.log("AWS Profile:", process.env.AWS_PROFILE);

// Test model support
import { isModelSupported } from "@airo/ai-lib";
console.log(isModelSupported("sonnet")); // true
```

**"Cannot read properties of undefined (reading 'textStream')"**

```typescript
// Fix: Use getModel() to get a proper model instance
import { getModel } from "@airo/ai-lib";
const model = await getModel("sonnet");
// Don't pass a string where a LanguageModel instance is expected
// e.g., generateText({ model: "claude-sonnet-4-6" }) will fail
```

**TypeScript compilation errors**

```typescript
// Fix: Install type dependencies
pnpm add @types/node
// Ensure tsconfig.json includes:
{
  "compilerOptions": {
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  }
}
```

### Debug Mode

```typescript
// Enable debug logging
process.env.DEBUG = "true";
process.env.NODE_ENV = "development";

// Now agents will log detailed information
const result = await agent.generate("Hello");
// Logs: Raw AI SDK Response, token usage, etc.
```

### Performance Monitoring

```typescript
class PerformanceMonitor {
  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await operation();
      const duration = Date.now() - start;
      console.log(`${name}: ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`${name} failed after ${duration}ms:`, error);
      throw error;
    }
  }
}

const monitor = new PerformanceMonitor();

const result = await monitor.measure("agent-generation", () =>
  agent.generate("Complex reasoning task..."),
);
```

## API Reference

### Core Classes

#### AgentWrapper

```typescript
class AgentWrapper {
  generate(input: string, context?: AgentContext): Promise<AgentResult>;
  generateStream(
    input: string,
    context?: AgentContext,
  ): AsyncGenerator<string, AgentResult>;
  executeWithTools(
    input: string,
    context?: AgentContext,
  ): Promise<AgentResult & { toolExecutions: ToolExecutionResult[] }>;

  getConfig(): AgentConfig;
  hasTools(): boolean;
  getTools(): Record<string, any>;
}
```

#### AgentFactory

```typescript
class AgentFactory {
  constructor(config?: GlobalAgentConfig);
  defineAgents<T>(configs: T): AgentsCollection;
}

function createAgentFactory(config?: GlobalAgentConfig): AgentFactory;
```

### Model Functions

```typescript
// Get a language model by short name
function getModel(
  modelName: string,
  config?: ProviderConfig,
): Promise<LanguageModel>;

// Get an embedding model by short name
function getEmbeddingModel(
  modelName: string,
  config?: ProviderConfig,
): Promise<EmbeddingModel>;

// List available model short names
function getAvailableModels(): string[];

// Check if a model name is supported
function isModelSupported(modelName: string): boolean;
```

### Type Definitions

```typescript
interface AgentConfig {
  name: string;
  systemPrompt?: string;
  model: LanguageModel | string;
  tools?: ToolSet;
  temperature?: number;
  maxTokens?: number;
  enableLoopControl?: boolean;
  providerOptions?: any;
  messageBuilder?: MessageBuilder;
}

interface AgentResult {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
  caching?: CachingMetrics;
  metadata?: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  name: string;
  input: any;
  result?: any;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
}
```

### Utility Functions

```typescript
// Embeddings utilities
export function cosineSimilarity(a: number[], b: number[]): number;
export function findMostSimilar(
  queryEmbedding: number[],
  embeddings: number[][],
  texts: string[],
  topK?: number,
): Array<{ text: string; similarity: number; index: number }>;

// Tool creation
export function createTool<TInput, TOutput>(
  description: string,
  schema: z.ZodSchema<TInput>,
  execute: (input: TInput) => Promise<TOutput> | TOutput,
): Tool<TInput, TOutput>;
```

## Migration Guide

### From AI SDK Direct Usage

```typescript
// Before (AI SDK direct)
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await generateText({
  model: openai("gpt-4"),
  messages: [{ role: "user", content: "Hello" }],
});

// After (AI-Lib)
import { createAgentFactory, getModel } from "@airo/ai-lib";

const factory = createAgentFactory();
const agents = factory.defineAgents({
  assistant: {
    name: "Assistant",
    model: await getModel("gpt4o"),
    systemPrompt: "You are helpful.",
  },
});
const result = await agents.get("assistant").generate("Hello");
```

### From Custom AI Wrappers

```typescript
// Before (custom wrapper)
class MyAI {
  async chat(message: string) {
    // Custom implementation
  }
}

// After (AI-Lib)
import { createAgentFactory, getModel } from "@airo/ai-lib";

const factory = createAgentFactory();
const agents = factory.defineAgents({
  myAI: {
    name: "MyAI",
    model: await getModel("gpt4o"),
    systemPrompt: "Your existing system prompt",
  },
});
// Use agents.get('myAI').generate() instead of chat()
```

---

## Support

For issues or questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Review examples in `/examples` directory
3. Enable debug mode for detailed logging
4. Check TypeScript compilation with `pnpm run typecheck`
