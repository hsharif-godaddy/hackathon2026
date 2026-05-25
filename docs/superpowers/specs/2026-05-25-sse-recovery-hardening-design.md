# SSE Recovery Hardening

Date: 2026-05-25
PR: 3 of 8 in the WebSocket replacement sequence
Depends on: PR #4085 (runtime extraction — `agent-runtime.ts` exists)
Independent of: PR #4087 (client lifecycle)

## Goal

Close three recovery/resilience gaps identified as blockers in the parity analysis before SSE can replace WebSocket:

1. SSE buffer capacity matches WebSocket (10,000 events)
2. Buffer-loss with inline-history failure is surfaced to the client for graceful degradation
3. Server/client event type contract is enforced at build/test time

## Part A: Buffer Capacity

### Problem

`agent-runtime.ts` creates `new ConversationEventChannel()` with the default capacity of 1,000. A fast-producing multi-tool turn easily exceeds 1,000 events (chunks alone for a long response). A brief network interruption during such a turn forces loss recovery even though WebSocket's 10,000-event buffer would have retained the events.

### Change

In `agents/src/server/agent-runtime.ts`, pass explicit config:

```typescript
const channel = new ConversationEventChannel({ capacity: 10_000, ttl: 5 * 60 * 1000 })
```

### Tests

- `agents/src/server/__tests__/agent-runtime.test.ts`: assert channel capacity is 10,000 (publish 1,001 events to the same conversation and verify the first is still retrievable via `getEventsSince`).

## Part B: Buffer-Loss History-Failure Surfacing

### Problem

When buffer loss is detected (`lossDetected: true`) and the inline `getMessagesPaginated` fallback throws, the server:
1. Logs `sse.recovery.history_load_failed` (warn)
2. Emits `recovery_status` with `lossDetected: true`, `historyMessageCount: 0`, `historyStreaming: false`
3. Emits `replay_complete`

The client sees recovery complete with no history and no indication that data was irrecoverably lost vs simply absent. It cannot distinguish "empty conversation" from "DB failure during recovery."

### Server Change

File: `agents/src/server/sse/routes.ts`

Add a `historyLoadFailed` field to the `recovery_status` payload:

```typescript
let historyLoadFailed = false
if (plan.lossDetected) {
  try {
    // ... existing getMessagesPaginated call ...
  } catch (err) {
    historyLoadFailed = true
    logger.warn('sse.recovery.history_load_failed', { appId, conversationId, ...errorFields(err) })
  }
}

writeFormatted('recovery_status', {
  // ... existing fields ...
  historyLoadFailed,
})
```

### Client Change

File: `app/src/hooks/useSSEChat.ts`

In the `recovery_status` handler, after the existing logic:

```typescript
if (payload?.lossDetected && payload?.historyLoadFailed && payload?.historyMessageCount === 0) {
  // Server detected buffer loss but failed to load history inline.
  // Fall back to the standard HTTP history load path.
  logger.info('sse.recovery.history_fallback_triggered', { appId: currentAppId })
  if (transportRef.current) {
    transportRef.current.loadHistory()
  }
}
```

This gracefully degrades to the same HTTP pagination API used on page load. If that also fails, the existing `history_complete` error handling applies.

### Tests

- `agents/src/server/sse/__tests__/routes.test.ts`: mock `deps.messages.getMessagesPaginated` to throw. Assert `recovery_status` event includes `historyLoadFailed: true`.
- `app/src/hooks/__tests__/useSSEChat.test.ts`: emit `recovery_status` with `{ lossDetected: true, historyLoadFailed: true, historyMessageCount: 0, hasBufferedEvents: false }`. Assert `loadHistory()` is called on the transport.

## Part C: Event Allowlist Contract

### Problem

Server event types (`StreamingEventType` in `@airo/ai-transport/interfaces.ts`) and client event listeners (hard-coded array in `SSETransport.ts`) are maintained independently. Adding a new server event without updating the client allowlist means the event is silently dropped — no compile error, no test failure.

### Approach

Make the type derived from a runtime `const` array so both the type system and the client have a single source of truth.

### Changes

**1. `packages/ai-transport/src/interfaces.ts`**

Replace the manually maintained type union with a const-array-driven type:

