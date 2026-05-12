# SSE Transport Protocol

Server-Sent Events transport for real-time agent communication, replacing Socket.IO WebSocket.

## Architecture

```
Browser (app/)                             Agent Server (agents/)
--------------                             ---------------------
useSSEChat hook                            Express routes (/api/conversations)
  |                                           |
  |-- POST /api/conversations/:appId ----->  Create/resolve conversation
  |     <--- { conversationId }               |
  |                                           |
SSETransport                                  |
  |-- GET  .../:conversationId/stream ---->  EventStreamRegistry
  |     (EventSource, persistent)              |-- SSESubscriber per connection
  |     <--- initialize event                  |-- per-conversation sequences
  |     <--- chunk / tool_* / complete         |-- heartbeat (15s)
  |                                           |
  |-- POST .../:conversationId/messages -->  MessageExecutionService
  |     <--- 202 Accepted                      |-- history loading (40k tokens)
  |                                            |-- StreamPartProcessor
  |-- POST .../:conversationId/stop ------>    |-- abort controller
  |-- POST .../:conversationId/actions --->  SSEClientActionService
  |-- PUT  .../:conversationId/grants ---->  GrantSessionManager
```

## URL Structure

```
POST   /api/conversations/:appId                              -> { conversationId }
GET    /api/conversations/:appId/:conversationId/stream        -> text/event-stream
GET    /api/conversations/:appId/:conversationId/messages      -> { messages, hasMore, nextCursor }
POST   /api/conversations/:appId/:conversationId/messages      -> 202
POST   /api/conversations/:appId/:conversationId/stop          -> 202
POST   /api/conversations/:appId/:conversationId/actions       -> 200
PUT    /api/conversations/:appId/:conversationId/grants        -> 200
```

All routes authenticated via JWT middleware + app ownership validation on `:appId`. Conversation ownership validated on `:conversationId`.

## Connection Lifecycle

### 1. Create/Resolve Conversation

Before opening a stream, the client creates or resolves a conversation:

```
POST /api/conversations/:appId
Content-Type: application/json
Authorization: Bearer <jwt>

{ "templateId": "..." }   // optional, for initial agent routing
```

Response: `{ "conversationId": "...", "isNew": true }`

The client stores `conversationId` in a cookie. On subsequent page loads, the stored conversationId is used directly (skip this step).

### 2. Open Stream

Client opens an EventSource to `GET /api/conversations/:appId/:conversationId/stream` with `Authorization: Bearer <jwt>` injected via custom fetch (the `eventsource` npm package v4+ provides the `fetch` option since native EventSource does not support custom headers).

Server responds with `Content-Type: text/event-stream` and sends:

```
retry: 1000

event: initialize
data: {"serverConfig":{...},"agents":[...]}
```

