---
title: Budget path drops isSubscriptionLoading from dependent query loading gate
date: 2026-04-08
category: ui-bugs
module: app/src/hooks/useUsage.ts
problem_type: ui_bug
component: frontend_stimulus
severity: low
symptoms:
  - UsageGauge briefly renders 0% on first load when budget-service flag is ON
  - No loading spinner during initial subscription fetch in budget path
  - Grants path shows spinner correctly under identical conditions
root_cause: logic_error
resolution_type: code_fix
tags:
  - react-query
  - loading-state
  - dependent-queries
  - budget-service
  - dual-path
---

# React Query dependent query loading gate

## General lesson (canonical)

When query B depends on query A's data for its `enabled` gate, gate the composite loading state on `isSuccess` of the dependency chain (or explicitly include query A's loading state) -- never on `!isLoading` of B alone. React Query does NOT propagate loading state through dependency chains: a disabled child query (`enabled: false`) reports `isFetching: false` and `isLoading: false`, so the parent's still-loading state is invisible unless you include it explicitly:

```typescript
// Wrong: child query is disabled while parent loads, so this is false too early
const showLoading = isChildLoading
// Right: include the upstream dependency
const showLoading = isParentLoading || isChildLoading
```

The case study below is the original budget-service dual-path occurrence. The specific `isBudgetServiceEnabled` dual-path is gone (billing unified onto a single grants path; `UsageGauge.tsx` now uses `showLoading = isSubscriptionLoading || isGrantsLoading`), but the general lesson above is why this doc is the canonical reference for dependent-query loading gates.

## Case study (historical): budget path drops isSubscriptionLoading

> **Superseded specifics.** The dual-path code below no longer exists; it is retained as the concrete illustration that produced the general lesson.

When implementing dual-path (grants vs budget-service) credit display in PR #2645, the budget path's loading gate dropped `isSubscriptionLoading` from both `UsageGauge.tsx` and `useUsage.ts`. The gauge briefly rendered 0% instead of a loading spinner on first render.

## Symptoms

- UsageGauge shows 0% fill for a frame before budget data arrives
- No loading spinner during initial page load when budget-service flag is ON
- Grants path (`isSubscriptionLoading || isGrantsLoading`) shows spinner correctly
- Premature threshold tracking analytics fired on the 0% value

## What Didn't Work

Bug caught by copilot code review on PR #2645, not by automated tests or manual testing. Existing unit tests mocked `useSubscription` with pre-loaded data, so the loading race never occurred in test. (session history)

This is the same class of error as the [March 31 useUsage loading state bug](../logic-errors/useusage-loading-state-enabled-bug-2026-03-31.md), but in reverse: that bug forgot the `enabled` gate on derived loading state; this bug forgot the dependency loading gate when adding a new code path. (session history)

## Solution

Include `isSubscriptionLoading` in the budget path loading check, mirroring the grants path.

**UsageGauge.tsx:**

```typescript
// Before (buggy):
const showLoading = isBudgetServiceEnabled
  ? isBudgetLoading
  : (isSubscriptionLoading || isGrantsLoading)

// After (fixed):
const showLoading = isBudgetServiceEnabled
  ? (isSubscriptionLoading || isBudgetLoading)
  : (isSubscriptionLoading || isGrantsLoading)
```

**useUsage.ts:**

```typescript
// Before (buggy):
const isLoading = isBudgetServiceEnabled
  ? (enabled && isBudgetFetching)
  : (isSubscriptionLoading || isGrantsDataLoading || isSubscriptionMissing)

// After (fixed):
const isLoading = isBudgetServiceEnabled
  ? (enabled && (isSubscriptionLoading || isBudgetFetching))
  : (isSubscriptionLoading || isGrantsDataLoading || isSubscriptionMissing)
```

Commit: `40294dd`

## Why This Works

React Query v5 defines `isLoading` as `isPending && isFetching`. When a query is disabled (via `enabled: false`), it does not fetch, so `isFetching` is false and `isLoading` is false.

The data flow that causes the bug:

1. `useSubscription()` is fetching: `subscription` = undefined
2. `useBudgetService({ subscriptionId: subscription?.id, enabled: true })` -- internally `queryEnabled = enabled && !!subscriptionId` = `false`
3. React Query sees disabled query, sets `isFetching: false`, thus `isBudgetLoading: false`
4. Without `isSubscriptionLoading`, nothing signals that the UI is still waiting for data

The grants path already handled this correctly because it always included `isSubscriptionLoading` in the loading check. The budget path was a new conditional branch that only checked `isBudgetLoading`, missing the upstream dependency.

## Prevention

1. **When adding dual-path conditionals:** Audit all loading state conditions in the reference path and ensure the new path includes equivalent dependencies. The grants path is the reference pattern here.

2. **React Query dependent query chains:** When query B depends on query A's data for its `enabled` gate, always include query A's loading state in the composite loading check: `isQueryALoading || isQueryBLoading`. React Query does not propagate loading state through dependency chains automatically.

3. **Test the loading race:** Unit tests should include a case where the parent query (`useSubscription`) is still loading and the child query is disabled, asserting the composite `isLoading` is true.

## Related Issues

- [Dual-path feature flag pattern](../best-practices/dual-path-feature-flag-react-query-websocket-2026-04-09.md) -- the dual-path integration where this loading gate issue was discovered
- [useUsage loading state enabled bug](../logic-errors/useusage-loading-state-enabled-bug-2026-03-31.md) -- same file, same loading state area, different dimension (missing `enabled` gate vs missing dependency loading gate)
- [budgetServiceEnabled without subscriptionId](../logic-errors/budget-service-enabled-without-subscription-id-2026-04-02.md) -- related pattern: feature flag enabled without validating required dependency
- PR #2645 on `feat/budget-frontend-state`
- TanStack Query docs: [Disabling Queries](https://tanstack.com/query/latest/docs/framework/react/guides/disabling-queries) -- confirms `isLoading` is false for disabled queries
