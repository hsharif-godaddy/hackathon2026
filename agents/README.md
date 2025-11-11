# @airo/agents

A modern, class-based AI agent library with HTTP streaming endpoints. This library transforms the traditional markdown-based agent configuration approach into a more robust, TypeScript-first architecture.

## 🚀 Features

- **Class-based Agents**: Define agents using TypeScript classes with shared interfaces
- **HTTP Streaming**: Real-time streaming chat endpoints with Server-Sent Events
- **Agent Registry**: Automatic discovery and management of agent instances
- **Modular Architecture**: Clean separation between agent logic, server, and configuration
- **Type Safety**: Full TypeScript support with strict typing
- **Extensible**: Easy to extend with custom agents and middleware

## 📁 Architecture

```
src/
├── base/                 # Core interfaces and base classes
│   ├── agent.interface.ts
│   └── base-agent.ts
├── agents/               # Individual agent implementations
│   ├── example-agent.ts
│   └── mwp-agent.ts
├── registry/             # Agent discovery and management
│   └── agent-registry.ts
├── server/               # HTTP server and routes
│   ├── routes/
│   ├── middleware/
│   └── app.ts
├── prompts/              # Markdown files for system prompts
│   ├── example-agent.md
│   └── mwp-agent.md
└── utils/                # Utility functions
```

## 🔄 Migration from Markdown-based Agents

This library replaces the traditional approach where agents were entirely defined in markdown files:

**Before (Markdown-based):**

```markdown
# Agent Name

My Agent

## List of tools

- tool1
- tool2

## System Prompt

You are a helpful assistant...
```

**After (Class-based):**

```typescript
export class MyAgent extends BaseAgent {
  constructor() {
    super({
      id: 'my-agent',
      name: 'My Agent',
      tools: [
        { name: 'tool1', description: 'First tool' },
        { name: 'tool2', description: 'Second tool' },
      ],
    });
  }
}
```

System prompts are still stored in markdown files (`src/prompts/{agent-id}.md`) but agent behavior, configuration, and business logic are now in TypeScript classes.

## 🛠️ Installation

```bash
# Clone or copy the agents directory to your project
cd agents
npm install
```

## 🚀 Quick Start

### 1. Start the Development Server

```bash
npm run dev
```

### 2. Test the API

The server will start on port 4000 by default. If that port is in use, set `PORT=4001` or another available port.

List available agents:

```bash
curl http://localhost:4000/agents
```

Chat with an agent:

```bash
curl -X POST http://localhost:4000/agent/example-agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello, how are you?"}'
```

Stream chat with an agent:

```bash
curl -X POST http://localhost:4000/agent/example-agent/chat-streaming \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello, how are you?"}' \\
  --no-buffer
```

### 3. Run the Test Suite

A comprehensive test script is included:

```bash
# Start the server first
npm run dev

# In another terminal, run the tests
./test-api.sh
```

## 📡 API Endpoints

### Agent Management

- `GET /agents` - List all available agents
- `GET /agents/:agentId` - Get specific agent information

### Chat

- `POST /agent/:agentId/chat` - Send message to agent (non-streaming)
- `POST /agent/:agentId/chat-streaming` - Send message to agent (streaming)

### Health & Monitoring

- `GET /health` - Basic health check
- `GET /health/agents` - Detailed agent health status

## 🤖 Creating a New Agent

### 1. Define the Agent Class

Create `src/agents/my-agent.ts`:

```typescript
import { BaseAgent } from '../base/index.js';
import type { AgentConfig, AgentExecutionContext } from '../base/index.js';

export class MyAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      id: 'my-agent',
      name: 'My Custom Agent',
      description: 'A custom agent that does amazing things',
      model: 'gpt-4',
      tools: [
        { name: 'my_tool', description: 'A custom tool', required: true },
      ],
      contextBuilder: {
        tools: ['my_tool'],
        skipContextBuilding: false,
      },
      version: '1.0.0',
      tags: ['custom', 'example'],
    };

    super(config);
  }

  // Optional: Custom validation
  protected async customValidation(): Promise<void> {
    // Add custom validation logic
  }

  // Optional: Custom initialization
  protected async customInitialization(): Promise<void> {
    console.log('Initializing My Agent...');
  }

  // Optional: Customize system prompt based on context
  protected customizeSystemPrompt(
    basePrompt: string,
    context?: AgentExecutionContext
  ): string {
    // Add dynamic content to prompt
    return basePrompt + `\\n\\nCurrent time: ${new Date().toISOString()}`;
  }

  // Optional: Hooks for tool execution
  async beforeToolExecution(toolName: string, args: unknown): Promise<unknown> {
    console.log(\`Executing tool: \${toolName}\`);
    return args;
  }

  async afterToolExecution(toolName: string, args: unknown, result: unknown): Promise<unknown> {
    console.log(\`Tool \${toolName} completed\`);
    return result;
  }
}
```

