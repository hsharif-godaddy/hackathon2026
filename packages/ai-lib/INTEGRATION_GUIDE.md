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
pnpm add @ai-sdk/openai @ai-sdk/amazon-bedrock
```

### 2. Install Optional Dependencies

```bash
# For AWS Bedrock support
pnpm add @aws-sdk/client-bedrock-runtime @aws-sdk/credential-providers

# For WebSocket features
pnpm add socket.io socket.io-client

# For file processing
pnmp add zod
```

## Quick Start

### Basic Agent Setup

```typescript
import { Agent, openaiModels } from '@airo/ai-lib'

// Create a simple agent
const model = openaiModels.gpt4o({
  apiKey: process.env.OPENAI_API_KEY
})

const agent = new Agent({
  name: 'Assistant',
  systemPrompt: 'You are a helpful AI assistant.',
  model: model,
  temperature: 0.7
})

// Generate a response
const result = await agent.generate('Hello, how are you?')
console.log(result.content)
```

### With AWS Bedrock

```typescript
import { Agent, bedrockModels } from '@airo/ai-lib'

// Set AWS credentials in environment
process.env.AWS_REGION = 'us-west-2'
process.env.AWS_PROFILE = 'your-profile'

const model = await bedrockModels.claudeSonnet4()
const agent = new Agent({
  name: 'Claude Assistant', 
  model: model,
  systemPrompt: 'You are Claude, an AI assistant.'
})

const result = await agent.generate('Explain quantum computing')
```

## Core Concepts

### Agents

Agents are the main interface for AI interactions:

```typescript
interface AgentConfig {
  name: string                    // Agent identifier
  systemPrompt?: string          // System instructions
  model: LanguageModel | string  // AI model instance or string ID
  tools?: ToolSet               // Available tools
  temperature?: number          // Response randomness (0-1)
  maxTokens?: number           // Maximum response length
  messageBuilder?: MessageBuilder // Custom message formatting
}
```

### Models

The library supports multiple AI providers:

```typescript
// OpenAI models
import { openaiModels } from '@airo/ai-lib'
const gpt4 = openaiModels.gpt4o({ apiKey: 'sk-...' })
const gpt35 = openaiModels.gpt35Turbo({ apiKey: 'sk-...' })

// Bedrock models
import { bedrockModels } from '@airo/ai-lib'
const claude = await bedrockModels.claudeSonnet4()
const titan = await bedrockModels.titanImage()
```

### Tools

Tools extend agent capabilities:

```typescript
import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

const weatherTool = createTool(
  'Get weather information',
  z.object({
    location: z.string().describe('City name')
  }),
  async ({ location }) => {
    // Implement weather API call
    return { temperature: 22, condition: 'Sunny' }
  }
)

const agent = new Agent({
  name: 'Weather Bot',
  model: model,
  tools: { weather: weatherTool }
})
```

## Basic Usage

### Simple Text Generation

```typescript
import { Agent } from '@airo/ai-lib'

// Basic generation
const result = await agent.generate('Write a haiku about coding')
console.log(result.content)
console.log('Tokens used:', result.usage?.totalTokens)
```

### Streaming Responses

```typescript
// Stream text as it generates
const stream = agent.generateStream('Tell me a story')

for await (const chunk of stream) {
  if (typeof chunk === 'string') {
    process.stdout.write(chunk)
  } else {
    // Final result
    console.log('\nFinal result:', chunk)
    break
  }
}
```

### Tool Execution

```typescript
const result = await agent.generate('What is the weather in London?')

// Check if tools were called
if (result.toolCalls && result.toolCalls.length > 0) {
  for (const call of result.toolCalls) {
    console.log(`Called ${call.name} with:`, call.input)
    console.log(`Result:`, call.result)
  }
}
```

### File Processing

```typescript
import { FileInput } from '@airo/ai-lib'

const files: FileInput[] = [
  {
    path: './document.pdf',
    description: 'Technical specification'
  },
  {
    content: 'Raw text content',
    filename: 'notes.txt'
  }
]

const result = await agent.processFiles(
  files,
  'Summarize these documents'
)
console.log(result.content)
console.log('Processed files:', result.fileContext.files.length)
```

### Image Generation

```typescript
import { bedrockModels } from '@airo/ai-lib'

const imageModel = await bedrockModels.titanImage()
const agent = new Agent({
  name: 'Artist',
  model: imageModel
})

const result = await agent.generateImage({
  prompt: 'A serene mountain landscape at sunset',
  size: '1024x1024',
  n: 1
})

