---
title: Feature Flag WebSocket Relay Pattern
date: 2026-03-31
category: developer-experience
module: budget-service-integration
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - Feature flag needs to flow from frontend to agents via WebSocket
  - Adding a new WS event channel without refactoring existing events
  - Agent needs per-socket flag state for routing decisions
tags:
  - feature-flag
  - websocket
  - switchboard
  - budget-service
  - billing-mode
  - budget-context
  - grant-context
---

# Feature Flag WebSocket Relay Pattern

> **Superseded (2026-04-02).** The WS-based `budget_context` relay was replaced by JWT claims on the agent token. The CP contract confirmed 2026-04-13 further shifts runtime BMS gating from Switchboard flag to `bmsBudgetId` presence on subscription (see [CP contract alignment](../best-practices/cp-contract-alignment-bms-signup-runtime-gating-2026-04-13.md)). This doc is retained as a reference for the pattern, not the current implementation.

## Context

When migrating from legacy grants-based billing to a new Budget Service, the system needs to signal availability of the new service across the full stack (frontend, WebSocket transport, agent backend). Feature flags are managed centrally in the frontend (via GoDaddy Switchboard), but agents need this context to make routing decisions at request time.

This pattern emerged during Unit 2 of the Budget Service integration (PR on `feat/budget-service-client`), where the goal was to add `app-builder-budget-service` feature flag infrastructure without coupling to existing `grant_context` infrastructure.

(auto memory [claude]) Part of the Budget Service Y26.Q2 initiative, Agent/Experience team.

## Guidance

The pattern has five layers, each with a single responsibility:

### 1. Shared Type (cross-package contract)

```typescript
// @airo/shared/src/budget/types.ts
export interface BudgetContextPayload {
  readonly budgetServiceEnabled: boolean
  readonly subscriptionId: string
}
```

Immutable (`readonly`), minimal (only flag state + subscription ID).

### 2. Frontend Hook (reads flag, emits WS event)

```typescript
// app/src/hooks/websocket/useBudgetContext.ts
export function useBudgetContext({ controller, subscriptionId, isConnected }) {
  const { data: budgetServiceEnabled } = useSwitchboard('app-builder-budget-service')
  const lastSentRef = useRef<string | null>(null)

  const sendBudgetContext = useCallback(function send() {
    if (!controller || !isConnected || !subscriptionId) return
    const enabled = budgetServiceEnabled === true  // undefined -> false
    const key = `${enabled}:${subscriptionId}`
    if (key === lastSentRef.current) return

    const sent = controller.emitBudgetContext({ budgetServiceEnabled: enabled, subscriptionId })
    if (!sent) return  // don't update dedup key if transport failed
    lastSentRef.current = key
  }, [controller, isConnected, subscriptionId, budgetServiceEnabled])

  useEffect(() => sendBudgetContext(), [sendBudgetContext])
  useEffect(() => { if (!isConnected) lastSentRef.current = null }, [isConnected])
}
```

Key: treats `undefined` flag as `false` (safe default). Checks emit return value before updating dedup state. Resets on disconnect for fresh send on reconnect.

### 3. WS Transport (passthrough)

```typescript
// TransportSupervisor.ts + StreamingWebSocketController.ts
emitBudgetContext(payload) {
  if (!this.socket?.connected) return false
  this.socket.emit('budget_context', payload)
  return true
}
```

Mirrors `emitGrantContext` exactly.

### 4. Agent Handler (stores per-socket state)

```typescript
// agents/src/server/ai-lib-websocket-server.ts
const budgetContextSessions = new Map<string, { budgetServiceEnabled: boolean; subscriptionId: string }>()

socket.on('budget_context', (data: BudgetContextPayload) => {
  if (!data.subscriptionId || typeof data.budgetServiceEnabled !== 'boolean') {
    logger.warn('websocket.budget_context.invalid_payload', { socketId: socket.id })
    return
  }
  budgetContextSessions.set(socket.id, {
    budgetServiceEnabled: data.budgetServiceEnabled,
    subscriptionId: data.subscriptionId,
  })
})

// onDisconnection:
budgetContextSessions.delete(socketId)

// Export:
export function getBudgetContext(socketId) {
  return budgetContextSessions.get(socketId)
}
```

