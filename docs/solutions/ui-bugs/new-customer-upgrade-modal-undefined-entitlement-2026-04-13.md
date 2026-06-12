---
title: New customer upgrade modal crashes on undefined entitlementId
date: 2026-04-13
last_updated: 2026-04-15
category: ui-bugs
module: app/src/app/[market]/develop/components/paywall
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - Upgrade modal breaks for new customers clicking paid CTAs on landing page
  - CDS ComponentLoader receives entitlementId undefined
  - useSubscription returns data undefined for unregistered users
  - BFF normalizes mgmt-airo 403 to empty subscriptions array
root_cause: missing_validation
resolution_type: code_fix
tags:
  - subscription
  - paywall
  - d2p
  - react-query
  - loading-state
  - upp-library
  - cds
  - new-customer
---

# New customer upgrade modal crashes on undefined entitlementId

## Problem

> **NOTE (2026-04-15):** PR #2772 was closed without merge as it was deemed unnecessary. It used the wrong CDS subType (`SinglePlanUpgrade` with `planGroupId`). The D2P implementation was completed separately. See the [UPP component architecture doc](../best-practices/upp-component-architecture-subtypes-2026-04-14.md) for subType selection and the [CDS purchase callback reliability patterns](../best-practices/cds-purchase-callback-reliability-patterns-2026-04-15.md) for callback handling best practices.

Net-new AiroBuilder customers clicking paid CTAs on the landing page hit a broken upgrade modal. The modal assumed all users had an existing subscription (F2P conversion flow) and passed `entitlementId: undefined` to the UPP library via CDS ComponentLoader, which crashed because it was designed only for F2P/P2P flows.

## Symptoms

- PaywallErrorModal displayed for unregistered customers on paid CTA click
- CDS ComponentLoader received `entitlementId: undefined` and `accountId: undefined`
- `useSubscription()` returned `data: undefined` (BFF normalizes mgmt-airo 403 into `{ subscriptions: [], active: null }`)
- Both `SinglePlanUpgradeContainer` and `HigherPlansUpgradeContainer` passed undefined subscription context to CDS

## What Didn't Work

- **Tri-state model (loading/no-sub/has-sub)**: Missed the "idle" state where query never ran, risking `isNewCustomer` false positives. Same bug class as past `useUsage` loading state bug (2026-03-31) and budget loading gate bug (2026-04-08). (session history)
- **Prop-based `isD2P` flag from UpgradeContainer to SinglePlanUpgradeContainer**: Created two sources of truth (prop and hook) that could disagree during render transitions. Rejected in favor of deriving internally via `useSubscription()`. (session history)
- **Named `purchaseMode` helper function**: Only 2 call sites made inline derivation simpler. (session history)
- **Reusing `HigherPlansUpgradeContainer` for D2P**: Completely divergent CDS prop API (`upgradeCallback` vs `onPurchaseSuccess`, `accountId` vs `entitlementId`, `app` vs `returnApp`) made unification impractical.
- **Silent `return null` for missing shopperId**: Review caught that this creates an empty modal shell with no error message. Changed to `PaywallErrorFallback` with warning log. (session history)

## Solution

