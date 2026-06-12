---
title: Context threading across agent handoffs in WebSocket server
date: 2026-04-02
category: best-practices
module: agents
problem_type: best_practice
component: assistant
severity: medium
applies_when:
  - adding state that must survive agent handoffs in experimental-websocket-server.ts
  - resources requiring cleanup in try/catch/finally where catch may clear context
  - pre-execution validation or setup that should gate the entire prompt
  - external service clients with multiple error subclasses for the same failure category
tags:
  - websocket
  - agent-handoff
  - context-persistence
  - try-finally
  - local-var-capture
  - budget-service
  - processedcontext
  - conversation-context
---

# Context threading across agent handoffs in WebSocket server

## Context

When adding pre-execution budget checking and BMS session creation to the WebSocket server, the budget state (`budgetId + sessionId`) needed to persist across agent handoffs within a single prompt execution and remain available for cleanup in `finally` blocks. Two non-obvious behaviors made this harder than expected:

1. `processedContext` is fully replaced on each handoff by `processContext()` -- any state attached to it is silently lost
2. The catch block in `handleChatMessageInternal` transitions to 'cleaned' state and may delete `conversation.context` before the `finally` block runs

An automated simplicity reviewer flagged the try/finally skeleton and local variable capture as YAGNI. The recommendation was technically sound in isolation (the finally block was a no-op until Unit 6 lands) but would have broken a plan requirement: the local var capture exists because `conversation.context` may already be gone when `finally` runs.

## Guidance

Three patterns work together to reliably thread state across handoffs and cleanup paths.

### Pattern 1: Dual-write + restore after handoff

Store state on both `processedContext` (for immediate downstream use) and `conversation.context` (the durable store). After each handoff replaces `processedContext`, restore from `conversation.context`.

```typescript
// After onMessageStart sets processedContext.budgetService:
const budgetState = (processedContext as any)?.budgetService
if (budgetState) {
  const conv = this.getConversation(socketId)
  if (conv) {
    (conv.context as any).budgetService = budgetState
  }
}

// After each handoff's processContext() call:
if (iterationCount > 1) {
  processedContext = await this.processContext(data, socketId)
  const handoffConv = this.getConversation(socketId)
  const persistedBudget = (handoffConv?.context as any)?.budgetService
  if (persistedBudget) {
    (processedContext as any).budgetService = persistedBudget
  }
}
```

### Pattern 2: Local variable capture for finally-block safety

The catch block transitions conversation state to 'cleaned' and may delete `conversation.context`. Capture identifiers needed for cleanup as local variables at creation time.

```typescript
let budgetSessionBudgetId: string | undefined
let budgetSessionSessionId: string | undefined

try {
  // After session creation:
  budgetSessionBudgetId = budgetState.budgetId
  budgetSessionSessionId = budgetState.sessionId
  // Also store on conversation.context for handoff persistence
} catch {
  // May clear conversation.context
} finally {
  // Local vars survive regardless of what catch did
  if (budgetSessionSessionId) {
    // Cleanup using local vars, not conversation.context
  }
}
```

### Pattern 3: Error type coverage via duck-typing

When catching typed errors from external service clients, cover all failure modes. Use `error.name` checks to avoid importing from packages that would create circular dependencies.

```typescript
if (
  error.name === 'BudgetServiceUnavailableError' ||
  error.name === 'BudgetServiceTimeoutError'
) {
  errorType = 'BUDGET_SERVICE_UNAVAILABLE'
  statusCode = 503
}
```

## Why This Matters

- **Handoff context loss is silent.** `processContext()` returns a fresh object with no warning that previous state is gone. Without dual-write + restore, budget sessions would be orphaned after handoffs.
- **Error paths are destructive.** The catch block's state cleanup ('cleaned') is correct for conversation lifecycle but hostile to cleanup code. `conversation.context` and `processedContext` may both be gone by the time `finally` runs.
- **Automated reviewers lack plan context.** A simplicity reviewer correctly identified that a `const budgetReportCreated = false` would produce spurious warnings, but its recommendation to remove the entire skeleton would have broken a plan requirement. Always verify reviewer recommendations against plan requirements.

## When to Apply

- Any state that must survive agent handoffs within a single prompt execution in `experimental-websocket-server.ts`
- Any resource requiring cleanup (sessions, connections, locks) in a try/catch/finally where the catch may clear context objects
- Any pre-execution validation that should gate the entire prompt (use `onMessageStart`, not `agent-factory.ts`)
- Any external service client with multiple error subclasses representing the same failure category

## Examples

**Before (state lost on handoff):**

```typescript
// onMessageStart:
(processedContext as any).budgetService = { budgetId, sessionId }

// After handoff:
processedContext = await this.processContext(data, socketId)
// processedContext.budgetService is now undefined
```

**After (dual-write + restore):**

```typescript
// onMessageStart:
(processedContext as any).budgetService = { budgetId, sessionId }
const conv = this.getConversation(socketId)
if (conv) (conv.context as any).budgetService = { budgetId, sessionId }

// After handoff:
processedContext = await this.processContext(data, socketId)
const persisted = (this.getConversation(socketId)?.context as any)?.budgetService
if (persisted) (processedContext as any).budgetService = persisted
```

**Before (identifier lost in finally):**

```typescript
try {
  (conversation.context as any).budgetSessionId = sessionId
} catch { /* clears conversation.context */ }
finally {
  const sid = (conversation.context as any)?.budgetSessionId // undefined!
}
```

**After (local capture):**

```typescript
let budgetSessionId: string | undefined
try {
  budgetSessionId = sessionId
  (conversation.context as any).budgetSessionId = sessionId
} catch { /* clears conversation.context */ }
finally {
  if (budgetSessionId) { /* works */ }
}
```

## Related

- [Feature flag WebSocket relay pattern](../developer-experience/feature-flag-websocket-relay-pattern-2026-03-31.md) -- the specific budget context payload being threaded
- [Stop and queue architecture](../../stop-and-queue-architecture.md) -- documents `completeConversation()` always-run pattern in the same file
- [Immutability patterns for shared module state](immutability-patterns-shared-module-state-2026-03-30.md) -- classifies WebSocket server Maps as "event-driven cleanup"
- [Defensive HTTP client design](defensive-http-client-design-2026-03-31.md) -- pattern #3 (WebSocket boundary validation) and #5 (pre-execution gating)
- [onMessageStart context metadata timing](../logic-errors/websocket-onmessagestart-context-metadata-timing-2026-04-13.md) -- related lifecycle timing: `onMessageStart` fires before `contextProvider` populates metadata