### 2. Create the System Prompt

Create `src/prompts/my-agent.md`:

```markdown
# My Custom Agent

You are a helpful custom agent that does amazing things.

## Instructions

1. Always be helpful and friendly
2. Use your tools effectively
3. Provide clear explanations

## Capabilities

You have access to custom tools that allow you to:

- Perform amazing tasks
- Help users efficiently
- Provide excellent service
```

### 3. Register the Agent

Update `src/server/app.ts`:

```typescript
import { MyAgent } from '../agents/my-agent.js';

// In the initialize function:
registry.register(MyAgent);
```

### 4. Export from Agents Module

Update `src/agents/index.ts`:

```typescript
export * from './my-agent.js';
```

## 🏗️ Development

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run linting
- `npm run format` - Format code

### Environment Variables

Create `.env` file:

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Database and App Storage
APPS_BASE_DIR=/tmp/apps
APP_TEMPLATE_DIR=app-templates/v8

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4

# Image Search Configuration
IMAGE_SEARCH_DRIVER=getty  # Options: getty (default), openai, unsplash

# Getty Images Configuration (for getty driver)
SSO_JWT=your_sso_jwt_token
GETTY_API_URL=https://getty-images-proxy.api.test-godaddy.com/v1/search
GETTY_APP_KEY=airo-app-builder

# Unsplash Configuration (for unsplash driver)
UNSPLASH_ACCESS_KEY=your_unsplash_access_key

# MCP Server Configuration (for tool integration)
MCP_BASE_URL=http://localhost:4000
MCP_ENDPOINT=/mcp
MCP_TIMEOUT=30000

# CORS (production only)
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

## 🖼️ Image Search Tool

The agents include a powerful, driver-based image search tool that supports multiple providers:

### Supported Providers

1. **Getty Images** (default) - Professional stock photos via Getty Images API
2. **OpenAI** - Web search capabilities through OpenAI's API
3. **Unsplash** - Free stock photos from Unsplash

### Configuration

Set the `IMAGE_SEARCH_DRIVER` environment variable to choose your preferred provider:

```bash
# Use Getty Images (default)
IMAGE_SEARCH_DRIVER=getty

# Use OpenAI web search
IMAGE_SEARCH_DRIVER=openai

# Use Unsplash
IMAGE_SEARCH_DRIVER=unsplash
```

### Provider-Specific Setup

**Getty Images:**

```bash
SSO_JWT=your_sso_jwt_token
GETTY_API_URL=https://getty-images-proxy.api.test-godaddy.com/v1/search
GETTY_APP_KEY=airo-app-builder
```

**OpenAI:**

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

**Unsplash:**

```bash
UNSPLASH_ACCESS_KEY=your_unsplash_access_key
```

### Usage

```typescript
import { ImageSearchTool, findImage } from './tools/image-search-tool.js';

// Using the class directly
const tool = new ImageSearchTool();
const result = await tool.searchImage('professional office meeting');

// Using the function interface
const result = await findImage({ prompt: 'sunset over mountains' });

// Using a specific driver
const gettyTool = new ImageSearchTool(new GettyImageSearchDriver());
```

## 🔌 Integration with Agent SDK

This library is designed to integrate with existing agent SDKs. The current implementation includes simulation endpoints, but in production you would:

1. **Replace the simulation in chat routes** with actual agent SDK calls
2. **Integrate with MCP servers** for real tool execution
3. **Add authentication/authorization** as needed
4. **Implement proper streaming** from the agent SDK

Example integration pattern:

```typescript
// In chat route
const agent = await registry.getAgent(agentId);
const agentInstance = await createAgentFromSdk(agent.getConfig());
const stream = await agentInstance.streamChat(message, context);
// Pipe stream to response...
```

## 📊 Monitoring & Observability

The library includes built-in monitoring capabilities:

- **Health checks** for individual agents
- **Registry statistics** for overall system health
- **Request logging** for debugging
- **Error handling** with structured error responses

## 🤝 Contributing

1. Follow the existing code structure and patterns
2. Add tests for new agents and functionality
3. Update documentation when adding new features
4. Use TypeScript strict mode and maintain type safety

## 📄 License

MIT