```typescript
export const STREAMING_EVENT_TYPES = [
  'chunk',
  'tool_start',
  'tool_input_delta',
  'tool_call',
  'tool_result',
  'step_start',
  'step_complete',
  'complete',
  'error',
  'validation_message',
  'recovery_status',
  'conversation_info',
  'agents_available',
  'replay_complete',
  'catchup_status',
  'catchup_complete',
  'server_config',
  'client_action',
  'budget_update',
  'budget_status',
  'debug_turn_stats',
  'stream_retry',
  'video',
  'request_grant_refresh',
] as const

export type StreamingEventType = typeof STREAMING_EVENT_TYPES[number]
```

Export `STREAMING_EVENT_TYPES` from the package index.

**2. `app/src/services/transport/SSETransport.ts`**

Import `STREAMING_EVENT_TYPES` from `@airo/ai-transport`. Define route-emitted extras locally:

```typescript
import { STREAMING_EVENT_TYPES } from '@airo/ai-transport'

const ROUTE_EVENT_TYPES = [
  'history_message',
  'history_loaded',
  'history_complete',
  'stream_error',
  'oauth_result',
] as const

const SSE_EVENT_TYPES = [...STREAMING_EVENT_TYPES, ...ROUTE_EVENT_TYPES] as const
```

Use `SSE_EVENT_TYPES` for EventSource listener registration. Remove dead entries: `status`, `resync`.

**3. Contract test** (`app/src/services/transport/__tests__/sse-event-contract.test.ts`)

```typescript
import { STREAMING_EVENT_TYPES } from '@airo/ai-transport'

const INTENTIONALLY_IGNORED: ReadonlySet<string> = new Set([
  'budget_status',       // Inert — no UI consumption on either transport
  'conversation_info',   // WS-only; SSE pre-creates conversations
  'agents_available',    // Delivered via 'initialize' event, not as standalone
  'server_config',       // Delivered via 'initialize' event, not as standalone
  'catchup_status',      // WS-only ACK mechanic
  'catchup_complete',    // WS-only ACK mechanic
])

test('SSE client registers listeners for all server event types or explicitly ignores them', () => {
  const registeredOrIgnored = new Set([...SSE_EVENT_TYPES, ...INTENTIONALLY_IGNORED])
  const missing = STREAMING_EVENT_TYPES.filter(t => !registeredOrIgnored.has(t))
  expect(missing).toEqual([])
})
```

This test fails at `pnpm test` time if a new event type is added to the server without updating the client or the ignore list.

### Dead event cleanup

Remove from client:
- `status` — no SSE server path emits this
- `resync` — no SSE server path emits this

`catchup_status` / `catchup_complete` are in `STREAMING_EVENT_TYPES` (they exist as a type) but go into `INTENTIONALLY_IGNORED` — server doesn't emit them on SSE, and the analysis confirms they're WS-only mechanics.

## Files Modified

| File | Change |
|------|--------|
| `agents/src/server/agent-runtime.ts` | Buffer capacity: 10,000 |
| `agents/src/server/__tests__/agent-runtime.test.ts` | Capacity assertion test |
| `agents/src/server/sse/routes.ts` | Add `historyLoadFailed` to recovery_status |
| `agents/src/server/sse/__tests__/routes.test.ts` | History-failure recovery test |
| `packages/ai-transport/src/interfaces.ts` | `STREAMING_EVENT_TYPES` const array |
| `packages/ai-transport/src/index.ts` | Export `STREAMING_EVENT_TYPES` |
| `app/src/hooks/useSSEChat.ts` | History fallback on loss + failure |
| `app/src/hooks/__tests__/useSSEChat.test.ts` | Fallback trigger test |
| `app/src/services/transport/SSETransport.ts` | Import shared types, remove dead events |
| `app/package.json` | Add `@airo/ai-transport` workspace dependency |
| `app/src/services/transport/__tests__/sse-event-contract.test.ts` | Contract test (new) |

## Risks

- **Part A**: Increases per-conversation memory. At 10,000 events ~1KB each = ~10MB per active conversation. Acceptable given the single-agent-per-app deployment model.
- **Part B**: The fallback triggers a full HTTP history load. If the DB is unhealthy, this also fails — but the existing `history_complete` error path handles that case (user sees empty history with no false-positive success signal).
- **Part C**: The `@airo/ai-transport` → `app/` import coupling is new. Requires adding `"@airo/ai-transport": "workspace:*"` to `app/package.json`. Acceptable because `app/` already imports `@airo/shared` (same workspace pattern), `ai-transport` is a workspace package, and the client is semantically consuming transport event types.

## Out of Scope

- No-subscriber abort timer (PR 6)
- `emitToApp` audit (PR 6)
- Elastic APM parity (PR 5)
- Request correlation IDs (PR 5)
