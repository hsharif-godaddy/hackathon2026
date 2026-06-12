---
title: "Budget frontend state: zero-credits blocking and optimistic update scope"
date: 2026-04-09
category: best-practices
module: app
problem_type: best_practice
component: frontend_stimulus
severity: low
applies_when:
  - "reviewing or modifying budget frontend state (zero-credits blocking, optimistic updates)"
  - "adding client-side credit allocation or per-item breakdown display"
  - "changing chat input disabled/enabled logic tied to credits"
  - "modifying agent-side performBudgetPreCheck"
tags:
  - budget-service
  - optimistic-updates
  - credits
  - pr-review-defense
  - websocket
  - react-query
---

# Budget frontend state: zero-credits blocking and optimistic update scope

## Context

During PR review of `feat/budget-frontend-state` (#2645), a reviewer raised two design questions:

1. When `creditsTotalNumeric` and `creditsUsedNumeric` are both 0, `(0 - 0) > 0` evaluates to `false`, disabling chat. Is that a bug?
2. The optimistic `budget_update` WebSocket handler patches top-level credits but not the per-item breakdown in the popover. Why?

Both decisions were validated against the [Budget Service Y26.Q2 Confluence spec](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/4318986371), specifically requirements UX-3, BS-5, BS-6, BS-12, CP-1, CP-4, and UX-2.

## Guidance

### Decision 1: Zero credits blocks chat input (fail-closed)

When both total and used credits are 0, the expression `(total - used) > 0` is `false`, and chat is disabled. This is intentional.

- **UX-3 (P0):** "Block prompt if no credits available." Zero total means the control plane never provisioned credits for this subscription.
- **CP-1/CP-4:** Credits are provisioned upstream by the control plane on entitlement events. A zero-budget state means no entitlement created a budget.
- **Agent parity:** The agent gates execution server-side -- `performBudgetPreCheck` (`agents/src/server/budget-pre-check.ts`) calls `createSession`, and BMS returns a 402 `BudgetNoCapacityError` when capacity is zero. (Updated 2026-06-11: the old client-side `!(remaining > 0)` numeric gate on this path was replaced by server-side 402 validation.)

### Decision 2: Optimistic update patches top-level only, not per-item

The `budget_update` WebSocket event optimistically updates `creditsUsedNumeric` at the aggregate level but leaves individual `items[]` untouched.

- **BS-5:** BMS uses soonest-expiring-first ordering when consuming credits.
- **BS-6:** When one budget exhausts, consumption cascades to the next.
- **BS-12:** Each budget has a different `costToCreditRatio` coefficient (entity model shows values like 100, 100, 110).
- Replicating this allocation logic client-side would be fragile and could produce incorrect per-item numbers that contradict BMS.
- `invalidateQueries` fires immediately after the optimistic patch, triggering a background refetch. Authoritative data arrives in ~100ms.
- **UX-2** success criteria: "within 200ms of reconciliation" -- the ~100ms staleness satisfies this.
- The `assignment` field (per-report deduction breakdown) was explicitly removed from the `budget_update` event shape. The design decision was: "Frontend only needs `budgets[]` (remaining per item) + `customerRemaining`. The per-report deduction breakdown is reconciliation bookkeeping with no frontend consumer." (session history)

## Why This Matters

- **Zero-credits blocking** prevents unbilled GoCode LLM usage. Each prompt costs real money. Allowing prompts when no budget exists would create unrecoverable cost.
- **Not replicating BMS allocation client-side** avoids a class of bugs where the UI shows incorrect per-item breakdowns that contradict the server. Users seeing wrong budget-item attribution would lose trust in the credit system.
- **Per-item optimistic breakdown was considered and rejected** as "complex and error-prone" due to different coefficients per item. The ~100ms inconsistency window (popover open during the gap between optimistic patch and refetch) was deemed acceptable. (session history)

## When to Apply

- Modifying `hasAvailableCredits` derivation or `budgetExceeded` flag in `ChatPane.tsx`
- Adding or modifying optimistic updates for budget data in `useBudgetUpdate.ts`
- Implementing any client-side credit allocation or per-item breakdown display
- Changing the agent-side `performBudgetPreCheck` logic
- Reviewing PRs that touch budget frontend state -- these decisions are spec-backed, not accidental

## Examples

### Zero-credits check gating chat input (client-side)

From `app/src/app/[market]/develop/components/chat/ChatPane.tsx` (unified to a single `CreditGrant[]` path; the old `isBudgetServiceEnabled ? budgetData : grants` fork is gone):

```typescript
// Unified credit availability check
const hasAvailableCredits = grants !== undefined && getActiveGrant(grants) !== undefined

// Data loaded gate: prevents false "budget exceeded" during fetches
const dataLoaded = grants !== undefined && !isGrantsFetching

const budgetExceeded = !isImpersonating && !hasAvailableCredits && (dataLoaded || budgetExceededFlag)
```

Key: `grants !== undefined` prevents blocking before data loads. `dataLoaded` gate prevents false positives during fetches. CRM/impersonation sessions bypass budget checks.

### Zero-credits check (agent-side, server-validated)

From `agents/src/server/budget-pre-check.ts` (rewritten 2026-06-11 from a client-side numeric gate to server-side 402 validation):

```typescript
// Capacity is validated by BMS, not computed client-side.
// createSession returns 402 BudgetNoCapacityError when no capacity remains.
await budgetClient.createSession(bmsBudgetId, { allowOverage })
```

There is no longer a `getBudget`/`computeRemaining`/`!(remaining > 0)` numeric gate on this path; the fail-closed decision is delegated to BMS. The surviving NaN-safety analog is the BFF adapter's `toNumber` coercion (fail-closed to 0).

### Optimistic budget update (WebSocket handler)

From `app/src/hooks/useBudgetUpdate.ts`:

The handler optimistically patches the aggregate remaining/used credits on the cached grant data, then fires `invalidateQueries` immediately to fetch authoritative per-item breakdown from BMS. Only the top-level aggregate is patched; the per-item array is left untouched. (Updated 2026-06-11: the frontend unified to `CreditGrant[]`; the old `CreditStatusResponse`/`creditsTotalNumeric`/`creditsUsedNumeric` shape no longer exists, but the optimistic-patch-top-level-only design is unchanged.)

### `computeRemaining` (shared utility)

From `packages/ai-lib/src/budget/types.ts`:

```typescript
export function computeRemaining(total: string, used: string): number {
  const result = parseFloat(total) - parseFloat(used)
  return Math.round(result * 1e6) / 1e6
}
```

Rounds to 6 decimal places to match BMS's `NUMERIC(20,6)` column precision and avoid float drift. (session history)

## Related

- [Dual-path feature flag pattern](dual-path-feature-flag-react-query-websocket-2026-04-09.md) -- the overall integration pattern these decisions belong to
- [NaN bypass budget service fail-closed](../logic-errors/nan-bypass-budget-service-fail-closed-2026-04-06.md) -- the `!(remaining > 0)` pattern underlying Decision 1
- [Budget reconciliation before completion](../best-practices/budget-reconciliation-before-completion-2026-04-08.md) -- server-side reconciliation ordering; Decision 2 is the frontend complement
- [React Query dependent query loading gate](../ui-bugs/react-query-dependent-query-loading-gate-2026-04-08.md) -- sibling doc from same PR, covers loading states for budget path
- [Parallel reads blocking critical billing write](../logic-errors/parallel-reads-blocking-critical-billing-write-2026-04-07.md) -- backend analog of Decision 2 (graceful degradation when getBudget fails after createReport)
- [Budget service client simplification patterns](../best-practices/budget-service-client-simplification-patterns-2026-04-03.md) -- Pattern #4 ("surface only finalized data") directly supports Decision 2
- [Effective socket ID for direct emit](../best-practices/effective-socket-id-for-direct-emit-2026-04-06.md) -- delivery mechanism for the `budget_update` event
- [Confluence: Paywall, AI Credits, and Budget Service Y26.Q2](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/4318986371)
