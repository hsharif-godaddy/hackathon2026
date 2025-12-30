# WebSocket Event Schema

## Multi-Agent Support

The WebSocket server now supports multiple agents. Clients can:

- Receive `agents_available` event on connection with list of available agents
- Send `agentId` in `chat_message` to specify which agent to use
- Send `get_agents` event to refresh agent list
- Receive `agentId` in completion events to know which agent responded

### Agent Selection

```typescript
// Send message to specific agent
socket.emit("chat_message", {
  message: "Hello!",
  agentId: "develop", // Optional - uses default if not specified
});

// Get available agents
socket.emit("get_agents");

// Receive agent list
socket.on("agents_available", (data) => {
  console.log(data.agents); // Array of {id, name, description}
  console.log(data.defaultAgent); // Default agent ID
});
```

## Normalized Event Types

All content rendering should flow through these standardized events:

### 1. `step_start`

- **Purpose**: Indicates a new reasoning step has begun
- **Schema**:

```typescript
{
  type: 'step_start',
  content: string,        // Usually empty or step description
  data: {
    step: number,
    stepType: 'reasoning' | 'file_processing' | 'tool_execution'
  }
}
```

### 2. `chunk`

- **Purpose**: All text content that should be rendered
- **Schema**:

```typescript
{
  type: 'chunk',
  content: string,        // The actual text to render
  data: {
    step: number,
    source: 'ai_response' | 'tool_output' | 'file_analysis'
  }
}
```

### 3. `tool_start`

- **Purpose**: Indicates a tool execution has begun
- **Schema**:

```typescript
{
  type: 'tool_start',
  content: string,        // Description like "Using calculator..."
  data: {
    step: number,
    tool: {
      id: string,
      name: string,
      input: Record<string, unknown>
    }
  }
}
```

### 4. `tool_input_delta`

- **Purpose**: Streaming tool arguments as they're generated
- **Schema**:

```typescript
{
  type: 'tool_input_delta',
  content: string,        // The argument delta text
  data: {
    step: number,
    toolCallId: string,
    toolName: string,
    argsTextDelta: string
  }
}
```

### 5. `tool_call`

- **Purpose**: Tool call with complete arguments (emitted after all deltas)
- **Schema**:

```typescript
{
  type: 'tool_call',
  content: string,        // Summary like "Calling read_file..."
  data: {
    step: number,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>
  }
}
```

### 7. `tool_result`

- **Purpose**: Indicates a tool execution has completed
- **Schema**:

```typescript
{
  type: 'tool_result',
  content: string,        // Summary like "Calculator completed"
  data: {
    step: number,
    tool: {
      id: string,
      name: string,
      input: Record<string, unknown>,
      result: Record<string, unknown>
    }
  }
}
```

### 8. `step_complete`

- **Purpose**: Indicates a reasoning step has completed
- **Schema**:

```typescript
{
  type: 'step_complete',
  content: string,        // Final content for this step
  data: {
    step: number,
    isFinal: boolean,
    toolCalls?: ToolCall[],
    usage?: UsageData
  }
}
```

### 9. `complete`

- **Purpose**: Indicates the entire conversation has completed
- **Schema**:

```typescript
{
  type: 'complete',
  content: string,        // Final accumulated content
  data: {
    totalSteps: number,
    usage?: UsageData,
    toolCalls: ToolCall[],
    fileContext?: FileContext
  }
}
```

### 10. `recovery_status`

- **Purpose**: Sent after reconnection to inform client about replayed events
- **Schema**:

```typescript
{
  type: 'recovery_status',
  content: string,        // Status message like "Recovered 15 events"
  data: {
    recovered: boolean,
    replayedEvents: number,
    fromSequence: number,
    toSequence: number
  }
}
```

## Key Principles

1. **All renderable content flows through `chunk`**
   - AI responses
   - Tool outputs (when they contain displayable content)
   - File analysis results

2. **Tool events provide metadata and status**
   - `tool_start` for immediate UI feedback
   - `tool_result` for completion status
   - Tool output content goes to `chunk` if renderable

3. **Consistent data structure**
   - All events have `type`, `content`, `data`
   - `step` number for ordering
   - `source` or context information for handling

4. **No special cases**
   - File processing uses same events as regular agentic flow
   - Tool outputs normalized to text chunks when appropriate

## Implementation Strategy

1. **Normalize tool outputs**: When tools like `html_file_editor` generate content, emit that content as `chunk`

2. **Unified event emission**: Both regular agentic flow and file processing should use the same event emission logic

3. **Content extraction**: Extract renderable content from tool results and emit as text chunks

4. **Client simplification**: Clients only need to handle these 10 event types consistently

## Connection Recovery

The WebSocket server supports automatic connection recovery with a 5-minute window. During disconnection:

1. **Events continue to be buffered** in the ConversationEventChannel
2. **Sequence numbers** allow precise replay from the last delivered event
3. **On reconnection**, the server replays missed events and sends `recovery_status`

### Client Implementation

```javascript
const socket = io("http://localhost:3000", {
  auth: {
    previousSocketId: localStorage.getItem("socketId"),
  },
});

socket.on("connect", () => {
  localStorage.setItem("socketId", socket.id);
});

socket.on("message", (data) => {
  if (data.type === "recovery_status") {
    console.log(`Recovered: ${data.data.replayedEvents} events`);
  }
});
```

### Recovery Flow

1. Client disconnects (network issue, page reload, etc.)
2. Server starts 5-minute recovery window
3. Agent continues processing, events buffered in event channel
4. Client reconnects with `previousSocketId` in auth
5. Server fetches events since `lastDeliveredSequence`
6. Server replays missed events to client
7. Server sends `recovery_status` event
8. Normal streaming resumes

### Recovery Modes

| Mode                | Trigger                                     | Behavior                                                                    |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| **Auto-recovery**   | Stream completed during disconnect          | Replays buffered events, sends `recovery_status`                            |
| **Manual recovery** | Stream still running when client reconnects | Migrates state to new socket, replays missed events, resumes live streaming |

Manual recovery supports **sequential reconnects** (A→B→C) - the server tracks socket ID migrations and follows the chain to deliver events to the current socket. This ensures exactly-once delivery even with multiple rapid reconnections.
