---
title: Use effective socket ID for direct socket.emit after migration
date: 2026-04-06
category: best-practices
module: ai-transport
problem_type: best_practice
component: websocket
severity: medium
applies_when:
  - Emitting events via direct socket.emit() outside the standard event channel
  - Socket migration/recovery may have occurred during the connection lifecycle
tags:
  - websocket
  - socket-migration
  - budget-update
  - direct-emit
  - effective-socket-id
---

# Use effective socket ID for direct socket.emit after migration

## Context

The WebSocket server supports socket migration/recovery: when a client reconnects, the server migrates state from the old socket ID (A) to the new socket ID (B). The event channel system (`publishToEventChannel`) already handles this transparently via `WebSocketSubscriber`, which re-subscribes under the effective socket ID during recovery.

However, when emitting events via direct `socket.emit()` (bypassing the event channel), the code must manually resolve the effective socket ID. Budget `budget_update` events use direct emit because they're ephemeral (not persisted as streaming events), but the initial implementation used the original `socketId` captured at handler entry, which may be stale after migration.

## Guidance

When emitting events directly via `socket.emit()` (not through `publishToEventChannel`), always resolve the effective socket ID first:

```typescript
// Wrong: uses original socketId, misses migrated client
const socket = this.io.sockets.sockets.get(socketId)
if (socket?.connected) {
  socket.emit('budget_update', payload)
}

// Right: resolves effective socket ID after potential migration
const effectiveSid = this.stateManager.getEffectiveSocketId(socketId)
const socket = this.io.sockets.sockets.get(effectiveSid)
if (socket?.connected) {
  socket.emit('budget_update', payload)
}
```

## Why This Matters

If a socket migrates (disconnect + reconnect) during a long-running agent execution, the original `socketId` points to a dead socket. `this.io.sockets.sockets.get(socketId)` returns `undefined` or a disconnected socket. The client never receives the event. For `budget_update`, this means the user sees stale credit balance until they trigger a manual refresh or send another prompt.

## When to Apply

- Any direct `socket.emit()` call outside the standard `publishToEventChannel` pipeline
- Especially in finally blocks and post-completion callbacks where significant time may have passed since handler entry
- Does NOT apply to events published via `publishToEventChannel` (event channel handles migration internally)

## Examples

The `budget_update` emit in `experimental-websocket-server.ts` runs after `completeConversation()` and in the finally block. Both paths now use `this.stateManager.getEffectiveSocketId(socketId)` before looking up the socket.

## Related

- `packages/ai-transport/src/experimental-websocket-server.ts` (budget_update emission sites)
- `packages/ai-transport/src/subscribers/websocket-subscriber.ts` (event channel handles migration transparently)
- PR #2572: Budget GoCode passthrough + report creation
