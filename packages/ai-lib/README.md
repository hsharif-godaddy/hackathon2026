# @airo/ai-lib

A lightweight, type-safe wrapper around AI SDK 5 for building reusable AI agents with factory pattern management.

## Features

- 🏭 **Factory Pattern**: Define all agents in one place, use them everywhere
- 🔧 **AI SDK 5 Native**: Built on the latest AI SDK with agentic loop control
- 🎯 **Type Safe**: Full TypeScript support with proper type inference
- 🔌 **Multi-Provider**: Support for OpenAI, Anthropic, Bedrock, and custom providers
- 🛠️ **Tool System**: Extensible tool system with built-in tools
- 📡 **Streaming**: Full streaming support with custom data parts
- ⚡ **Lightweight**: Minimal overhead, maximum flexibility

## Installation

```bash
npm install @airo/ai-lib ai
```

**OpenAI and AWS Bedrock support included out of the box!** 🎉

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
import { AgentFactory, tools, openAIModels, bedrockModels } from '@airo/ai-lib'

// OpenAI and Bedrock models work out of the box
const agents = agentFactory.defineAgents({
  openaiAgent: {
    name: 'OpenAI Assistant',
    systemPrompt: 'You are helpful.',
    model: openAIModels.gpt4oMini(), // Uses OPENAI_API_KEY
  },
  
  claudeAgent: {
    name: 'Claude Assistant', 
    systemPrompt: 'You are Claude.',
    model: bedrockModels.claudeSonnet4(), // Uses AWS credentials
  }
})
```

Or with manual configuration:

```typescript
import { AgentFactory, tools, EnvConfig } from '@airo/ai-lib'
import { createOpenAI } from '@ai-sdk/openai'

// Manual configuration
const config = EnvConfig.getDefaultConfig()
const openai = createOpenAI({ 
  apiKey: config.apiKey,
  baseURL: config.baseURL // Supports OPENAI_BASE_URL
})
```

Or with the provider registry:

```typescript
import { setDefaultProvider } from '@airo/ai-lib'

// Configure your default provider
setDefaultProvider('openai', {
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL
})
```

### Advanced: Prompt Caching (Bedrock)

AWS Bedrock supports prompt caching to reduce costs and improve performance:

```typescript
import { bedrockModels } from '@airo/ai-lib'

const agents = agentFactory.defineAgents({
  cachedAgent: {
    name: 'Cached Code Reviewer',
    systemPrompt: 'Your large system prompt here...', // Will be cached
    model: bedrockModels.claudeSonnet4(),
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' }
      }
    }
  }
})
```

### 2. Define your agents

```typescript
// agents/index.ts
import { AgentFactory, tools } from '@airo/ai-lib'

const agentFactory = new AgentFactory({
  defaultModel: 'gpt-4o',
  defaultTemperature: 0.7,
  globalTools: [tools.webSearch()]
})

export const agents = agentFactory.defineAgents({
  assistant: {
    name: 'General Assistant',
    systemPrompt: 'You are a helpful AI assistant.',
    model: openai('gpt-4o-mini'), // Use actual model instance
    temperature: 0.7
  },

  developer: {
    name: 'Development Assistant',
    systemPrompt: 'You are an expert software developer.',
    model: openai('gpt-4o'), // Use more powerful model for development
    temperature: 0.1,
    tools: [
      tools.readFile(),
      tools.writeFile(),
      tools.listDirectory()
    ]
  },

  writer: {
    name: 'Creative Writer',
    systemPrompt: 'You are a creative writing assistant.',
    model: openai('gpt-4o'),
    temperature: 0.9,
    maxTokens: 3000
  }
})

export const getAgent = agents.get
export type AgentType = keyof typeof agents.definitions
```

### 3. Use agents anywhere

```typescript
// In an API route
import { getAgent } from './agents'

export async function POST(request: Request) {
  const { message, agentType = 'assistant' } = await request.json()
  
  const agent = getAgent(agentType)
  const response = await agent.generate(message)
  
  return Response.json({ response: response.content })
}
```

```typescript
// In a CLI tool
import { getAgent } from './agents'

const developer = getAgent('developer')
const result = await developer.runAgenticLoop(
  'Create a TypeScript function to calculate fibonacci numbers',
  { maxSteps: 3 }
)
console.log(result.content)
```

```typescript
// Streaming
const writer = getAgent('writer')
for await (const chunk of writer.generateStream('Write a story about AI')) {
  process.stdout.write(chunk)
}
```

## Advanced Usage

### Custom Tools

```typescript
import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

const weatherTool = createTool(
  'get_weather',
  'Get current weather for a location',
  z.object({
    location: z.string(),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius')
  }),
  async ({ location, units }) => {
    // Your weather API integration
    return { temperature: 22, units, location }
  }
)

// Use in agent definition
export const agents = agentFactory.defineAgents({
  weatherBot: {
    name: 'Weather Assistant',
    systemPrompt: 'You help users with weather information.',
    tools: [weatherTool]
  }
})
```

### Environment-Specific Configuration

```typescript
const isDev = process.env.NODE_ENV === 'development'

const agentFactory = new AgentFactory({
  defaultModel: isDev ? 'gpt-4o-mini' : 'gpt-4o',
  defaultTemperature: isDev ? 0.8 : 0.7,
  globalTools: isDev ? [tools.debug()] : []
})
```

### Multiple Providers

```typescript
import { configureProvider } from '@airo/ai-lib'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'

// Configure multiple providers
configureProvider('openai-gpt4', {
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY
})

configureProvider('claude', {
  type: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY
})

// Use specific models
export const agents = agentFactory.defineAgents({
  fastAgent: {
    name: 'Fast Agent',
    model: createOpenAI()('gpt-4o-mini'),
    systemPrompt: 'You provide quick responses.'
  },
  
  smartAgent: {
    name: 'Smart Agent',
    model: createAnthropic()('claude-3-5-sonnet-20241022'),
    systemPrompt: 'You provide detailed, thoughtful responses.'
  }
})
```

## API Reference

### AgentFactory

```typescript
class AgentFactory {
  constructor(globalConfig?: GlobalAgentConfig)
  defineAgents<T>(configs: T): AgentRegistry<T>
  createAgent(config: AgentConfig & { id: string }): Agent
  updateGlobalConfig(config: Partial<GlobalAgentConfig>): void
}
```

### Agent

```typescript
class Agent {
  generate(input: string, context?: AgentContext): Promise<AgentResult>
  generateStream(input: string, context?: AgentContext): AsyncGenerator<string>
  runAgenticLoop(input: string, options?: AgenticLoopOptions): Promise<AgentResult>
  executeWithTools(input: string, context?: AgentContext): Promise<AgentResult & { toolExecutions: ToolExecutionResult[] }>
}
```

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
- `bedrock-claude.ts` - AWS Bedrock + Claude Sonnet 4 example with comparisons
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

# AWS Bedrock + Claude Sonnet 4 example (requires AWS credentials)
npm run example:bedrock

# Simple prompt caching demo with metrics (cost optimization)
npm run example:caching

# Auto-detect provider setup
npm run example:setup

# Check your setup
npm run setup
```

## License

MIT