Simple Map keyed by socket ID. Not extending GrantSessionManager (different concern, simpler needs).

### 5. Billing Mode Resolver (pure function)

```typescript
// @airo/ai-lib/src/budget/billing-mode.ts
export type BillingMode = 'budget-service' | 'grants' | 'none'

export function getBillingMode(context?: { budgetServiceEnabled?: boolean }): BillingMode {
  if (context?.budgetServiceEnabled === true) return 'budget-service'
  return 'grants'
}
```

Pure, no side effects, no socket references, trivially testable.

## Why This Matters

**Separation of concerns:** Each layer has one job. Changes don't cascade.

**No coupling to legacy patterns:** Separate `budget_context` event avoids coupling to `grant_context` (being cleaned up in Unit 0).

**Safe defaults:** Unknown flag state defaults to `'grants'`. Prevents routing through uninitialized Budget Service.

**Testability:** `getBillingMode()` needs zero mocking. Frontend hook tested with simple mock controller. Agent handler tested by calling Map methods.

## When to Apply

- Feature flag must flow from frontend (Switchboard) to agents via WebSocket
- You need a new WS event channel without refactoring existing events
- State needs to be per-socket (different users/connections may have different flag state)
- Agent-side routing logic should be independently testable

**Do NOT use for:** Simple request-level flags (pass inline), global flags that never change (use env vars), high-frequency updates (consider batching).

## Examples

**Full flow (user sends a message):**

```
Frontend:  useSwitchboard('app-builder-budget-service') -> true
         useBudgetContext emits budget_context { enabled: true, sub: 'sub-123' }
Transport: socket.emit('budget_context', payload)
Agent:     budgetContextSessions.set(socketId, state)
Resolve:   getBillingMode(getBudgetContext(socketId)) -> 'budget-service'
```

**Wiring into streaming hook:**

```typescript
// useStreamingWebSocket.ts
useBudgetContext({
  controller: controllerRef.current,
  subscriptionId,
  isConnected: webSocketState.connected,
})
```

**Testing billing mode (no mocks):**

```typescript
expect(getBillingMode({ budgetServiceEnabled: true })).toBe('budget-service')
expect(getBillingMode({ budgetServiceEnabled: false })).toBe('grants')
expect(getBillingMode()).toBe('grants')
```

## Gotcha: pnpm Worktree Symlinks

Git worktrees with pnpm workspaces: per-package `node_modules/@airo/*` symlinks resolve relative to the main repo, not the worktree. After adding types to `@airo/shared`, downstream packages in the worktree can't see them. Fix: re-symlink `@airo/*` in each consumer's `node_modules` to point to the worktree's packages, then rebuild (`pnpm --filter @airo/shared build`).

## Related

- [Dual-path feature flag pattern](../best-practices/dual-path-feature-flag-react-query-websocket-2026-04-09.md) -- consumer of the switchboard flag infrastructure
- `docs/solutions/developer-experience/feature-flag-layer-selection-2026-04-01.md` -- Switchboard vs features.ts layer distinction, local override setup
- `docs/solutions/best-practices/feature-flag-guard-replacement-2026-03-30.md` -- pattern for replacing flag guards with capability checks
- `docs/solutions/best-practices/feature-flag-cleanup-orphaned-artifacts-2026-03-31.md` -- cleanup patterns from grants flag removal
- `docs/solutions/best-practices/defensive-http-client-design-2026-03-31.md` -- Budget Service HTTP client patterns
- `docs/solutions/best-practices/switchboard-jwt-config-transport-2026-04-15.md` -- the JWT claims pattern that replaced this WS relay, with pitfall documentation for structured JSON config
