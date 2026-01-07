# Agent Observability Integration

This module integrates the `@godaddy/agent-observability-events` SDK to track agent lifecycle events and send them to the Event Bus for monitoring and analytics.

## Overview

The observability service provides comprehensive tracking of:

- **Conversations**: Full conversation lifecycle from start to end
- **Invocations**: Individual user requests and agent responses
- **LLM Calls**: Model invocations with input/output and token usage
- **Tool Executions**: Tool calls with arguments and results
- **Handoffs**: Agent-to-agent transfers
- **Errors**: Error tracking with context

## Configuration

### Environment Variables

| Variable                             | Required | Default                      | Description                               |
| ------------------------------------ | -------- | ---------------------------- | ----------------------------------------- |
| `AGENT_OBSERVABILITY_AGENT_ID`       | No       | `airo-agents-{env}`          | Unique agent identifier                   |
| `AGENT_OBSERVABILITY_AGENT_NAME`     | No       | `airo-agents-{env}-instance` | Human-readable agent name                 |
| `AGENT_OBSERVABILITY_API_KEY`        | No       | -                            | API key for Event Bus (optional with JWT) |
| `AGENT_OBSERVABILITY_SANITIZE_PCI`   | No       | `false`                      | Auto-sanitize PCI data                    |
| `AGENT_OBSERVABILITY_SENSITIVE_MODE` | No       | `false`                      | Omit all input/output text                |
| `AGENT_OBSERVABILITY_USER_TYPE`      | No       | `c1`                         | Default user type for events              |
| `GD_ENV`                             | No       | `dev`                        | Environment (`dev`, `test`, `prod`)       |
| `PRIVATE_LABEL_ID`                   | No       | `1`                          | Default private label ID                  |

### Example `.env` Configuration

```bash
# Agent identification
AGENT_OBSERVABILITY_AGENT_ID=my-custom-agent
AGENT_OBSERVABILITY_AGENT_NAME=My Custom Agent

# Optional: API key (not required when using JWT authentication)
# AGENT_OBSERVABILITY_API_KEY=your-api-key-here

# Environment
GD_ENV=test

# Optional: Privacy settings (both default to false)
# AGENT_OBSERVABILITY_SANITIZE_PCI=true
# AGENT_OBSERVABILITY_SENSITIVE_MODE=true

# Optional: Default site context
PRIVATE_LABEL_ID=1
```

## Event Bus Configuration

The SDK is configured to use **public CSP URLs** (`dxEnabled: false`) for broader network compatibility:

```typescript
eventBusOptions: {
  dxEnabled: false;
}
```

This configuration:

- Uses public Event Bus endpoints accessible from any network
- Supports both API key and JWT authentication
- Works in containerized environments without internal DNS

## Events Tracked

### Conversation Events

- **conversation_start**: When a new conversation begins
- **conversation_end**: When a conversation is completed or abandoned

### Invocation Events

- **invocation_start**: When a user message is received
- **invocation_end**: When the agent response is complete

### LLM Events

- **llm_start**: When an LLM call begins (includes sanitized input)
- **llm_end**: When an LLM call completes (includes output, tool calls, usage)

### Tool Events

- **tool_start**: When a tool execution begins
- **tool_end**: When a tool execution completes (includes response)

### Other Events

- **handoff**: When a conversation is transferred between agents
- **error**: When an error occurs during processing

## Input/Output Sanitization

To prevent payload size issues and protect sensitive data, inputs and outputs are automatically sanitized:

### LLM Start Events

- **Max messages**: 5 messages sent to observability
- **Max content length**: 200 characters per message
- **Sanitization**: Removes backticks, asterisks, normalizes newlines, strips control characters

### LLM End Events

- **Output messages**: Captured (empty when LLM responds with only tool calls)
- **Tool calls**: Arguments included with tool call details
- **Token usage**: Full usage metrics (input, output, cached, reasoning tokens)
- **Finish reason**: Mapped to Event Bus format (`tool_calls`, `stop`, etc.)

### Tool Events

- **Tool responses**: Included in tool_end events
- **Large payloads**: Automatically handled by SDK batching

## Usage

### Automatic Tracking

The WebSocket server automatically tracks all events. No additional code is required for basic observability.

### Manual Tracking

For custom integrations, use the `AgentObservabilityService` directly:

```typescript
import { getObservabilityService } from '../observability/index.js';

const observability = getObservabilityService();

// Check if service is enabled
if (!observability.isEnabled()) {
  console.log('Observability is disabled');
  return;
}

// Start a conversation (synchronous - IDs generated locally, event sent in background)
// Pass conversationId from your context (e.g., database conversation ID)
// If not available, pass undefined to generate a random UUID
const conversationId = 'conversation-uuid-from-context';
const session = observability.startConversation(conversationId, {
  privateLabelId: 1,
  userType: 'c1',
  visitorId: 'visitor-uuid',
  sessionId: 'session-uuid',
});

// Track an invocation
const invocation = observability.startInvocation(session.conversationId, 'User message here');

// Track an LLM call
const llm = await observability.startLlmCall(
  session.conversationId,
  invocation.traceId,
  invocation.spanId,
  {
    model: 'sonnet',
    provider: 'anthropic',
    input: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
    ],
  }
);

await observability.endLlmCall(
  session.conversationId,
  invocation.traceId,
  llm.spanId,
  invocation.spanId,
  {
    model: 'sonnet',
    provider: 'anthropic',
    startTime: llm.startTime,
    output: [{ role: 'assistant', content: 'Hello! How can I help?' }],
    toolCalls: [], // Include any tool calls made
    usage: {
      totalTokens: 50,
      inputTokens: 20,
      outputTokens: 30,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
    finishReason: 'stop',
    executionOutcome: 'SUCCESS',
  }
);

// Track a tool execution
const tool = await observability.startToolExecution(
  session.conversationId,
  invocation.traceId,
  invocation.spanId,
  {
    toolName: 'search_domain',
    toolCallId: 'call-123',
    toolInput: { query: 'example.com' },
  }
);

await observability.endToolExecution(
  session.conversationId,
  invocation.traceId,
  tool.spanId,
  invocation.spanId,
  {
    toolName: 'search_domain',
    toolCallId: 'call-123',
    startTime: tool.startTime,
    executionOutcome: 'SUCCESS',
    toolResponse: { available: true },
  }
);

// Complete the invocation
await observability.endInvocation(session.conversationId, invocation.traceId, invocation.spanId, {
  responseType: 'llm_reply',
  startTime: invocation.startTime,
  outputText: 'Agent response here',
  totalTokens: 150,
  executionOutcome: 'SUCCESS',
});

// End the conversation
await observability.endConversation(session.conversationId, 'completion');
```

