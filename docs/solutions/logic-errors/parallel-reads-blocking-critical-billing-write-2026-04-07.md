---
title: "Promise.all parallelization blocks critical billing write when non-critical read fails"
date: 2026-04-07
category: logic-errors
module: agents, ai-lib (budget)
problem_type: logic_error
component: payments
severity: critical
symptoms:
  - "getBudget failure in Promise.all prevents createReport from executing"
  - "BMS session left unreconciled after AI resource consumption"
  - "Credits not deducted despite LLM calls attributed to session"
root_cause: async_timing
resolution_type: code_fix
tags:
  - billing-safety
  - promise-all
  - operation-ordering
  - budget-service
  - createReport
  - getBudget
  - graceful-degradation
---

# Promise.all parallelization blocks critical billing write when non-critical read fails

## Problem

Parallelizing `getSession` + `getBudget` before `createReport` in the `onBudgetReport` callback creates a billing gap. If `getBudget` fails in `Promise.all`, the rejection propagates immediately and `createReport` never executes. The BMS session remains open with no report filed, meaning the user consumed AI resources but credits are never deducted. BMS has no session TTL, so the session stays open indefinitely.

## Symptoms

- `getBudget` failure in `Promise.all([getSession, getBudget])` prevents `createReport` from executing
- BMS session remains open without credit reconciliation
- User consumed AI resources (LLM calls attributed to BMS session via GoCode `x-gocode-budget-*` headers) but credits never deducted
- No error visible to user (session just stays open silently)

## What Didn't Work

**Parallelizing independent reads before the critical write:**

```typescript
// WRONG: getBudget failure blocks createReport
const [session, budget] = await Promise.all([
  client.getSession(budgetId, sessionId),
  client.getBudget(budgetId),
])

const report = await client.createReport(budgetId, sessionId, {
  reportItems: [{ budgetCost: session.costTotal.toString(), productCost: '0', label: 'airo-builder:general' }],
})

return { refreshRequired: false, payload: toBudgetUpdatePayload(report, budget) }
```

**Why it failed:** `Promise.all` rejects immediately when any promise rejects. `getSession` and `getBudget` are independent reads, but `createReport` depends on `getSession` output (`costTotal`) and is the critical billing operation. Putting `getBudget` in the same `Promise.all` means its failure blocks `createReport`, even though `getBudget` is only needed for UI enrichment (per-item budget breakdown).

## Solution

Run the critical write (`createReport`) before the non-critical read (`getBudget`). Wrap `getBudget` in try/catch for graceful degradation:

```typescript
// CORRECT: createReport runs regardless of getBudget outcome
const session = await client.getSession(budgetId, sessionId)

// Critical path: deduct credits (must succeed for billing correctness)
const report = await client.createReport(budgetId, sessionId, {
  reportItems: [{ budgetCost: session.costTotal.toString(), productCost: '0', label: 'airo-builder:general' }],
})

// Non-critical: fetch per-item breakdown for UI (graceful degradation)
try {
  const budget = await client.getBudget(budgetId)
  return { refreshRequired: false, payload: toBudgetUpdatePayload(report, budget) }
} catch (err) {
  logger.error('budget.report.payload_failed', {
    budgetId, sessionId, reportId: report.reportId,
    error: err instanceof Error ? err.message : String(err),
  })
  return { refreshRequired: true }
}
```

## Why This Works

1. `createReport` runs unconditionally after `getSession` -- credits deducted before any enrichment attempt
2. `getBudget` failure after `createReport` is graceful degradation: credits already deducted, client gets `{ refreshRequired: true }` to re-fetch via BFF
3. Flow matches the original pre-optimization sequencing (`getSession` -> `createReport` -> enrichment) while still eliminating the redundant `getReport` call

**Original flow:** `getSession` -> `createReport` -> `Promise.all([getReport, getBudget])` (4 calls)
**Broken optimization:** `Promise.all([getSession, getBudget])` -> `createReport` (3 calls, billing gap)
**Fixed optimization:** `getSession` -> `createReport` -> `getBudget` (3 calls, billing safe)

## Prevention

**General rule for billing/payment flows:** never gate the critical write (credit deduction, payment capture) on a non-critical read (UI enrichment, analytics).

**When reviewing `Promise.all` in billing code:**

1. Ask: "If any promise in this array fails, which operations must still execute for billing correctness?"
2. Separate: critical writes run sequentially before `Promise.all`. Only parallelize operations where all-or-nothing failure is acceptable
3. Test: add failure injection tests verifying billing-critical operations execute when enrichment throws

**Test pattern:**

```typescript
it('getBudget fails after createReport: returns refreshRequired (credits still deducted)', async () => {
  const client = mockReportClient({
    getBudget: vi.fn().mockRejectedValue(new BudgetServiceError('not found', 404, '{}')),
  })
  const result = await simulateOnBudgetReport(client, 'budget-1', 'session-1')

  expect(result.refreshRequired).toBe(true)
  expect(client.createReport).toHaveBeenCalled() // Critical path succeeded
})
```

## Related Issues

- `docs/solutions/logic-errors/nan-bypass-budget-service-fail-closed-2026-04-06.md` -- sibling pattern: fail-closed billing safety at pre-execution check (NaN bypass)
- `docs/solutions/logic-errors/budget-service-enabled-without-subscription-id-2026-04-02.md` -- related: missing validation before committing to billing code path
- `docs/solutions/best-practices/budget-service-client-simplification-patterns-2026-04-03.md` -- retry strategy for critical reconciliation paths
- `docs/solutions/best-practices/defensive-http-client-design-2026-03-31.md` -- `getBudget` is non-critical only when called AFTER `createReport`
- The issue was caught during code review of the `getReport` elimination refactor.
- `docs/solutions/best-practices/budget-reconciliation-before-completion-2026-04-08.md` -- note: when `budgetServiceEnabled=true`, the judge pipeline in `beforeMessageComplete` now owns `createReport`. The `onBudgetReport` old path is skipped via `judgeReportedSessions` guard.
