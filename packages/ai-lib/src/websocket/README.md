# WebSocket Server

The WebSocket Server provides a reusable, configurable WebSocket server with built-in AI agent capabilities and streaming agentic execution.

## Features

- 🚀 **Easy Setup**: One-line WebSocket server creation
- 🤖 **AI Agent Integration**: Built-in streaming agentic capabilities
- 🔧 **Configurable**: Flexible agent and server configuration
- 📡 **Real-time Streaming**: Live text and tool execution updates
- 🛠️ **Tool Support**: Full tool integration with status updates
- 🎛️ **Event Handlers**: Custom event handling for connections, messages, and errors
- 🔒 **Type Safe**: Full TypeScript support

## Quick Start

```typescript
import { createServer } from 'http'
import { createWebSocketServer, openAIModels } from '@airo/ai-lib'

const httpServer = createServer()

const wsServer = createWebSocketServer(httpServer, {
  agent: {
    name: 'My AI Assistant',
    systemPrompt: 'You are a helpful AI assistant.',
    model: openAIModels.gpt4oMini(),
    tools: {
      // Your tools here
    }
  }
})

httpServer.listen(3000)
```

## Configuration

### WebSocketServerConfig

| Option | Type | Description |
|--------|------|-------------|
| `agent` | `Agent \| AgentConfig` | AI agent instance or configuration |
| `cors?` | `CorsConfig` | CORS configuration for Socket.IO |
| `maxSteps?` | `number` | Maximum agentic steps (default: 5) |
| `socketOptions?` | `ServerOptions` | Additional Socket.IO server options |
| `onConnection?` | `(socketId: string) => void` | Connection event handler |
| `onDisconnection?` | `(socketId: string) => void` | Disconnection event handler |
| `onMessageStart?` | `(socketId: string, message: string) => void` | Message start handler |
| `onMessageComplete?` | `(socketId: string, result: CompletionMetrics) => void` | Message completion handler |
| `onError?` | `(socketId: string, error: Error, message?: string) => void` | Error handler |

### Agent Configuration

You can pass either an existing `Agent` instance or an `AgentConfig` object:

```typescript
// Option 1: Use existing Agent
const agent = new Agent({ /* config */ })
const wsServer = createWebSocketServer(httpServer, { agent })

// Option 2: Pass configuration (Agent will be created automatically)
const wsServer = createWebSocketServer(httpServer, {
  agent: {
    name: 'My Assistant',
    systemPrompt: 'You are helpful.',
    model: openAIModels.gpt4oMini(),
    tools: myTools,
    temperature: 0.7
  }
})
```

## WebSocket Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `chat_message` | `{ message: string, useAgentic?: boolean }` | Send a message to the AI |

### Server → Client

| Event | Description |
|-------|-------------|
| `status` | Connection and processing status updates |
| `agentic_step_start` | A new agentic step has started |
| `agentic_text_chunk` | Streaming text content |
| `agentic_tool_start` | A tool execution has started |
| `agentic_tool_result` | A tool execution has completed |
| `agentic_step_complete` | An agentic step has finished |
| `agentic_complete` | The entire response is complete |
| `error` | An error occurred |

## Advanced Usage

### Custom Event Handlers

```typescript
const wsServer = createWebSocketServer(httpServer, {
  agent: myAgent,
  onConnection: (socketId) => {
    console.log(\`New client: \${socketId}\`)
    // Custom connection logic
  },
  onMessageComplete: (socketId, metrics) => {
    console.log(\`Completed in \${metrics.duration}\`)
    // Analytics, logging, etc.
  },
  onError: (socketId, error, message) => {
    // Custom error handling
    logError(error, { socketId, message })
  }
})
```

### Server Management

```typescript
// Get the underlying Socket.IO server
const io = wsServer.getSocketIOServer()

// Get the AI agent
const agent = wsServer.getAgent()

// Check connection count
const count = wsServer.getConnectionCount()

// Broadcast to all clients
wsServer.broadcast('custom_event', { data: 'hello' })

// Send to specific client
wsServer.sendToClient(socketId, 'custom_event', { data: 'hello' })

// Close the server
wsServer.close()
```

### Integration with Express

```typescript
import express from 'express'
import { createServer } from 'http'

const app = express()
const httpServer = createServer(app)

// Regular Express routes
app.get('/', (req, res) => {
  res.send('Hello World')
})

// Add WebSocket server
const wsServer = createWebSocketServer(httpServer, {
  agent: myAgent
})

httpServer.listen(3000)
```

## Examples

See `/examples/websocket-server.ts` for a complete working example with:
- Express integration
- Simple HTML client
- Tool usage
- Event handling
- Graceful shutdown

## Error Handling

The WebSocket server includes comprehensive error handling:

- **Connection errors**: Handled gracefully with client notifications
- **Message processing errors**: Logged and reported to client
- **Tool execution errors**: Caught and included in tool results
- **Agent errors**: Wrapped and sent as error events

Custom error handling can be added via the `onError` callback:

```typescript
const wsServer = createWebSocketServer(httpServer, {
  agent: myAgent,
  onError: (socketId, error, message) => {
    // Log to monitoring service
    logger.error('WebSocket error', {
      socketId,
      error: error.message,
      stack: error.stack,
      originalMessage: message
    })
    
    // Send to error tracking
    errorTracker.captureException(error, {
      tags: { socketId, context: 'websocket' }
    })
  }
})
```

## Best Practices

1. **Configure CORS**: Set appropriate CORS settings for production
2. **Handle Errors**: Implement custom error handlers for monitoring
3. **Limit Steps**: Set reasonable `maxSteps` to prevent runaway execution
4. **Resource Management**: Use `wsServer.close()` for graceful shutdown
5. **Rate Limiting**: Consider implementing rate limiting for production use
6. **Authentication**: Add authentication middleware if needed

## TypeScript Support

The WebSocket server is fully typed with TypeScript:

```typescript
import type { 
  WebSocketServerConfig,
  WebSocketMessage,
  ChatMessageData,
  StreamingResult,
  CompletionData 
} from '@airo/ai-lib'
```