### Tracking Handoffs

```typescript
await observability.trackHandoff(session.conversationId, invocation.traceId, invocation.spanId, {
  fromAgentName: 'Initial Agent',
  fromAgentId: 'initial-agent',
  toAgentName: 'Specialist Agent',
  toAgentId: 'specialist-agent',
  reason: 'User requested specialized help',
  routingMethod: 'llm',
});
```

### Tracking Errors

```typescript
await observability.trackError(session.conversationId, invocation.traceId, invocation.spanId, {
  errorType: 'RateLimitError',
  errorMessage: 'Rate limit exceeded',
  errorPhase: 'execution',
  isRetryable: true,
  errorStack: error.stack,
});
```

## Event Hierarchy

Events follow a parent-child relationship for proper tracing:

```
Conversation (traceId)
└── Invocation (spanId, parentSpanId = conversation)
    ├── LLM Call (spanId, parentSpanId = invocation)
    │   └── Tool Execution (spanId, parentSpanId = llm)
    │   └── Tool Execution (spanId, parentSpanId = llm)
    └── Handoff (spanId, parentSpanId = invocation)
```

## Logging

The service emits structured logs for debugging:

| Log Key                              | Level | Description                         |
| ------------------------------------ | ----- | ----------------------------------- |
| `observability.constructor.begin`    | info  | Service initialization started      |
| `observability.initialized`          | info  | Service successfully initialized    |
| `observability.init_failed`          | error | Service initialization failed       |
| `observability.conversation.sending` | info  | Conversation start event being sent |
| `observability.conversation.started` | info  | Conversation start confirmed        |
| `observability.llm.sending`          | info  | LLM event being sent                |
| `observability.llm.started`          | info  | LLM start confirmed                 |
| `observability.llm.ended`            | info  | LLM end confirmed                   |

## Troubleshooting

### Service Not Enabled

Check for these logs at startup:

- `observability.constructor.begin` - Service is being created
- `observability.initialized` with `enabled: true` - Service is ready
- `observability.init_failed` - Service failed to initialize (check error message)

If no observability logs appear, verify:

1. The service is being instantiated (check `getObservabilityService()` calls)
2. Environment variables are correctly set
3. No errors in SDK initialization

### Events Not Reaching Event Bus

1. **Check logs** for `observability.*.sending` and `observability.*.failed` patterns
2. **Verify network access** to public CSP URLs from your environment
3. **Check authentication**: JWT is used by default; API key is optional
4. **Review payload size**: Large payloads may fail; check for `fetch failed` errors

### Empty LLM Output Content

This is **expected behavior** when the LLM responds with only tool calls:

- `output.content` will be empty
- `toolCalls` array contains the actual LLM output
- Full content appears when LLM provides text alongside tool calls

### Missing Data in Events

1. Check PCI sanitization settings (`AGENT_OBSERVABILITY_SANITIZE_PCI`)
2. Verify sensitive data mode is disabled (`AGENT_OBSERVABILITY_SENSITIVE_MODE`)
3. Content is truncated to 5000 chars for `llm_start` inputs

### Performance Concerns

- Events are sent asynchronously (fire-and-forget)
- Failed events are logged but don't interrupt agent operation
- SDK handles batching automatically

## Event Schema Reference

For full event schemas, see:

- [API Reference](https://github.com/gdcorp-dna/agent-observability-sdks/blob/main/nodejs/agent-observability-events/docs/API_REFERENCE.md)
- [Configuration Guide](https://github.com/gdcorp-dna/agent-observability-sdks/blob/main/nodejs/agent-observability-events/docs/CONFIGURATION.md)

## PCI Data Sanitization

The SDK can automatically sanitize PCI data (credit card numbers, CVV codes, expiration dates) from:

- `inputText` / `outputText` fields
- `toolInput` / `toolResponse` fields
- LLM message content

To enable auto-sanitization:

```bash
AGENT_OBSERVABILITY_SANITIZE_PCI=true
```

## Sensitive Data Mode

For agents handling highly sensitive data, enable sensitive data mode to completely omit all text content:

```bash
AGENT_OBSERVABILITY_SENSITIVE_MODE=true
```

This will:

- Omit `inputText` from invocation start events
- Omit `outputText` from invocation end events
- Omit `toolInput` from tool start events
- Omit `toolResponse` from tool end events
- Omit message content from LLM events

Metrics like token counts, durations, and costs are still tracked.
