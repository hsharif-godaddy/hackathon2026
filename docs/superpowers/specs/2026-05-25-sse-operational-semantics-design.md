# SSE Operational Semantics Parity Design

**Date:** 2026-05-25
**PR Sequence:** Part 6 of WebSocket-to-SSE parity (follows observability PR)
**Blockers addressed:** #3 (disconnect shutdown), #8 (app-level fanout) from `docs/websocket-to-sse-parity-analysis-2026-05-25.md`

## Problem

Two operational gaps prevent safe WebSocket removal:

1. **No-subscriber abort:** When an SSE client disconnects mid-execution (tab close, network loss), the `MessageExecutionService` continues running indefinitely — consuming LLM credits and holding resources for a session no one is listening to. WebSocket aborts after a 2-minute recovery window.

2. **App-level fanout without active streams:** `emitToApp` (WebSocket) delivers events to any authenticated socket for an app. SSE's `EventStreamRegistry.sendToApp` only reaches open conversation streams. If no stream is open, events (OAuth result, video status) are silently lost.

## Decision: No-Subscriber Abort Timer

### Behavior

When the last SSE subscriber for a conversation unregisters while execution is active, start a `NO_SUBSCRIBER_ABORT_TIMEOUT_MS` timer (default: 120,000 ms / 2 minutes). If a subscriber re-registers before the timer fires, cancel it. If the timer fires, abort execution.

### Why 2 minutes

- Matches WebSocket's `STREAM_RECOVERY_WINDOW`
- EventSource auto-reconnect is ~3s (browser default), so 2 minutes is generous for transient network issues
- Long enough that page-reload reconnects succeed; short enough to bound wasted LLM spend

### Abort reason

Use `'no_subscriber_timeout'` (distinct from `'user_stopped'`). This allows:
- Different observability labels (user intent vs infrastructure timeout)
- Budget attribution that doesn't count as user-initiated stop
- Log queries that distinguish tab-close from explicit stop

### Integration points

```
EventStreamRegistry.unregister(conversationId, subscriber)
  → if hasConnections(conversationId) === false
    → notify MessageExecutionService via onLastSubscriberLeft(conversationId)

MessageExecutionService.onLastSubscriberLeft(conversationId)
  → if activeStreams.has(conversationId)
    → start timer → on fire: abort(conversationId, 'no_subscriber_timeout')

EventStreamRegistry.register(conversationId, ...)
  → notify MessageExecutionService via onSubscriberAdded(conversationId)

MessageExecutionService.onSubscriberAdded(conversationId)
  → cancel pending timer if exists
```

### Callback interface

The registry and execution service are already co-located in the SSE route dependencies. Add an `ExecutionLifecycleListener` interface:

```typescript
interface ExecutionLifecycleListener {
  onLastSubscriberLeft(conversationId: string): void
  onSubscriberAdded(conversationId: string): void
}
```

`EventStreamRegistry` accepts an optional listener at construction. `MessageExecutionService` implements it.

### Timer state

```typescript
// Inside MessageExecutionService
private noSubscriberTimers = new Map<string, NodeJS.Timeout>()
```

Timer cleanup happens on:
- Subscriber reconnects (cancel timer)
- Execution completes normally (clear timer in finally block)
- Explicit stop (clear timer)
- Timer fires (self-clears after aborting)

### Terminal event on timeout abort

When the timer fires and aborts:
1. Abort controller signals `'no_subscriber_timeout'`
2. Execute loop observes abort → publishes terminal `complete` with `finishReason: 'no_subscriber_timeout'`
3. Persistence writes partial turn (same as `user_stopped`)
4. No subscriber receives the terminal event (they're all gone), but it's published for replay on reconnect

### Reconnect after timeout

If a client reconnects after the timer has already fired:
- `Last-Event-Id` recovery replays the terminal `complete` event
- Client sees `finishReason: 'no_subscriber_timeout'` and can display appropriate UI
- No different from reconnecting after any other terminal event

### Configuration

```typescript
const NO_SUBSCRIBER_ABORT_TIMEOUT_MS = parseInt(
  process.env.SSE_NO_SUBSCRIBER_ABORT_TIMEOUT_MS ?? '120000', 10
)
```

Configurable via env var for testing and tuning. Production default: 2 minutes.

## Decision: App-Level Fanout — Accept Silent Drop

### Behavior

No new endpoints or persistence. `EventStreamRegistry.sendToApp()` remains the SSE delivery mechanism for app-level events. When no conversation streams are open for an app, events are silently dropped.

### Rationale

- OAuth and video events are infrequent and non-critical for session continuity
- The client already handles "missed" OAuth by re-triggering the flow when the token isn't present on next action that needs it
- Video status is also recoverable — the video REST endpoint returns current status regardless of push events
- Adding a persistent event queue or separate SSE channel for rare events adds complexity disproportionate to the failure mode
- In practice, the builder UI keeps a conversation stream open whenever the user is active — the "no stream" case is edge (background tab garbage-collected, or user navigated away)

### Changes

1. **Add zero-delivery log:** In `EventStreamRegistry.sendToApp()`, log when delivery count is 0 so operators can observe how often the edge case actually occurs.

2. **Document delivery guarantee:** Add JSDoc on `sendToApp` stating the best-effort contract explicitly.

3. **No removal of WebSocket dual-delivery yet:** `oauth-emit.ts` and `video-generation-tool.ts` currently dual-deliver via both transports. The WebSocket path removal is deferred to the final removal PR (Part 8). This PR only adds the SSE-side improvements.

## Files Changed

| File | Change |
|------|--------|
| `agents/src/server/sse/EventStreamRegistry.ts` | Add `ExecutionLifecycleListener` callback, invoke on register/unregister |
| `agents/src/server/sse/MessageExecutionService.ts` | Implement listener, add timer management, handle `no_subscriber_timeout` abort reason |
| `agents/src/server/sse/routes.ts` | Wire listener between registry and execution service at construction |
| `agents/src/server/sse/__tests__/no-subscriber-abort.test.ts` | Timer lifecycle tests |
| `agents/src/server/sse/__tests__/EventStreamRegistry.test.ts` | Listener callback tests |

## Tests

1. **Timer starts on last subscriber leave during active execution** — unregister sole subscriber while stream is active → timer created
2. **Timer cancels on subscriber reconnect** — add subscriber before timer fires → timer cleared
3. **Timer fires and aborts** — advance clock past timeout → abort called with `'no_subscriber_timeout'`
4. **No timer for idle conversations** — unregister subscriber when no active stream → no timer
5. **Timer cleanup on normal completion** — execution completes before timer fires → timer cleared
6. **Reconnect after timeout sees terminal event** — replay includes `complete` with `no_subscriber_timeout` finish reason
7. **sendToApp zero-delivery logging** — call sendToApp with no connections → log emitted
8. **Multiple subscribers: timer only on last** — unregister one of two subscribers → no timer; unregister second → timer starts

## Non-Goals

- Graceful drain (emit "you've been disconnected" to a reconnecting client) — reconnect already gets replay
- Configurable per-conversation timeouts — single global default is sufficient
- Removing WebSocket `emitToApp` calls — deferred to Part 8
- Persistent event queue for app-level events — accepted as unnecessary