The conversationId is already known (it's in the URL). No connectionId is assigned or needed.

### 3. Send Message

```
POST /api/conversations/:appId/:conversationId/messages
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "content": "...",
  "sessionId": "...",
  "agentId": "...",             // optional override
  "templateId": "...",          // for initial agent routing
  "modelOverride": "...",
  "budgetServiceEnabled": false,
  "subscriptionId": "..."
}
```

Response: `202 Accepted`. Streaming events arrive on the EventSource connection.

### 4. Stream Events

Events flow through the EventSource in this order per agent turn:

```
step_start {step: 1}
chunk* {content: "..."}
tool_start {tool: {id, name}}
tool_input_delta* {toolId, delta}
tool_call {tool: {id, name, input}}
tool_result {tool: {id, name, output}}
step_start {step: 2}              // if multi-step
  ... more tools ...
step_complete {isFinal: true}
complete {finishReason: "complete"}
```

### 5. Stop Generation

```
POST /api/conversations/:appId/:conversationId/stop
Authorization: Bearer <jwt>
```

Server aborts the in-flight stream. A `complete` event with `finishReason: "aborted"` is published.

### 6. Disconnect

Client calls `transport.disconnect()` which closes the EventSource. Server detects `req.close`, cancels heartbeat, removes the connection from the registry.

## Multi-Tab Behavior

Multiple tabs to the same app share the conversation stream. All tabs open EventSource connections to the same conversationId. When events are published (chunks, tool calls, completions), all connected tabs receive them. Either tab can send a message or stop generation.

## Event Reference

### Connection Events

| Event             | When                            | Payload                                               |
| ----------------- | ------------------------------- | ----------------------------------------------------- |
| `initialize`      | On stream open                  | `{serverConfig, agents[]}`                            |
| `recovery_status` | On reconnect with Last-Event-ID | `{hasBufferedEvents, bufferedCount, streamCompleted}` |
| `replay_complete` | After replay                    | `{lastSequence, replayedCount}`                       |

### Streaming Events

| Event              | When                      | Payload                                               |
| ------------------ | ------------------------- | ----------------------------------------------------- |
| `chunk`            | Text output               | `{content, conversationId}`                           |
| `step_start`       | Each reasoning step       | `{step, stepType, agentId, agentName}`                |
| `tool_start`       | Tool execution begins     | `{tool: {id, name}, step}`                            |
| `tool_input_delta` | Streaming tool input JSON | `{toolId, delta}`                                     |
| `tool_call`        | Tool input complete       | `{tool: {id, name, input}, step}`                     |
| `tool_result`      | Tool finished             | `{tool: {id, name, output, error?, is_error?}, step}` |
| `step_complete`    | Step finished             | `{step, isFinal, toolCalls[], agentId}`               |
| `complete`         | Stream finished           | `{agentId, finishReason, totalSteps}`                 |

### Validation Events

| Event                | When                                     | Payload                                                                |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `validation_message` | Post-stream validation progress / result | `{content, data: {metadata: {validationStatus, ...}, ...}, agentName}` |

### Budget & Grant Events

| Event                   | When                      | Payload                                     |
| ----------------------- | ------------------------- | ------------------------------------------- |
| `budget_update`         | After BMS report filed    | `{customerRemaining, refreshRequired, ...}` |
| `request_grant_refresh` | Server needs fresh grants | `{}`                                        |

### Client Action Events

| Event           | When                                  | Payload                                       |
| --------------- | ------------------------------------- | --------------------------------------------- |
| `client_action` | Server requests client-side execution | `{action, params, requestId, conversationId}` |

### Video Events

| Event   | When                          | Payload                                |
| ------- | ----------------------------- | -------------------------------------- |
| `video` | Async video generation update | `{status, jobId, url?, error?, appId}` |

### Error Events

| Event            | When                                | Payload                            |
| ---------------- | ----------------------------------- | ---------------------------------- |
| `error`          | Non-fatal stream error              | `{error, timestamp}`               |
| `stream_error`   | SSE delivery error                  | `{error, timestamp}`               |
| `recovery_error` | Invalid conversationId on reconnect | `{error, requestedConversationId}` |

JWT expiry is not signaled as a stream event. The server validates the
bearer at HTTP request time only; mid-stream expiry surfaces at the next
HTTP boundary (next POST or EventSource reconnect), where the client
refreshes the token via `agent-fetch` 401 retry.

## SSE Wire Format

Each event follows the [SSE specification](https://html.spec.whatwg.org/multipage/server-sent-events.html):

```
id: <per-conversation-sequence>
event: <type>
data: <json>

```

Heartbeats are SSE comments (no event dispatched to client):

```
: heartbeat

```

## Per-Conversation Sequence Numbers

Each event gets a monotonically increasing sequence from the `ConversationEventChannel` when published. This sequence is used as the SSE `id:` field. All connections to the same conversation see the same sequence numbers.

The `Last-Event-ID` header contains the conversation sequence, which the server uses to replay only missed events on reconnect.

## Reconnection & Replay

The SSE protocol has built-in reconnection via the `Last-Event-ID` header.

### Flow

1. Connection drops (network, server restart, stall timeout)
2. EventSource automatically reconnects to the same URL (conversationId in path)
3. Browser sends `Last-Event-ID` header with last received sequence number
4. Server calls `getEventsSince(conversationId, lastEventId)` to get missed events
5. Server sends `recovery_status`, replays missed events, sends `replay_complete`
6. Normal event flow resumes

### Stall Detection

Client runs a 30-second stall timer. If no event (including heartbeat comments) arrives within that window, the client closes and reopens the EventSource. The server heartbeat interval is 15 seconds.

### Event Buffer

The server maintains a circular buffer of 1000 events per conversation with a 5-minute TTL.

## Message Execution Pipeline

When `POST /:appId/:conversationId/messages` arrives:

1. **Validate** - content not empty, content length < 100KB
2. **Budget pre-check** - if `budgetServiceEnabled`, check BMS balance (402 on exceeded)
3. **Persist user message** - save to conversation_messages table
4. **Load history** - `ConversationHistoryLoader` with 40k token budget, compression strategies, AI SDK formatting
5. **Load context** - split by `insertionOrder`: `before_history` (system prompts) and `after_history` (app context)
6. **Assemble messages** - `[conversation history] + [after_history context]` as `messages`, `before_history` as `context`
7. **Stream** - `agent.streamGenerate(content, {context, messages, executionContext, abortSignal})`
8. **Process parts** - `StreamPartProcessor` dispatches to event channel
9. **Persist response** - accumulated content, segments, tool calls saved to DB
10. **File budget report** - if BMS session active
11. **Complete** - publish `step_complete` (final) and `complete` events
12. **Cleanup** - unsubscribe SSE listeners, remove abort controller

## Client Action Protocol

Some agent tools require client-side execution. The SSE transport implements a request-response pattern:

```
Server                              Client
  |                                   |
  |-- client_action event ----------->|
  |   {action, params, requestId}     |
  |                                   |-- execute action locally
  |<-- POST .../actions --------------|
  |   {requestId, success, result}    |
  |                                   |
  |-- (tool continues execution) ---->|
```

Each request has a 30-second timeout.

## Authentication

1. Client obtains JWT from `POST /api/auth/agent-token` (BFF route)
2. JWT contains `siteId`, `customerId`, permissions, feature flags
3. All agent service routes validate JWT via `jwtAuthMiddleware`
4. App ownership: `req.agentContext.siteId` must match `:appId`
5. Conversation ownership: `conversation.appId` must match `:appId`

### Token Refresh

When any request returns 401, the client refreshes the JWT via `updateToken()`. The EventSource closes and reopens with the new token. Last-Event-ID enables seamless replay.

## Resource Limits

| Limit                            | Value                 |
| -------------------------------- | --------------------- |
| Max connections per conversation | 10 (FIFO eviction)    |
| Heartbeat interval               | 15s                   |
| Client stall timeout             | 30s                   |
| Retry interval                   | 1s                    |
| Max content length               | 100KB                 |
| Event buffer capacity            | 1000 per conversation |
| Event buffer TTL                 | 5 min                 |
| Client action timeout            | 30s                   |
| History token budget             | 40,000                |

## Feature Flag

Planned gate: SSE transport should be gated behind the `app-builder-sse-transport` Switchboard flag when the app-side transport switch is wired. Local dev reads Switchboard values from the development environment; this flag is not currently consumed by `app/src`.

## Shared Abstractions (ai-transport)

| Module                     | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `StreamPartProcessor`      | Callback-based state machine for AI SDK stream parts |
| `ClientActionRegistry`     | Pending request Map with timeout                     |
| `BaseEventSubscriber`      | Abstract lifecycle (dispose guard, connection guard) |
| `SSESubscriber`            | Formats StreamingEvents as SSE wire format           |
| `formatSSEEvent`           | SSE formatting utility                               |
| `ConversationEventChannel` | Per-conversation circular buffer with pub/sub        |

## File Reference

| File                                                      | Role                                |
| --------------------------------------------------------- | ----------------------------------- |
| `app/src/services/transport/SSETransport.ts`              | Client transport                    |
| `app/src/services/transport/types.ts`                     | ChatTransport interface             |
| `app/src/hooks/useSSEChat.ts`                             | React hook bridging transport to UI |
| `agents/src/server/sse/routes.ts`                         | Express routes                      |
| `agents/src/server/sse/MessageExecutionService.ts`        | Agent execution pipeline            |
| `agents/src/server/sse/EventStreamRegistry.ts`            | Connection tracking                 |
| `agents/src/server/sse/SSEClientActionService.ts`         | Client action request/response      |
| `agents/src/server/connection-initializer.ts`             | Initialize event data               |
| `packages/ai-transport/src/stream-part-processor.ts`      | Shared stream part state machine    |
| `packages/ai-transport/src/client-action-registry.ts`     | Shared pending request pattern      |
| `packages/ai-transport/src/subscribers/sse-subscriber.ts` | SSE event formatting subscriber     |
