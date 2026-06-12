---
title: onMessageStart reads context metadata before contextProvider populates it
date: 2026-04-13
updated: 2026-06-11
status: FIXED (2026-06); all bugs resolved in codebase
category: logic-errors
module: ai-lib-websocket-server
problem_type: logic_error
component: assistant
severity: high
symptoms:
  - "ExecutionContextTracker reported toolCallCount: 0 for all messages despite tools being called"
  - "performBudgetPreCheck silently skipped (returned null) -- no BMS session created"
  - "BudgetServiceClient 404 on session creation after BMS route restructuring (PR #2770)"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - budget-service-client
tags:
  - websocket
  - budget-service
  - execution-tracker
  - lifecycle-timing
  - jwt-claims
  - context-metadata
  - onMessageStart
---

# onMessageStart reads context metadata before contextProvider populates it

## Problem

Code in `onMessageStart` that reads `metadata.budgetServiceEnabled` from the context object always gets `undefined` because `contextProvider` (which sets that field) runs later during `assembleMessages`. This caused the execution tracker to never initialize and the budget pre-check to silently skip. A secondary issue: `BudgetServiceClient` used outdated API paths after BMS route restructuring.

## Symptoms

- The execution tracker reported `toolCallCount: 0` despite agent executing 3 tool calls (directoryListing, readFile, str_replace_based_edit_tool). (The `ExecutionContextTracker` / `friction.computed` subsystem referenced in the original writeup has since been removed.)
- Tier 2 friction patterns could never fire (scorer always received empty input)
- `performBudgetPreCheck` returned null without error (no BMS session created)
- After merging main with BMS PR #2770, session creation returned 404 (`/api/v1/budgets/{budgetId}/sessions` no longer exists)

## What Didn't Work

- Initially suspected ai-lib transport lacked the callback interface -- but `onToolStart`/`onToolEnd`/`onLlmStart` are defined in `WebSocketConfig` and invoked from `startToolSpan`/`endToolSpan`
- Verified transport invoked callbacks correctly with matching socketIds
- Added debug logging to callback implementations -- confirmed callbacks fired but `hasTracker: false, trackerCount: 0` (session history)
- Suspected socketId mismatch between `onMessageStart` (tracker creation) and `onToolStart` (tracker lookup) -- both use `socket.id`, no mismatch

## Solution (FIXED)

> **Status (2026-06):** All three bugs are fixed in the codebase.
> - `agents/src/server/ai-lib-websocket-server.ts:1561` reads `const budgetServiceEnabled = agentContext?.budgetServiceEnabled === true` from the JWT `agentContext`, not from context metadata.
> - `packages/ai-lib/src/budget/budget-service-client.ts` uses the flat session paths: `createSession` POSTs `/api/v1/sessions`, `getSession` GETs `/api/v1/sessions/${sessionId}`.

**Bug 1 & 2: Read budgetServiceEnabled from JWT claims, not context metadata**

The JWT claims are available from connection time via `socket.handshake.auth.agentContext`. Context metadata is populated later by `contextProvider`.

```typescript
// agents/src/server/ai-lib-websocket-server.ts

// Before (broken -- metadata not yet populated):
budgetServiceEnabled: typedContext?.metadata?.budgetServiceEnabled,
subscriptionId: typedContext?.metadata?.subscriptionId as string | undefined,

// After (fix) -- JWT claims available from connection:
const budgetServiceEnabled = agentContext?.budgetServiceEnabled === true
```

Same fix for `subscriptionId`: read it from the JWT `agentContext` rather than `context.metadata`.

**Bug 3 (FIXED): Update BudgetServiceClient to flat session paths (PR #2770)**

```typescript
// packages/ai-lib/src/budget/budget-service-client.ts (current)
// createSession: POST /api/v1/sessions
// getSession:    GET  /api/v1/sessions/${sessionId}
```

## Why The Fix Works

The ai-transport websocket server lifecycle runs in this order:

1. `processContext()` (line 2147 of `experimental-websocket-server.ts`) -- builds initial context; calls `contextExtractor` which injects permissions/authType but NOT budgetServiceEnabled
2. **`onMessageStart`** (line 2216) -- called with processedContext; `metadata.budgetServiceEnabled` is still undefined here
3. `assembleMessages` -> **`contextProvider.loadContextMessages`** (line 3005) -- THIS populates `metadata.budgetServiceEnabled` (via agents' contextProvider at line 663 of `ai-lib-websocket-server.ts`)
4. `streamGenerate` starts -> tool calls fire -> `onToolStart`/`onToolEnd` callbacks

Steps 1-2 happen before step 3. Any code in `onMessageStart` that needs data set by `contextProvider` will see `undefined`. The fix reads from the JWT `agentContext` (carried on the socket handshake auth), available from connection time, before any of these steps.

This is the same source the `contextProvider` itself reads from in `ai-lib-websocket-server.ts`. The fix aligns `onMessageStart` with `contextProvider` by reading from the same origin.

## Prevention

- When reading state in `onMessageStart`, prefer `socket.handshake.auth.agentContext` (JWT claims, always available) over `context.metadata` (populated later by contextProvider)
- Document the callback lifecycle order in `ai-lib-websocket-server.ts`: `processContext` -> `onMessageStart` -> `assembleMessages` -> `contextProvider.loadContextMessages` -> `streamGenerate` -> tool callbacks
- When BMS API routes change, update all consumers (`ai-lib` client, BFF client) and run integration tests against the deployed environment
- Run `pnpm typecheck` after API client changes -- vitest won't catch response type mismatches
- **Not every field on `context.metadata` is populated late.** `context.metadata.conversationId` is set by `attachConversationId` in `packages/ai-transport/src/experimental-websocket-server.ts` (~line 3207), which runs *before* `onMessageStart`. The rule is not "prefer JWT over metadata" in all cases — it is "know which code path populates each field at which lifecycle step, and read from the one guaranteed to have fired." See [Cost-attribution OTel spans silently dropped for first-message sessions (2026-05-07)](./cost-attribution-conversationid-source-2026-05-07.md) for the opposite-direction case: reading from `context.metadata.conversationId` first and falling back to `context.conversation.conversationId`, because `metadata` is server-canonical for conversationId and `conversation` is client-sent (absent on first-message sessions).

## Related Issues

- [Context threading across agent handoffs](../best-practices/context-threading-across-agent-handoffs-2026-04-02.md) -- related lifecycle timing: `processedContext` is replaced on handoffs, budget fields must be threaded via `conversation.context`
- [Extract inline callback logic for testability](../best-practices/extract-inline-callback-logic-for-testability-2026-04-06.md) -- the `performBudgetPreCheck` extraction pattern that was affected by this timing bug
- PR #2770: `budget-service: flatten session APIs to /api/v1/sessions`
- [Switchboard JWT config transport](../best-practices/switchboard-jwt-config-transport-2026-04-15.md) -- applies the agentContext-over-metadata principle to per-session judge config
- [Cost-attribution OTel spans silently dropped for first-message sessions (2026-05-07)](./cost-attribution-conversationid-source-2026-05-07.md) -- inverse case: for `conversationId`, `context.metadata` is the canonical source and `context.conversation` is the client-sent fallback. Same file, same lifecycle, opposite resolution direction. The pair establishes the authoritative-source map for this subsystem.
