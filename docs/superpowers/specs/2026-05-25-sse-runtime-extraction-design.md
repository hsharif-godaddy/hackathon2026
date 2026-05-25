# SSE Runtime Extraction Design

Date: 2026-05-25

## Goal

Extract transport-agnostic agent runtime infrastructure out of `ai-lib-websocket-server.ts` into a new `agent-runtime.ts` module so that SSE can boot and function without Socket.IO being initialized. This is the first PR in the WebSocket replacement sequence identified in `docs/websocket-to-sse-parity-analysis.md`.

## Problem

SSE runtime state (event channel, agent factory, client-action registry) is initialized inside `setupAILibWebSocketServer()`. Removing WebSocket would break SSE because `getSSEEventChannel()` and `getSSEAgentFactory()` depend on that setup function having been called. The coupling is structural, not behavioral — SSE doesn't use Socket.IO, but its initialization is hostage to the WS boot path.

## Design

### New Module: `agents/src/server/agent-runtime.ts`

Owns all transport-agnostic agent infrastructure as module-level singletons.

```typescript
// Initialization (idempotent)
export async function initAgentRuntime(): Promise<void>

// Accessors (return null before init)
export function getEventChannel(): ConversationEventChannel | null
export function getAgentFactory(): AgentFactory | null
export function getBackgroundSummarizerRef(): BackgroundSummarizer | null
export function getStateManager(): StateManager | null

// Client action registry (unified, string-keyed)
export function registerActionService(key: string, service: IClientActionService): void
export function getActionService(key: string): IClientActionService | null
export function cleanupActionService(key: string): void

// Message lifecycle deps (shared by both transports)
export function getMessageLifecycleDeps(): MessageLifecycleDeps

// Shutdown
export function destroyAgentRuntime(): Promise<void>
```

### What Moves Into `agent-runtime.ts`

1. `ConversationEventChannel` creation and 60s cleanup interval
2. `createWebSocketAgentFactory()` call and instance storage
3. Client-action registry (`Map<string, IClientActionService>` + register/get/cleanup)
4. `initializeContextRegistry()` call
5. Background summarizer initialization (`initializeBackgroundSummarization()`)
6. Todo list selection callback wiring (state manager + `todoListTool.setOnSelectCallback`)
7. State manager reference
8. Message lifecycle deps (`LifecycleSessionStore`, `GitHookService`, assessment agent ref)

### What Stays In `ai-lib-websocket-server.ts`

- Socket.IO server creation (`new Server(...)`) and connection handling
- All `onMessage*` callbacks, WS-specific lifecycle, recovery manager
- `emitToApp()` (Socket.IO-specific app-scoped fanout)
- Per-socket memory tracking (`requestMemoryTracking` map)
- WS-specific context provider and agent router closure
- WS-specific logging (e.g. `websocket.*` log events)

### Boot Sequence

**Before:**
```
app.ts
  └── setupAILibWebSocketServer(server)
        ├── creates agentFactory, eventChannel, summarizer, actions
        ├── creates Socket.IO server
        └── wires everything
  └── SSE routes call getSSEEventChannel() / getSSEAgentFactory()
        └── reads module vars from ai-lib-websocket-server.ts
```

**After:**
```
app.ts
  └── initAgentRuntime()
        └── creates agentFactory, eventChannel, summarizer, actions
  └── setupAILibWebSocketServer(server)
        ├── calls getAgentFactory() / getEventChannel() from agent-runtime
        ├── creates Socket.IO server
        └── wires WS callbacks using shared instances
  └── SSE routes call getEventChannel() / getAgentFactory()
        └── reads module vars from agent-runtime.ts
```

### Consumer Migration (No Re-exports)

All import sites are rewritten directly. Old accessor functions are deleted.

| File | Old import | New import |
|------|-----------|-----------|
| `agents/src/server/app.ts` | `getSSEEventChannel`, `getSSEAgentFactory`, `getMessageLifecycleDeps` from `./ai-lib-websocket-server` | `getEventChannel`, `getAgentFactory`, `getMessageLifecycleDeps` from `./agent-runtime` |
| `agents/src/server/sse/routes.ts` | `getSSEAgentFactory`, `getClientActionService` from `../ai-lib-websocket-server` | `getAgentFactory`, `getActionService` from `../agent-runtime` |
| `agents/src/server/routes/video.ts` | `getSSEEventChannel` from `../ai-lib-websocket-server` | `getEventChannel` from `../agent-runtime` |
| `agents/src/server/ai-lib-websocket-server.ts` | internal module vars | `getEventChannel()`, `getAgentFactory()`, `getMessageLifecycleDeps()` from `./agent-runtime` |

The `registerExternalActionService` / `unregisterExternalActionService` exports are replaced by `registerActionService` / `cleanupActionService`.

### `setupAILibWebSocketServer` Changes

The function no longer creates the shared infrastructure. It:
1. Calls `initAgentRuntime()` as a safety guard (idempotent — no-op if already called)
2. Reads shared instances via `getAgentFactory()`, `getEventChannel()`, etc.
3. Creates Socket.IO server and wires WS-specific callbacks using those instances

This means `setupAILibWebSocketServer` can be deleted later without affecting any shared state.

### Client-Action Registry Design

Unified with a single backing `Map<string, IClientActionService>`:
- WS callers use socket ID as key
- SSE callers use `sse:${conversationId}` as key (existing convention)
- One API: `registerActionService(key, service)`, `getActionService(key)`, `cleanupActionService(key)`

No transport-specific API surface.

### `initAgentRuntime()` Contract

- Idempotent: calling it twice is a no-op (returns immediately if already initialized)
- Async: agent factory creation is async (imports, classifier initialization)
- Throws on failure: if factory creation or summarizer init fails, the error propagates
- Must be called before any SSE or WS request handling

### `destroyAgentRuntime()` Contract

- Clears the cleanup interval
- Calls `destroyLlmDispatcher()` (existing shutdown path)
- Nulls all module-level references
- Cleans up the action service map
- Called during graceful shutdown

### Shutdown Integration

`app.ts` graceful shutdown currently calls into `wsServer.close()`. After extraction:
- `destroyAgentRuntime()` is called during shutdown (handles shared state cleanup)
- `wsServer.close()` continues to handle Socket.IO-specific cleanup
- Order: drain in-flight → close WS → destroy runtime

## Testing

1. **`agent-runtime.test.ts`**: Call `initAgentRuntime()`, verify accessors return non-null instances. Call `destroyAgentRuntime()`, verify accessors return null.
2. **Boot-without-WS test**: Call only `initAgentRuntime()` (no `setupAILibWebSocketServer`). Assert `getEventChannel()` and `getAgentFactory()` are non-null. This proves SSE can boot standalone.
3. **Existing SSE route tests**: Pass unchanged — mock paths updated from old import to new.
4. **Existing WS tests**: Pass unchanged — `setupAILibWebSocketServer` still works, just delegates to shared runtime.
5. **Action registry test**: Register via SSE key and WS key, verify both retrievable via `getActionService()`, cleanup removes only the targeted key.

## Non-Goals

- No `emitToApp` replacement (deferred to operational semantics PR)
- No WebSocket disable flag (deletion happens when Switchboard rollout is 100%)
- No buffer capacity change (deferred to recovery hardening PR)
- No behavioral changes — same instances, same lifecycle, same ordering

## Risk

- **Low:** This is a structural refactor with no behavior change. The same singletons are created, stored, and accessed — just from a different file.
- **Import churn:** ~4 files change imports. All are within `agents/src/server/`.
- **Merge conflicts:** Active WS-area PRs may conflict on imports. Resolve by pointing to new module.