if (result.images[0]?.base64) {
  // Save or display the image
  const buffer = Buffer.from(result.images[0].base64, 'base64')
  await fs.writeFile('image.png', buffer)
}
```

### Embeddings

```typescript
import { bedrockModels } from '@airo/ai-lib'

const embedModel = await bedrockModels.titanEmbedText()
const agent = new Agent({
  name: 'Embedder',
  model: embedModel
})

const texts = [
  'Machine learning is fascinating',
  'AI will transform the world',
  'The weather is nice today'
]

const result = await agent.generateEmbeddings(texts)

// Find similarity
import { cosineSimilarity, findMostSimilar } from '@airo/ai-lib'

const queryEmbedding = result.embeddings[0].embedding
const similarTexts = findMostSimilar(
  queryEmbedding,
  result.embeddings.map(e => e.embedding),
  texts,
  2
)
console.log('Most similar:', similarTexts)
```

## Advanced Features

### Provider Registry

Configure providers globally:

```typescript
import { 
  providerRegistry, 
  configureProvider,
  setDefaultProvider 
} from '@airo/ai-lib'

// Configure OpenAI provider
configureProvider('gpt-4', {
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL
})

// Configure Bedrock provider
configureProvider('claude', {
  type: 'bedrock',
  options: {
    region: 'us-west-2',
    profile: 'default'
  }
})

// Set default
setDefaultProvider('gpt-4')

// Now use string model IDs
const agent = new Agent({
  name: 'Smart Agent',
  model: 'claude', // Uses configured provider
  systemPrompt: 'You are helpful.'
})
```

### Agent Factory

Create agents from configurations:

```typescript
import { createAgentFactory, AgentFactory } from '@airo/ai-lib'

const factory = createAgentFactory({
  defaultModel: 'gpt-4',
  defaultTemperature: 0.7,
  globalTools: {
    search: searchTool,
    calculator: calcTool
  }
})

// Create specialized agents
const coder = factory.createAgent({
  name: 'Code Assistant',
  systemPrompt: 'You are an expert programmer.',
  tools: ['search'] // Subset of global tools
})

const writer = factory.createAgent({
  name: 'Content Writer',
  systemPrompt: 'You write engaging content.',
  temperature: 0.9
})
```

### Custom Message Builders

Control message formatting:

```typescript
import { 
  createCachingMessageBuilder,
  createConversationMessageBuilder 
} from '@airo/ai-lib'

// Caching message builder (for Anthropic)
const cachingBuilder = createCachingMessageBuilder(
  'You are helpful.',
  { cacheSystemPrompt: true }
)

// Conversation memory
const conversationBuilder = createConversationMessageBuilder(
  'You are helpful.',
  { maxHistory: 10 }
)

const agent = new Agent({
  name: 'Memory Agent',
  model: model,
  messageBuilder: conversationBuilder
})

// Context persists across calls
await agent.generate('My name is John')
await agent.generate('What is my name?') // Remembers "John"
```

### Streaming Agentic Runner

For complex multi-step reasoning:

```typescript
import { createStreamingAgenticRunner } from '@airo/ai-lib'

const runner = createStreamingAgenticRunner(agent, {
  maxSteps: 5,
  onStepStart: (step) => console.log(`Step ${step}: Starting...`),
  onStepComplete: (step, result) => console.log(`Step ${step}: ${result.content}`),
  onToolCall: (tool, input) => console.log(`Calling ${tool} with`, input)
})

const result = await runner.runStreamingLoopWithCallbacks(
  'Research and write a summary about quantum computing',
  { maxSteps: 3 }
)
```

### WebSocket Integration

For real-time applications:

```typescript
import { createWebSocketServer } from '@airo/ai-lib'

const wsServer = createWebSocketServer({
  port: 8080,
  agents: {
    'assistant': agent,
    'coder': coder
  },
  onConnection: (socket, agentId) => {
    console.log(`Client connected to ${agentId}`)
  }
})

// Client side (browser/Node.js)
import { io } from 'socket.io-client'

const socket = io('http://localhost:8080')
socket.emit('agent:message', {
  agentId: 'assistant',
  message: 'Hello!',
  stream: true
})

socket.on('agent:chunk', (chunk) => {
  console.log('Received:', chunk)
})
```

## Provider Configuration

### OpenAI Setup

```typescript
import { openaiModels } from '@airo/ai-lib'

// Basic configuration
const model = openaiModels.gpt4o({
  apiKey: process.env.OPENAI_API_KEY
})

// Custom configuration
const model = openaiModels.gpt35Turbo({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://your-proxy.com/v1',
  defaultQuery: { 
    timeout: 30000 
  }
})
```

### AWS Bedrock Setup

```typescript
// Environment variables
process.env.AWS_REGION = 'us-west-2'
process.env.AWS_PROFILE = 'your-profile'

