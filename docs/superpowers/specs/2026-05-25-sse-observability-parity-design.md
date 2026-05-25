# SSE Observability Parity

Date: 2026-05-25
PR: 5 of 8 in WebSocket-to-SSE replacement sequence

## Problem

SSE message execution lacks three observability capabilities that WebSocket provides:

1. **Client trace ID extraction**: Server emits `traceId`/`observationId` in complete events, but the SSE client ignores them. Feedback submissions cannot correlate to Langfuse traces.
2. **Elastic APM transactions**: WebSocket creates labeled `WebSocket Message` APM transactions. SSE has no equivalent — production dashboards/alerts that rely on APM transactions have no SSE coverage.
3. **Per-message request correlation**: The request logger generates `req.requestId` (nanoid 8) but it is not threaded through execution or emitted to the client. Correlating a specific message execution across server logs requires conversationId + timestamp guessing.

## Design

### 1. Per-message request ID threading

Thread the existing `req.requestId` from the route handler through execution to terminal events.

**Server changes:**

- Add `requestId: string` to `MessageExecutionService.execute()` options type
- Route handler passes `req.requestId` when calling `execute()`
- All structured logs in `MessageExecutionService` include `requestId`
- Terminal event payloads (`complete`, `error`, `user_stopped`) include `requestId`

**Client changes:**

- Terminal event data now includes `requestId` — extracted alongside trace IDs (Section 3)

No new ID generation. No new middleware.

### 2. Elastic APM transaction parity

Start an APM transaction at the route handler level, covering precheck + execution.

**Transaction lifecycle:**

1. `apm.startTransaction('SSE Message', 'request')` at the top of the `/messages` route handler
2. Labels applied progressively:
   - At start: `requestId`, `conversationId`, `customerId` (JWT), `messageLength`, `isInitialPrompt`
   - After agent resolution: `agentName`
   - At terminal: `finishReason`, `error` (if any)
3. Transaction ends at terminal (success, error, stop, or budget rejection)

**Label mapping from WebSocket:**

| WebSocket label | SSE equivalent |
|-----------------|----------------|
| `socketId` | `requestId` |
| `timeSinceCreationMs` | omitted (socket-lifetime concept) |
| `agentName` | same |
| `messageLength` | same |
| `isInitialPrompt` | same |
| `customerId` | same (from JWT) |
| `sessionId` | same (from metadata) |
| `userId` | same (from metadata) |
| `conversationId` | same |

**Budget 402 path:** Label `finishReason: 'budget_exceeded'`, end transaction immediately. This appears in APM as a completed transaction with a budget label rather than being invisible.

**Implementation:** Pass the APM transaction reference into `execute()` so it can be labeled with terminal-time data (agentName, finishReason) and ended at the correct point.

### 3. Client trace ID extraction

Extract trace IDs from SSE terminal events and store them for feedback correlation.

**Changes in `useSSEChat.ts` complete handler (~line 448):**

1. Extract `traceId`, `observationId`, `requestId` from complete event data
2. Call `useDevelopPageStore.getState().setLastCompleteTraceIds({ traceId, observationId })`
3. Same extraction for `error` and `user_stopped` terminal events

**Type extension:** Extend the `TraceIds` interface with an optional `requestId?: string` field. This keeps a single store field and a single setter call while adding the new correlation data.

This mirrors the WebSocket `CompleteHandler` behavior and enables the feedback banner -> Langfuse trace correlation path for SSE users.

## Files to modify

| File | Change |
|------|--------|
| `agents/src/server/sse/routes.ts` | Start APM transaction, pass `requestId` + transaction to `execute()` |
| `agents/src/server/sse/MessageExecutionService.ts` | Accept `requestId` + transaction, label progressively, include `requestId` in logs and terminal events, end transaction at terminal |
| `app/src/hooks/useSSEChat.ts` | Extract `traceId`, `observationId`, `requestId` from complete/error/user_stopped events, store in develop page store |
| `app/src/stores/useDevelopPageStore.ts` | Extend `TraceIds` type or add `requestId` field |

## Testing

- **Unit (server):** `requestId` appears in all lifecycle log calls; terminal events include `requestId` and trace IDs; APM transaction starts on message receipt and ends at each terminal path (success, error, stop, budget 402); transaction labels match expected values at each stage
- **Unit (client):** SSE complete/error/user_stopped events populate `lastCompleteTraceIds` in develop page store; `requestId` stored for feedback correlation
- **Integration:** Execute an SSE message → verify trace IDs + requestId in complete event → verify develop page store updated → verify APM transaction appears with expected labels

## Non-goals

- Changing the request ID generation (nanoid 8 is sufficient)
- Adding APM transactions to non-message SSE routes (stream open, stop, actions, grants)
- Client-side APM instrumentation
- Modifying WebSocket observability
