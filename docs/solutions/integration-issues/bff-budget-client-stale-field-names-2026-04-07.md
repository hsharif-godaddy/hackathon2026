---
title: "BFF budget client field names out of sync with shared types"
date: 2026-04-07
category: integration-issues
module: budget-service
problem_type: integration_issue
component: service_object
severity: medium
symptoms:
  - "pnpm typecheck fails after merge: Property 'renewInterval' does not exist on type 'BudgetItem'"
  - "BFF client validates creditSpendRatio, expireAt, renewInterval but shared types use costToCreditRatio, expiresAt, resetInterval"
  - "BFF client validates item-level creditsPending but field was removed from BudgetItem"
root_cause: config_error
resolution_type: code_fix
tags:
  - budget
  - bff
  - shared-types
  - type-drift
  - merge-conflict
  - validation
---

# BFF budget client field names out of sync with shared types

> **Updated 2026-06-11.** The specific bug class here is structurally gone: `app/src/lib/budget-service/client.ts` was rewritten to use zod schemas, so the hand-rolled `assert*Shape` validators (and their field-name drift) no longer exist. The live zod schema fields are `costToCreditRatio`/`expiresAt`/`resetInterval`. The durable lesson survives: shared-type field renames are invisible to consumers until `tsc` runs, so grep every consumer of a shared type when renaming a field. The code examples below are retained as a historical illustration of the validator class that was removed.

## Problem

BFF budget service client (`app/src/lib/budget-service/client.ts`) used stale BMS API field names in its manual `assert*Shape` validators, diverging from `@airo/shared/budget` types that were updated on main. Surfaced as typecheck failures after merging `origin/main` into `feat/budget-ux`.

## Symptoms

- `pnpm typecheck` error: `Property 'renewInterval' does not exist on type 'BudgetItem'. Did you mean 'resetInterval'?`
- Similar mismatches for `creditSpendRatio` (now `costToCreditRatio`) and `expireAt` (now `expiresAt`)
- BFF client validated `creditsPending` on `BudgetItem`, a field that had been removed from the type (kept on `BudgetResponse`)

## What Didn't Work

The typecheck run showed multiple errors. Some were pre-existing on main (unrelated test files), some were merge artifacts. Had to isolate by checking out main's versions of the affected test files and running typecheck independently to confirm the BFF client errors were merge-specific.

## Solution

Renamed stale fields in `assertBudgetItemShape` and removed the defunct `creditsPending` item-level check.

**Before** (`app/src/lib/budget-service/client.ts`):
```typescript
function assertBudgetItemShape(item: unknown, index: number): asserts item is BudgetItem {
  const d = asRecord(item, `BudgetItem at index ${index}`)
  if (
    typeof d.budgetItemId !== 'string' ||
    typeof d.creditsTotal !== 'string' ||
    typeof d.creditsUsed !== 'string' ||
    typeof d.creditsPending !== 'string' ||   // removed from BudgetItem
    typeof d.creditSpendRatio !== 'string' ||  // renamed
    typeof d.startsAt !== 'string' ||
    typeof d.expireAt !== 'string' ||          // renamed
    (d.renewInterval !== null && typeof d.renewInterval !== 'string')  // renamed
  ) { ... }
}
```

**After**:
```typescript
function assertBudgetItemShape(item: unknown, index: number): asserts item is BudgetItem {
  const d = asRecord(item, `BudgetItem at index ${index}`)
  if (
    typeof d.budgetItemId !== 'string' ||
    typeof d.creditsTotal !== 'string' ||
    typeof d.creditsUsed !== 'string' ||
    typeof d.costToCreditRatio !== 'string' ||
    typeof d.startsAt !== 'string' ||
    typeof d.expiresAt !== 'string' ||
    (d.resetInterval !== null && typeof d.resetInterval !== 'string')
  ) { ... }
}
```

Test mocks and assertions in `client.test.ts` updated to match. All 23 tests pass.

## Why This Works

At the time of the bug the codebase had two independent budget service clients consuming `@airo/shared/budget`:

1. **ai-lib client** (`packages/ai-lib/src/budget/budget-service-client.ts`) -- uses zod schemas, updated alongside shared types on main
2. **BFF client** (`app/src/lib/budget-service/client.ts`) -- then used manual `assertField` checks, written against older API field names on a feature branch (since rewritten to zod, eliminating this drift class)

The manual validators didn't get automatic type-narrowing from zod schemas, so field name drift was invisible until `tsc` ran on the merge result. The BMS API field names evolved during the budget service work (the in-repo Go service at `budget-service/` is the source of truth), and only the ai-lib client was updated in lockstep. (auto memory [claude])

## Prevention

1. **Tie manual validators to the type.** If manual validators must stay, use `Record<keyof T, ...>` so the compiler catches field changes:
   ```typescript
   const BUDGET_ITEM_KEYS: (keyof BudgetItem)[] = [
     'budgetItemId', 'creditsTotal', 'creditsUsed',
     'costToCreditRatio', 'startsAt', 'expiresAt', 'resetInterval',
   ]
   ```
   Adding or removing a field from `BudgetItem` forces a compile error here.

2. **When renaming shared type fields, grep all consumers in the same PR.** `@airo/shared/budget` is consumed by both `packages/ai-lib/` and `app/`. Field renames in shared types must propagate to all consumers atomically.

3. **Run typecheck on merge result, not just branch tip.** The BFF client's branch hadn't been rebased, so the drift was invisible until the merge commit.

## Related Issues

- [budget-service-client-simplification-patterns-2026-04-03.md](../best-practices/budget-service-client-simplification-patterns-2026-04-03.md) -- complementary: covers agent-side client patterns, zod validation with `.passthrough()` for evolving APIs
- [claude-md-codebase-drift-2026-03-27.md](../documentation-gaps/claude-md-codebase-drift-2026-03-27.md) -- analogous pattern: source-of-truth changes not propagated to all consumers