// Or programmatic credentials
import { bedrockModels } from '@airo/ai-lib'

const model = await bedrockModels.claudeSonnet4({
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'your-key',
    secretAccessKey: 'your-secret'
  }
})

// Available models
const claude4 = await bedrockModels.claudeSonnet4()
const claude35 = await bedrockModels.claude35Sonnet() 
const titanText = await bedrockModels.titanText()
const titanImage = await bedrockModels.titanImage()
const titanEmbed = await bedrockModels.titanEmbedText()
```

### Model Status Checking

```typescript
import { checkBedrockModelAccess } from '@airo/ai-lib'

const models = [
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'amazon.titan-image-generator-v1'
]

for (const modelId of models) {
  const hasAccess = await checkBedrockModelAccess(modelId)
  console.log(`${modelId}: ${hasAccess ? 'Available' : 'Not accessible'}`)
}
```

## Error Handling

### Basic Error Handling

```typescript
try {
  const result = await agent.generate('Hello')
  console.log(result.content)
} catch (error) {
  if (error.name === 'InvalidArgumentError') {
    console.error('Invalid input:', error.message)
  } else if (error.name === 'NoOutputGeneratedError') {
    console.error('No response generated')
  } else {
    console.error('Unexpected error:', error)
  }
}
```

### Tool Execution Errors

```typescript
const result = await agent.executeWithTools('Use the broken tool')