UPP team shipped D2P support (unified-plans-and-pricing-library PR #2930) accepting `planGroupId: airoBuilderLineup` + `productId: AiroBuilderProduct`. This repo detects the no-subscription state and wires D2P-specific props.

**1. Five-state `isNewCustomer` in `useSubscription.ts`:**

```typescript
// Gate on isSuccess, NOT just !isLoading -- prevents false positives from idle/disabled queries
const subscriptions = query.data?.subscriptions || [];

return {
  // ...existing fields
  isNewCustomer: query.isSuccess && subscriptions.length === 0,
};
```

Five states: idle (false), loading (false), error (false), success-empty (true), success-with-data (false). Only one state yields `true`.

**2. Routing guard in `UpgradeContainer.tsx`:**

```typescript
const { isLoading, isError, isNewCustomer, error } = useSubscription()

if (isLoading) return <PaywallLoadingModal onClose={onClose} />
if (isError) return <PaywallErrorFallback error={error || new Error('Failed to load subscription')} ... />

// Capability check: D2P users lack subscription context required by HigherPlansUpgradeContainer.
// This guard must survive appbuilder-higher-plans flag cleanup.
if (isNewCustomer) return <SinglePlanUpgradeContainer {...props} />

// Existing flag-driven choice for subscribers
if (isHigherPlansEnabled) return <HigherPlansUpgradeContainer ... />
return <SinglePlanUpgradeContainer ... />
```

**3. Conditional `planGroupId` in `SinglePlanUpgradeContainer.tsx`:**

```typescript
const { data: subscription, isNewCustomer } = useSubscription()

// Guard missing shopperId for D2P users (getShopperId() returns string | null)
if (isNewCustomer && !shopperId) {
  return <PaywallErrorFallback error={new Error('Missing shopper ID for D2P purchase')} ... />
}

<ComponentLoader
  {...(isNewCustomer && { planGroupId: PLAN_GROUP_IDS.AIRO_BUILDER_LINEUP })}
  entitlementId={entitlementId}
  // ...
/>
```

**4. Budget query invalidation in `finally` block:**

```typescript
try {
  const updated = await waitForQueryUpdate(queryClient, ['subscriptions'], predicate, opts)
  // analytics logging
} finally {
  queryClient.invalidateQueries({ queryKey: ['active-subscription'] })
  queryClient.invalidateQueries({ queryKey: ['paywall-feature-flags'] })
  queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
  queryClient.invalidateQueries({ queryKey: [BUDGET_STATUS_QUERY_KEY] })
}
```

**5. `purchaseMode` analytics on existing events:**

```typescript
const purchaseMode = isNewCustomer ? 'd2p' : 'upgrade'
shipAnalyticsLog('airoplus.purchase.in-app', { source, productId, purchaseMode, fromPlan })
```

## Why This Works

- **Five-state model** eliminates false positives by gating `isNewCustomer` on `query.isSuccess` (not `!isLoading`). An idle or disabled query has `isSuccess: false`, so `isNewCustomer` stays `false` until the query definitively returns empty subscriptions.
- **UpgradeContainer error guard** prevents fallthrough to the broken F2P state when subscription query errors. Previously, error state fell through to the flag-driven path which passed undefined entitlementId to CDS.
- **Conditional `planGroupId` spread** leverages CDS ComponentLoader's `Record<string, unknown>` signature. Props pass through to the dynamically-loaded UPP library without version bumps.
- **`shopperId` guard** handles the edge case where `gd-auth.getShopperId()` returns null for some authenticated users. The guard is scoped to D2P users only -- existing subscribers render the modal even without shopperId.
- **`finally` block** ensures budget cache invalidation runs even if polling throws, preventing stale credit data after purchase.
- **Existing polling predicate works for D2P without modification**: `data?.active?.plan !== planBeforePurchase` evaluates to `undefined !== undefined` (keeps polling) until subscription materializes, then `'starter' !== undefined` (exits).

## Prevention

1. **Gate React Query-derived booleans on `isSuccess`, not `!isLoading`**: Prevents false positives when query is idle, disabled, or hasn't executed. Test the idle/disabled case explicitly.
2. **Verify `shopperId` availability**: `gd-auth.getShopperId()` returns `string | null`. Guard against undefined before passing to third-party components.
3. **CDS ComponentLoader is pass-through**: Uses `Record<string, unknown>` spread. New props don't require `@venture/cds-loader` version bumps. The UPP library (loaded remotely by CDS) interprets the props.
4. **Mark permanent capability checks with comments**: `isNewCustomer` is a capability check, not a temporary flag guard. Comment it so it survives `appbuilder-higher-plans` flag cleanup.
5. **Use `try/finally` for cache invalidation**: Ensures cleanup runs even if async operations throw. Invalidating nonexistent query keys is a safe no-op.
6. **Expect `subscription_key_api_error` post-D2P-purchase**: Known UPP-side red herring (confirmed by the UPP team, Apr 2026). Don't treat as regression.

## Related Issues

- `docs/solutions/workflow-issues/upp-payment-error-investigation.md` -- This fix resolves Issue 1 (D2P gap) identified during April 2026 investigation
- `docs/solutions/ui-bugs/react-query-dependent-query-loading-gate-2026-04-08.md` -- Same `isSuccess` vs `!isLoading` pattern
- `docs/solutions/logic-errors/budget-service-enabled-without-subscription-id-2026-04-02.md` -- Same "validate dependency before entering gated path" pattern
- unified-plans-and-pricing-library PR #2930 -- UPP D2P support
- gdcorp-partners/airo-app-builder#2772 -- Closed without merge (deemed unnecessary, used wrong subType)
- D2P implementation merged separately (see D2P plan status)
- `docs/solutions/best-practices/cds-purchase-callback-reliability-patterns-2026-04-15.md` -- Callback handling patterns from PR #2836 review
