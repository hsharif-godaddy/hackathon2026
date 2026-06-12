---
title: Budget reconciliation must complete before conversation completion event
date: 2026-04-08
last_updated: 2026-04-16
category: best-practices
module: ai-transport
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - Changing the order of operations in the WebSocket message lifecycle
  - Adding new steps between agent execution and completion event
  - Modifying fileBudgetReport or completeConversation
tags:
  - budget-service
  - websocket
  - completion-event
  - reconciliation
  - event-ordering
---

# Budget reconciliation must complete before conversation completion event

## Context

The WebSocket message lifecycle in `experimental-websocket-server.ts` has a critical ordering constraint: budget reconciliation (`fileBudgetReport`) must finish before the conversation completion event (`completeConversation`) fires. This was initially implemented in the wrong order (completion first, reconciliation after) for latency reasons, but reviewer feedback identified the UX problem: the client sees "done" while credit data is still stale.

## Guidance

### Correct order

```
fileBudgetReport()      →  credits deducted, budget_update emitted
completeConversation()  →  client sees "done" with accurate credit state
```

### Why not the reverse

If `completeConversation` fires first, the frontend shows the completion toast while `budget_update` hasn't arrived yet. The usage gauge, budget exceeded banner, and credit displays show stale data. Users may start a new prompt thinking they have credits when reconciliation hasn't finished.

**Note (2026-04-09):** The `budget_update` WebSocket event now triggers an optimistic React Query cache patch that updates aggregate `creditsUsedNumeric` immediately. This partially addresses the stale-data concern for the usage gauge and budget-exceeded banner. However, per-item breakdown in the popover remains stale until the background `invalidateQueries` refetch completes (~100ms). See [budget-frontend-state-zero-credits-and-optimistic-scope](budget-frontend-state-zero-credits-and-optimistic-scope-2026-04-09.md) for details on why per-item optimistic patching was intentionally excluded.

### Progress signal for slow reconciliation

If the BMS round-trip (getSession + createReport + getBudget) takes >10 seconds, a `recovery_status` event with "Reconciling credits..." is emitted so the client shows progress instead of appearing frozen:

```typescript
progressTimer = setTimeout(() => {
  this.publishToEventChannel(socketId, 'recovery_status', 'Reconciling credits...', {}, agentName)
    .catch(() => {})
}, 10_000)
```

The timer is cleaned up via `finally` whether reconciliation succeeds or fails.

### Double-report guard: `judgeReportedSessions` (never landed)

The judge-owned double-report guard (a `judgeReportedSessions` Set coordinating `onBudgetReport` against a judge pipeline that also submits BMS reports) was proposed in PR #2733 but never merged to main; only stale `dist/` artifacts remain. See the judge-config-revert doc for context. The ordering lesson below is independent of that guard and is live.

### Safety: finally-block retry

If reconciliation fails before completion, `budgetReportFiled` resets to `false`. The `finally` block retries. BMS enforces `UNIQUE(session_id)` on reports, so if both the normal path and finally block somehow succeed, there's no double-deduction.

## Why This Matters

- **UX correctness**: users see accurate credit state when completion fires
- **Budget integrity**: credits are deducted before the user can start a new prompt
- **Observability**: the `recovery_status` event surfaces slow BMS calls instead of silent hangs

## When to Apply

- Any change to the post-agent-execution flow in `experimental-websocket-server.ts`
- Adding new steps between agent execution and the `complete` event
- Modifying `fileBudgetReport`, `completeConversation`, or the finally-block retry logic

## Examples

The implementation lives in `packages/ai-transport/src/experimental-websocket-server.ts`, in the main message processing flow (step 8-9). The `onBudgetReport` callback is defined in `agents/src/server/ai-lib-websocket-server.ts`.

## Related

- `docs/solutions/best-practices/bff-parallel-fetch-enrichment-2026-04-07.md` -- BFF-side budget data patterns
- `docs/solutions/best-practices/defensive-http-client-design-2026-03-31.md` -- HTTP client resilience patterns used by BMS client
- [Budget frontend state: zero-credits blocking and optimistic update scope](budget-frontend-state-zero-credits-and-optimistic-scope-2026-04-09.md) -- frontend complement: optimistic update scope decisions
- `docs/solutions/logic-errors/websocket-onmessagestart-context-metadata-timing-2026-04-13.md` -- why `onMessageStart` reads from JWT claims, not context metadata
- PR #2572: feat(budget): GoCode metadata passthrough + report creation
- PR #2733: feat(budget): execution tracker, friction scorer, judge pipeline
- `docs/solutions/architecture-patterns/cost-attribution-sdk-native-over-custom-tracker-2026-04-24.md` -- per-call cost attribution runs before report submission
