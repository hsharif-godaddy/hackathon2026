---
title: useUsage hook ignores enabled flag in loading state
date: 2026-03-31
last_updated: 2026-04-08
category: logic-errors
module: app/src/hooks/useUsage.ts
problem_type: logic_error
component: frontend_stimulus
severity: medium
symptoms:
  - Hook reports isLoading=true when enabled=false and subscription is absent
  - Loading spinners appear before appId is available
  - Disabled hook still propagates derived loading states downstream
root_cause: logic_error
resolution_type: code_fix
tags:
  - react-hooks
  - conditional-queries
  - loading-states
  - refactor-regression
  - feature-flag-removal
---

# useUsage hook ignores enabled flag in loading state

## Problem

The `useUsage` hook ignored the `enabled` parameter when computing `isSubscriptionMissing`, causing `isLoading=true` even when the hook was explicitly disabled via `enabled: false`. Components like `UsageWarningBanner` and `ChatBanners` pass `enabled: !!appId`, so the hook showed spurious loading states before app data was available.

## Symptoms

- `useUsage({ appId: null, enabled: false })` returned `isLoading: true`
- Loading spinners appeared before app data loaded
- The `enabled` flag gated data fetching but not the derived loading state

## What Didn't Work

PR #2342 removed the `app-builder-grants` feature flag OFF branches (AG-8 in Budget Service Q2 scope). The old code gated `isSubscriptionMissing` on `isGrantsEnabled`:

```typescript
const isSubscriptionMissing = isGrantsEnabled === true && !isSubscriptionLoading && !subscription

const isLoading = isGrantsLoading || (isGrantsEnabled === true
  ? (isSubscriptionLoading || isGrantsDataLoading || isSubscriptionMissing)
  : isLegacyLoading)
```

The simplification removed the grants flag and legacy path but dropped the `enabled` gate:

```typescript
const isSubscriptionMissing = !isSubscriptionLoading && !subscription
const isLoading = isSubscriptionLoading || isGrantsDataLoading || isSubscriptionMissing
```

When `enabled=false` and no subscription existed, `isSubscriptionMissing` evaluated to `true`, leaking into `isLoading`.

## Solution

Add `enabled &&` to the `isSubscriptionMissing` calculation:

```typescript
// Before (buggy)
const isSubscriptionMissing = !isSubscriptionLoading && !subscription

// After (fixed); still live
const isSubscriptionMissing = enabled && !isSubscriptionLoading && !subscription
```

The one-line `enabled &&` fix is still in `app/src/hooks/useUsage.ts` (now reading `!resolvedSubscriptionId` instead of `!subscription`).

> **Historical (superseded).** An interim version added an `!isBudgetServiceEnabled` guard to this expression as part of a dual-path (grants vs budget-service) architecture. That dual path has since been removed; billing is unified onto a single grants path, and `useUsage.ts` no longer guards on `isBudgetServiceEnabled` or branches on `useBudgetService`. The current expression is just `enabled && !isSubscriptionLoading && !resolvedSubscriptionId`.

## Why This Works

The `enabled` parameter gates data fetching on line 31 (`subscriptionId: enabled ? subscription?.id : undefined`), but `isSubscriptionMissing` was computed without the same gate. When `enabled=false`:

1. `useCreditGrants` receives `undefined` and doesn't fetch (correct)
2. `useSubscription` still runs (no enabled param)
3. If subscription is absent, `isSubscriptionMissing` becomes `true` (wrong)
4. `isLoading` becomes `true` despite the hook being disabled

Adding `enabled &&` makes the derived state respect the same gate as data fetching. When disabled, `isSubscriptionMissing` stays `false` regardless of subscription state.

## Prevention

1. **Follow existing patterns.** `usePublishLimitCheck` already had the correct pattern: `const isLoading = enabled && (isBypassLoading || isSubscriptionLoading || isPublishedAppsLoading)`. Grep for similar hooks before refactoring.

2. **Gate consistency.** When `enabled` gates data fetching, it must also gate all derived states that depend on that data. If `enabled` controls whether data is fetched, it controls whether "data is missing" means "loading."

3. **Test the disabled case.** Unit tests should assert that `useUsage({ appId: null, enabled: false })` returns `isLoading: false`.

4. **Feature flag removal checklist.** When removing flag-gated loading paths, verify `enabled` still gates the same conditions the flag did. In this case, `isGrantsEnabled === true &&` was the gate that needed to become `enabled &&`.

5. **Dependent query chains.** When adding a new code path that mirrors an existing one, audit all loading state conditions in the reference path. React Query disabled queries report `isLoading: false`, so upstream dependency loading states (`isSubscriptionLoading`) must be explicitly included. See [React Query dependent query loading gate](../ui-bugs/react-query-dependent-query-loading-gate-2026-04-08.md) -- the canonical doc for this dependent-query-chain pattern.

## Related Issues

- PR #2342: feat: remove app-builder-grants OFF branches (introduced the bug)
- Related pattern: `docs/solutions/best-practices/feature-flag-guard-replacement-2026-03-30.md` (agent-side flag removal patterns from the same PR)
- [budgetServiceEnabled without subscriptionId](../best-practices/cp-contract-alignment-bms-signup-runtime-gating-2026-04-13.md#runtime-safety-guard) -- related pattern: feature flag enabled without validating required dependency
