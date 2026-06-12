---
title: Paywall renewal modal stuck on dead-end CDS screen
date: 2026-04-30
category: ui-bugs
module: paywall
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - User stuck on dead-end CDS screen after plan renewal showing no available upgrades
  - Modal remains open after successful renewal purchase
  - Stale subscription and grant data displayed after renewal
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags:
  - paywall
  - modal
  - renewal
  - query-invalidation
  - cds
  - higher-plans
---

# Paywall renewal modal stuck on dead-end CDS screen

## Problem

Renewing a paid plan from the publish paywall left users stuck on a dead-end CDS screen showing "Current Plan: Starter. No available upgrades/downgrades." The renewal early-return paths in `HigherPlansUpgradeContainer.handleSuccess` logged analytics but never closed the modal or invalidated queries.

## Symptoms

- User clicks renew on current plan from publish paywall
- Purchase completes successfully, analytics logged
- Modal stays open showing CDS screen with no path forward
- Subscription/grant queries not refreshed (stale UI data)

## What Didn't Work

- Initial fix duplicated the 4-query invalidation block inline in both renewal paths, leading to PR feedback about code duplication. Extracted to shared `invalidatePlanQueries` utility in follow-up.
- JSDoc for `waitForQueryUpdate` was initially misplaced above the new `invalidatePlanQueries` function. Removed entirely per project no-comments convention.

## Solution

Added cleanup to the renewal early-return path. The fix mirrors what the upgrade/downgrade paths already had via `handlePurchaseSuccess`'s `onSettled` callback. The two separate early-return paths (same-plan and downgrade-plan) were also consolidated into a single `detectRenewal()` branch, so cleanup lives in one place rather than being duplicated per path.

**Before (two separate bare-return paths):**
```typescript
if (planBeforePurchase && planAfterPurchase && planBeforePurchase === planAfterPurchase) {
  shipAnalyticsLog('paid_plan.renewal.success', { source, productId, plan: planAfterPurchase })
  return  // bare return - user stuck in modal with stale queries
}
// ... a second analogous bare-return path for the downgrade-plan case
```

**After (one branch, both renewal types):**
```typescript
const renewal = detectRenewal(planBeforePurchase, planAfterPurchase, downgradedPlan)
if (renewal) {
  const event = renewal === 'same_plan' ? 'paid_plan.renewal.success' : 'paid_plan.renewal_downgrade.success'
  shipAnalyticsLog(event, { source, productId, plan: planAfterPurchase })
  invalidatePlanQueries(queryClient)
  onSuccessClick?.()
  resetFocusOnModalClose()
  return
}
```

`detectRenewal()` returns `'same_plan' | 'downgrade_plan' | null`; the single branch emits `paid_plan.renewal.success` for same-plan or `paid_plan.renewal_downgrade.success` for downgrade, then runs the shared cleanup.

**Shared utility** extracted to `app/src/lib/query-utils.ts`:
```typescript
export function invalidatePlanQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
  queryClient.invalidateQueries({ queryKey: ['active-subscription'] })
  queryClient.invalidateQueries({ queryKey: ['paywall-feature-flags'] })
  queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
}
```

Used in both `HigherPlansUpgradeContainer` renewal paths and `useUpgradePurchase`'s `onSettled` callback.

## Why This Works

The renewal detection logic (added March 2026 to prevent infinite polling) correctly bypassed the polling flow for same-plan purchases. But it used bare `return` statements that skipped all post-purchase cleanup. The upgrade/downgrade paths had cleanup via `handlePurchaseSuccess`'s mutation `onSettled` callback, but renewals bypassed that entirely.

The three cleanup actions:
1. `invalidatePlanQueries(queryClient)` refreshes subscription, grants, and feature flags so UI reflects the new paid-through date
2. `onSuccessClick?.()` triggers parent component cleanup (modal close)
3. `resetFocusOnModalClose()` restores keyboard focus (accessibility)

## Prevention

- **Early return checklist**: any early return in a purchase/mutation callback must explicitly handle cleanup (modal state, query invalidation, focus management, parent callbacks). Bare returns are never safe in flows that have side effects on the non-early-return path.
- **Shared query invalidation**: extract invalidation to utilities (`invalidatePlanQueries`) rather than duplicating `invalidateQueries` calls. Keeps query key lists in sync across code paths.
- **Test both renewal types**: same-plan renewal and downgrade-plan renewal are separate branches. Test each with and without optional callbacks (e.g., `onSuccessClick` absent).
- **Review callback chains**: when adding early returns that bypass existing async flows, verify what cleanup the bypassed flow provided and replicate it.

## Related Issues

- [CDS purchase callback reliability patterns](../best-practices/cds-purchase-callback-reliability-patterns-2026-04-15.md) (session history) documents the principle that every exit path from a purchase callback must close the modal and invalidate queries
- [D2P upgrade modal undefined entitlement](../ui-bugs/new-customer-upgrade-modal-undefined-entitlement-2026-04-13.md) established the 4-query invalidation pattern reused here
- [Dual-path feature flag query invalidation](../best-practices/dual-path-feature-flag-react-query-websocket-2026-04-09.md) documents the shared invalidation utility pattern
- PR [#3283](https://github.com/gdcorp-partners/airo-app-builder/pull/3283)
