# AI-Lib Examples

This directory contains organized examples demonstrating the capabilities of the AI-Lib AgentFactory, which is built on top of AI SDK 5's `Experimental_Agent`.

## 📁 Example Structure

### Basic Examples

- **`basic-openai.ts`** - Simple OpenAI usage with multiple agent types (general, creative, technical)
- **`claude-proxy-demo.ts`** - Demonstrates automatic Claude proxy routing through OpenAI when AWS credentials are not available

### Agentic Examples (Advanced AI Reasoning)

- **`experimental-websocket-demo.ts`** - WebSocket server examples for real-time AI agent interactions

## 🚀 Quick Start

### Prerequisites

1. **For OpenAI examples**:
   - Set `OPENAI_API_KEY` in your environment
   - Optionally set `OPENAI_BASE_URL` for proxy support
2. **Install dependencies**: `npm install` in the ai-lib package directory

### Run an Example

```bash
# Basic examples
npx tsx examples/basic-openai.ts

# WebSocket server examples
npm run example:websocket-single
npm run example:websocket-multi
```

## 🧠 What is Agentic AI?

Agentic AI refers to AI systems that can:

- **Reason through multi-step problems** autonomously
- **Use tools** to gather information and perform actions
- **Make decisions** about when to stop or continue processing
- **Maintain context** across multiple interactions

Our AgentFactory provides:

- **Intelligent stop conditions** (step limits, tool completion)
- **Custom context injection** (app state, pre-computed data)
- **Conversation history management**
- **Type-safe agent definitions**
- **Built-in streaming and cost tracking**

## 🛠️ Key Features Demonstrated

### 1. AgentFactory Pattern

```typescript
const factory = createAgentFactory();
const agents = factory.defineAgents({
  myAgent: {
    name: "My Agent",
    system: "You are a helpful assistant...",
    model: await getModel("sonnet"),
    tools: { weather: weatherTool },
    maxSteps: 5,
    stopAfterTools: ["weather"],
  },
});
const agent = agents.get("myAgent");
```

### 2. Streaming with Usage Tracking

```typescript
const streamResult = await agent.streamGenerate(prompt);
for await (const chunk of streamResult.textStream) {
  process.stdout.write(chunk);
}
const finalResult = await streamResult.getFinalResult();
console.log(`Tokens used: ${finalResult.usage.totalTokens}`);
```

### 3. Custom Context Injection

```typescript
const result = await agent.streamGenerate(prompt, {
  context: [
    {
      role: "user",
      content: "Current weather: sunny, 28°C",
    },
  ],
  messages: previousMessages,
});
```

### 4. Tool Creation

```typescript
const myTool = createTool(
  "Tool description",
  z.object({
    input: z.string().describe("Input parameter"),
  }),
  async ({ input }) => {
    return { result: `Processed: ${input}` };
  },
);
```

## 📊 Example Comparison

| Example            | Complexity | Features                                       | Best For                    |
| ------------------ | ---------- | ---------------------------------------------- | --------------------------- |
| `basic-openai`     | Simple     | Multiple models, streaming, proxy support      | Getting started with OpenAI |
| `websocket-single` | Medium     | Real-time WebSocket server, single agent       | Chat applications           |
| `websocket-multi`  | Advanced   | Multi-agent WebSocket server, context handling | Complex chat systems        |

## 🔄 Claude Proxy Routing

The unified provider automatically routes Claude models through an OpenAI-compatible proxy when:

1. **AWS credentials are not available** (no `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, etc.)
2. **`OPENAI_BASE_URL` is set** (proxy endpoint configured)
3. **Model is supported** (currently `claude-sonnet-4-6`)

### Supported Claude Models for Proxy

- `sonnet` → `claude-sonnet-4-6`
- `haiku` → `claude-haiku-4-5`
- `claude-sonnet-4-6` → `claude-sonnet-4-6`

### Example Usage

```bash
# Set proxy URL
export OPENAI_BASE_URL=https://your-proxy.example.com

# Claude models will automatically route through proxy
npm run example:basic-openai  # Will use proxy for Claude models
npm run example:claude-proxy  # Demonstrates routing logic
```

## 🎯 Use Cases

### Business Applications

- **Document Analysis**: Process reports, contracts, and compliance documents
- **Customer Support**: Context-aware multi-turn conversations
- **Content Generation**: Marketing copy, technical documentation
- **Data Analysis**: Extract insights from structured and unstructured data

### Development Applications

- **Code Review**: Automated code analysis and recommendations
- **Architecture Review**: System design evaluation and suggestions
- **Documentation**: API documentation and user guide generation
- **Testing**: Test case generation and validation

## 💰 Cost Management

All examples include:

- **Token usage tracking** with real-time monitoring
- **Cost estimation** based on current model pricing
- **Prompt caching** examples for cost optimization
- **Model comparison** for cost-effective choices

## 🔧 Configuration Options

### Agent Configuration

- `maxSteps`: Maximum reasoning steps (prevents infinite loops)
- `stopAfterTools`: Stop after specific tool calls
- `temperature`: Control randomness (0.0-1.0)
- `maxOutputTokens`: Limit response length
- `tools`: Available tools for the agent

### Factory Configuration

- `defaultTemperature`: Global temperature setting
- `defaultMaxTokens`: Global token limit
- `globalTools`: Tools available to all agents

## 🔍 Debugging

Enable debug mode:

```bash
DEBUG=true npx tsx examples/your-example.ts
```

This provides detailed logging of:

- Tool executions and results
- Token usage and costs
- Agent reasoning steps
- API request/response details

## 📚 Further Reading

- [AI SDK 5 Documentation](https://sdk.vercel.ai/)
- [Migration Guide](../MIGRATION-TO-EXPERIMENTAL-AGENT.md)
- [OpenAI API Documentation](https://platform.openai.com/docs)

## 🆘 Support

If you encounter issues:

1. Check your API keys and credentials
2. Verify model access
3. Review the debug output
4. Consult the migration guide for API changes

Happy building with AI-Lib! 🤖✨
