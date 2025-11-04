# WebSocket Server

This directory contains WebSocket server implementations for real-time AI agent interactions.

## 🆕 WebSocketServer (Recommended)

The new `WebSocketServer` is designed to work with the `AgentFactory` and provides a simplified, more powerful interface.

### Key Features

- **Factory-Based**: Always uses an `AgentFactory` for consistency
- **Multi-Agent Support**: Easy switching between different agents
- **Conversation History**: Built-in support for conversation context
- **Custom Context**: Inject app-specific context into conversations
- **Streaming**: Real-time streaming of agent responses
- **Tool Support**: Full support for agent tools and agentic workflows
- **Helper Functions**: Simplified setup for single-agent scenarios

### Quick Start

#### Single Agent Setup

```typescript
import { createServer } from "http";
import { getModel } from "@airo/ai-lib";
import { createSingleAgentWebSocketServer } from "@airo/ai-lib";

const httpServer = createServer();

const wsServer = createSingleAgentWebSocketServer(
  httpServer,
  "assistant", // Agent name
  {
    name: "AI Assistant",
    system: "You are a helpful AI assistant.",
    model: await getModel("gpt4o-mini"),
    temperature: 0.7,
  },
);

httpServer.listen(3000);
```

#### Multi-Agent Setup

```typescript
import { createServer } from "http";
import { getModel } from "@airo/ai-lib";
import { createAgentFactory, createWebSocketServer } from "@airo/ai-lib";

const agentFactory = createAgentFactory();

agentFactory.defineAgents({
  general: {
    name: "General Assistant",
    model: await getModel("gpt4o-mini"),
    system: "You are a helpful assistant.",
  },
  creative: {
    name: "Creative Writer",
    model: await getModel("gpt4o"),
    system: "You are a creative writing assistant.",
    temperature: 0.9,
  },
});

const httpServer = createServer();
const wsServer = createWebSocketServer(httpServer, {
  agentFactory,
  defaultAgent: "general",
});

httpServer.listen(3000);
```

### Client Usage

#### Basic Chat

```javascript
const socket = io("http://localhost:3000");

// Send a message
socket.emit("chat", {
  message: "Hello, how are you?",
});

// Listen for normalized events
socket.on("message", (data) => {
  switch (data.type) {
    case "agents_available":
      console.log("Available agents:", data.data.agents);
      break;
    case "step_start":
      console.log("Step started:", data.data.step);
      break;
    case "chunk":
      process.stdout.write(data.content); // Stream text content
      break;
    case "step_complete":
      console.log("Step completed:", data.data.step);
      break;
    case "complete":
      console.log("Done! Agent:", data.data.agentId);
      console.log("Usage:", data.data.usage);
      break;
    case "error":
      console.error("Error:", data.content);
      break;
  }
});
```

#### Multi-Agent Chat

```javascript
// Use specific agent (supports both agentId and agentName)
socket.emit("chat", {
  message: "Write a poem about coding",
  agentId: "creative", // or agentName: 'creative'
});

// Get available agents
socket.emit("get_agents");
```

#### With Context and History

```javascript
socket.emit("chat", {
  message: "Continue our conversation",
  agentId: "general",
  context: {
    userPreferences: { style: "formal" },
    currentProject: "ai-chatbot",
  },
  conversationHistory: [
    { role: "user", content: "I need help with my project" },
    {
      role: "assistant",
      content: "I'd be happy to help! What kind of project?",
    },
  ],
});
```

### Configuration Options

```typescript
interface WebSocketConfig {
  agentFactory: AgentFactory;
  defaultAgent?: string;
  contextExtractor?: (
    context: Record<string, unknown>,
  ) => Record<string, unknown>;
  cors?: { origin?: string | string[] | boolean; methods?: string[] };
  includeUsageData?: boolean;
  onConnection?: (socketId: string) => void;
  onDisconnection?: (socketId: string) => void;
  onMessageStart?: (
    socketId: string,
    message: string,
    agentName?: string,
    context?: Record<string, unknown>,
  ) => void | Promise<void>;
  onMessageComplete?: (
    socketId: string,
    result: {
      agentName: string;
      duration: string;
      usage?: any;
      toolCalls?: any[];
    },
  ) => void;
  onTokenUsage?: (
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cachedInputTokens?: number;
      cacheWriteInputTokens?: number;
    },
    metadata: {
      agentName: string;
      modelName: string;
      conversationId?: string;
      appId?: string;
      context?: Record<string, unknown>;
    },
  ) => void | Promise<void>;
  onError?: (socketId: string, error: Error, message?: string) => void;
  socketOptions?: Partial<ServerOptions>;
}
```

> **⚡ Performance Note:** `onMessageStart` and `onTokenUsage` are fire-and-forget (non-blocking). Errors are logged but don't fail message processing.

````

### Message Types

#### Client → Server

```typescript
interface ChatMessage {
  message: string;
  agentName?: string; // Backward compatibility
  agentId?: string; // Preferred
  context?: Record<string, unknown>;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}
````

#### Server → Client (Normalized Event Schema)

```typescript
interface WebSocketMessage {
  type:
    | "step_start"
    | "chunk"
    | "tool_start"
    | "tool_result"
    | "step_complete"
    | "complete"
    | "error"
    | "agents_available";
  content: string;
  data: Record<string, unknown>;
}

// Event Types:
// - agents_available: List of available agents on connection
// - step_start: Beginning of a reasoning step
// - chunk: Streamable text content (AI responses, tool outputs)
// - tool_start: Tool execution beginning
// - tool_result: Tool execution completion
// - step_complete: Reasoning step completion
// - complete: Final completion with metadata
// - error: Error occurred
```

## 📜 Legacy WebSocketServer

The original `WebSocketServer` is still available but deprecated. It supports the older `Agent` class and more complex configuration patterns.

## 🎮 Examples

Run the WebSocket examples:

```bash
# Single agent example
npm run example:websocket-single

# Multi-agent example
npm run example:websocket-multi
```

These examples demonstrate:

- Single vs multi-agent setups
- Tool usage with agents
- Conversation history
- Custom context handling
- Error handling and event logging

## 🔧 Development

The WebSocket servers use Socket.IO for WebSocket communication and integrate seamlessly with the AgentFactory for agent management.

### Error Handling

The server provides comprehensive error handling:

- Invalid message formats
- Missing agents
- Agent execution errors
- Connection issues

All errors are emitted to clients with descriptive messages and logged server-side.

### Performance

- Streaming responses for real-time UX
- Abort controllers for canceling streams
- Connection cleanup on disconnect
- Memory-efficient message handling

## 🚀 Migration from Legacy WebSocketServer

1. Replace `WebSocketServer` with `WebSocketServer`
2. Use `AgentFactory` instead of individual `Agent` instances
3. Update client message format to new `ChatMessage` interface
4. Update event handlers to new signature format

The new server provides better performance, simpler configuration, and more powerful features for modern AI applications.