// Check for tool execution errors
for (const execution of result.toolExecutions) {
  if (!execution.success) {
    console.error(`Tool ${execution.toolName} failed:`, execution.error)
  }
}
```

### Provider-Specific Errors

```typescript
try {
  const result = await agent.generate('Hello')
} catch (error) {
  if (error.message.includes('credentials')) {
    console.error('AWS credentials issue. Run: aws sso login')
  } else if (error.message.includes('rate limit')) {
    console.error('Rate limited. Wait before retrying.')
  } else if (error.message.includes('model access')) {
    console.error('Model not available in your region/account')
  }
}
```

### Retry Logic

```typescript
async function generateWithRetry(agent: Agent, prompt: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await agent.generate(prompt)
    } catch (error) {
      if (i === maxRetries - 1) throw error
      
      const delay = Math.pow(2, i) * 1000 // Exponential backoff
      console.log(`Retry ${i + 1} in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}
```

## Best Practices

### 1. Environment Configuration

```typescript
// .env file
OPENAI_API_KEY=sk-...
AWS_REGION=us-west-2
AWS_PROFILE=default

// Validation
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required')
}
```

### 2. Model Selection

```typescript
// Production: Use specific model versions
const model = await bedrockModels.claude35Sonnet({
  modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
})

// Development: Use latest
const model = await bedrockModels.claude35Sonnet()
```

### 3. Resource Management

```typescript
// Reuse agents and models
const agentPool = new Map<string, Agent>()

function getAgent(type: string): Agent {
  if (!agentPool.has(type)) {
    agentPool.set(type, createAgentForType(type))
  }
  return agentPool.get(type)!
}
```

### 4. Token Usage Monitoring

```typescript
class TokenTracker {
  private usage = new Map<string, number>()
  
  track(agentName: string, tokens: number) {
    const current = this.usage.get(agentName) || 0
    this.usage.set(agentName, current + tokens)
  }
  
  getUsage(agentName: string): number {
    return this.usage.get(agentName) || 0
  }
}

const tracker = new TokenTracker()

// After each generation
const result = await agent.generate(prompt)
if (result.usage) {
  tracker.track(agent.getConfig().name, result.usage.totalTokens)
}
```

### 5. Structured Output

```typescript
import { z } from 'zod'

const ResponseSchema = z.object({
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  categories: z.array(z.string())
})

// Add schema validation to your prompts
const prompt = `
Analyze this text and respond with JSON matching this schema:
${JSON.stringify(ResponseSchema.shape, null, 2)}

Text: "${inputText}"
`

const result = await agent.generate(prompt)
const parsed = ResponseSchema.parse(JSON.parse(result.content))
```

## Troubleshooting

### Common Issues

**"String model IDs require global provider setup"**
```typescript
// Fix: Configure provider registry
import { configureProvider, setDefaultProvider } from '@airo/ai-lib'
configureProvider('gpt-4', { type: 'openai', apiKey: '...' })
setDefaultProvider('gpt-4')
```

**"Failed to generate Bedrock embeddings"**
```typescript
// Fix: Check AWS credentials and region
console.log('AWS Region:', process.env.AWS_REGION)
console.log('AWS Profile:', process.env.AWS_PROFILE)

// Test credentials
import { checkBedrockModelAccess } from '@airo/ai-lib'
const hasAccess = await checkBedrockModelAccess('amazon.titan-embed-text-v1')
```

**"Cannot read properties of undefined (reading 'textStream')"**
```typescript
// Fix: Ensure proper model configuration
const model = await bedrockModels.claudeSonnet4()
// Don't use: const model = 'claude-3-5-sonnet' (string without provider)
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
process.env.DEBUG = 'true'
process.env.NODE_ENV = 'development'

// Now agents will log detailed information
const result = await agent.generate('Hello')
// Logs: Raw AI SDK Response, token usage, etc.
```

### Performance Monitoring

```typescript
class PerformanceMonitor {
  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      const result = await operation()
      const duration = Date.now() - start
      console.log(`${name}: ${duration}ms`)
      return result
    } catch (error) {
      const duration = Date.now() - start
      console.error(`${name} failed after ${duration}ms:`, error)
      throw error
    }
  }
}

const monitor = new PerformanceMonitor()

const result = await monitor.measure('agent-generation', () =>
  agent.generate('Complex reasoning task...')
)
```

## API Reference

### Core Classes

#### Agent
```typescript
class Agent {
  constructor(config: AgentConfig)
  
  async generate(input: string, context?: AgentContext): Promise<AgentResult>
  generateStream(input: string, context?: AgentContext): AsyncGenerator<string, AgentResult>
  async executeWithTools(input: string, context?: AgentContext): Promise<AgentResult & { toolExecutions: ToolExecutionResult[] }>
  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult>
  async generateEmbeddings(values: string | string[], options?: EmbeddingOptions): Promise<EmbeddingsResult>
  async processFiles(files: FileInput[], prompt: string, context?: AgentContext): Promise<AgentResult & { fileContext: FileInputContext }>
  
  getConfig(): AgentConfig
  hasTools(): boolean
  getTools(): Record<string, any>
}
```

#### AgentFactory
```typescript
class AgentFactory {
  constructor(config: AgentFactoryConfig)
  
  createAgent(config: Partial<AgentConfig>): Agent
  getDefaultModel(): LanguageModel
  setDefaultModel(model: LanguageModel): void
  registerGlobalTool(name: string, tool: any): void
  listAvailableTools(): string[]
}
```

### Type Definitions

```typescript
interface AgentConfig {
  name: string
  systemPrompt?: string
  model: LanguageModel | string
  tools?: ToolSet
  temperature?: number
  maxTokens?: number
  enableLoopControl?: boolean
  providerOptions?: any
  messageBuilder?: MessageBuilder
}

interface AgentResult {
  content: string
  toolCalls?: ToolCall[]
  usage?: TokenUsage
  finishReason?: string
  caching?: CachingMetrics
  metadata?: Record<string, unknown>
}

interface ToolCall {
  id: string
  name: string
  input: any
  result?: any
}

interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
}
```

### Utility Functions

```typescript
// Embeddings utilities
export function cosineSimilarity(a: number[], b: number[]): number
export function findMostSimilar(
  queryEmbedding: number[], 
  embeddings: number[][], 
  texts: string[], 
  topK?: number
): Array<{ text: string, similarity: number, index: number }>

// Tool creation
export function createTool<TInput, TOutput>(
  description: string,
  schema: z.ZodSchema<TInput>,
  execute: (input: TInput) => Promise<TOutput> | TOutput
): Tool<TInput, TOutput>

// Provider management
export function configureProvider(name: string, config: ProviderConfig): void
export function setDefaultProvider(name: string): void
export const providerRegistry: ProviderRegistry
```

## Migration Guide

### From AI SDK Direct Usage

```typescript
// Before (AI SDK direct)
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const result = await generateText({
  model: openai('gpt-4'),
  messages: [{ role: 'user', content: 'Hello' }]
})

// After (AI-Lib)
import { Agent, openaiModels } from '@airo/ai-lib'

const model = openaiModels.gpt4o({ apiKey: '...' })
const agent = new Agent({ name: 'Assistant', model })
const result = await agent.generate('Hello')
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
import { Agent } from '@airo/ai-lib'

const agent = new Agent({
  name: 'MyAI',
  model: model,
  systemPrompt: 'Your existing system prompt'
})
// Use agent.generate() instead of chat()
```

---

## Support

For issues or questions:
1. Check the [troubleshooting section](#troubleshooting)
2. Review examples in `/examples` directory
3. Enable debug mode for detailed logging
4. Check TypeScript compilation with `pnpm run typecheck`

The AI-Lib package provides a robust, type-safe foundation for AI applications with support for multiple providers, advanced features like streaming and tool execution, and comprehensive error handling.