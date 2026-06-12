---
title: CDS purchase callback reliability patterns
date: 2026-04-15
category: best-practices
module: app/paywall-purchase-flow
problem_type: best_practice
component: payments
severity: high
applies_when:
  - Integrating with CDS/UPP purchase APIs (DirectToPaid, SinglePlanUpgrade)
  - Handling onPurchaseSuccess callbacks with structured data
  - Starting async polling operations that depend on extracted parameters
  - Building modal flows where success/error state must outlive the component
  - Forwarding callback props through container hierarchies
tags:
  - cds
  - purchase-flow
  - direct-to-paid
  - subscription-polling
  - type-safety
  - error-handling
related_components:
  - frontend_stimulus
---

# CDS purchase callback reliability patterns

## Context

PR #2836 review of the Direct-to-Paid (D2P) purchase flow revealed four recurring anti-patterns in how CDS purchase callbacks are handled. These patterns cause silent failures after successful payment: users pay money but see no confirmation, no error feedback on timeout, and invalid plan data propagating through polling logic due to unsafe type assertions.

The D2P flow allows users to purchase a plan from the homepage without creating an app first (bypassing the normal freemium entitlement flow). The review found that callback handling reliability was the primary risk, not the CDS integration itself (which correctly uses the `DirectToPaid` subType per the [UPP component architecture doc](../best-practices/upp-component-architecture-subtypes-2026-04-14.md)).

## Guidance

### 1. Validate CDS callback data at runtime, not with type assertions

CDS callbacks return structured data (productPackageId, subscriptionId) whose format is owned by the CDS team. Type assertions (`as SubscriptionPlan`) hide format mismatches at compile time.

```typescript
// Bad: unsafe cast, no validation
const planAfterPurchase = productPackageId?.split('.').pop() as SubscriptionPlan | undefined

// Good: validate against known enum values
const candidate = productPackageId?.split('.').pop()
const planAfterPurchase = candidate && Object.values(SubscriptionPlan).includes(candidate as SubscriptionPlan)
  ? (candidate as SubscriptionPlan)
  : undefined

if (!planAfterPurchase) {
  shipAnalyticsLog('purchase.plan-extraction.failed', { productPackageId })
  onError?.(new Error('Could not determine purchased plan'))
  return
}
```

If CDS changes the ID format (e.g., `uuid.professional.monthly` instead of `uuid.professional`), `.pop()` returns the wrong segment. The `as` cast hides this, and the invalid plan propagates to polling, which waits 60s before timing out.

### 2. Propagate polling errors to user-facing callbacks

When a modal closes before polling starts, the `.catch()` handler is the only place to surface errors. Logging without calling `onError` means the user gets no feedback.

```typescript
// Bad: modal closes, catch only logs
handleClose()  // User back on homepage
handlePurchaseSuccess(/* ... */)
  .catch((error) => {
    shipAnalyticsLog('d2p.polling-error', { error: error.message })
    // onError never called, user sees nothing
  })

// Good: propagate to parent error handler
handlePurchaseSuccess(/* ... */)
  .then(({ updated }) => {
    if (!updated) {
      onError?.(new Error('Subscription update timed out'))
    }
  })
  .catch((error) => {
    shipAnalyticsLog('d2p.polling-error', { error: error.message })
    onError?.(error instanceof Error ? error : new Error(String(error)))
  })
```

### 3. Honor callback contracts established by sibling components

When a container accepts `onSuccessClick`, `onError`, or similar props, check how sibling containers use them. If `SinglePlanUpgradeContainer` and `HigherPlansUpgradeContainer` both forward `onSuccessClick` to ComponentLoader, the new `DirectToPaidContainer` should too, or the parent's success handler never fires.

### 4. Guard state-dependent operations

If an async operation depends on an extracted value, check that value before starting.

```typescript
// Bad: polling starts even when planAfterPurchase is undefined
handlePurchaseSuccess(
  undefined,           // planBeforePurchase
  planAfterPurchase,   // might be undefined
  // ...
)

// Good: guard before polling
if (!planAfterPurchase) {
  shipAnalyticsLog('d2p.plan-extraction.failed', { productPackageId })
  onError?.(new Error('Could not determine purchased plan'))
  return
}
handlePurchaseSuccess(undefined, planAfterPurchase, /* ... */)
```

When `planAfterPurchase` is undefined, the polling predicate (`data?.active?.plan === undefined`) never matches, and polling runs the full 60s timeout instead of failing fast.

## Why This Matters

**User impact:** User pays money, modal closes, polling times out silently, user sees homepage with no indication their purchase succeeded or failed. They may attempt to purchase again, potentially creating duplicate subscriptions.

**Debugging impact:** Silent failures require log diving to diagnose. Propagating errors to `onError` gives immediate user-reported symptoms.

**Maintenance impact:** Future developers see `as` casts and assume validation already happened. Missing error propagation means every new failure mode (network issues, API changes) requires re-auditing all callers.

## When to Apply

- Any CDS/UPP `onPurchaseSuccess` callback that parses `purchaseData.items`
- Any `.split()` / `.pop()` followed by `as SomeType` on external data
- Modal flows where the modal closes before an async operation completes
- `.catch()` blocks in purchase/payment flows that only log
- Container hierarchies that forward callback props (`onSuccessClick`, `onError`)

## Examples

### Before: PR #2836 original (DirectToPaidContainer.tsx)

```typescript
const handlePurchaseSuccessCallback = useCallback((purchaseResult: D2PPurchaseResult) => {
  const item = purchaseResult?.purchaseData?.items?.[0]
  const productPackageId = item?.productPackageId
  const planAfterPurchase = productPackageId?.split('.').pop() as SubscriptionPlan | undefined
  //                                                            ^^^ no validation

  handleClose()  // modal closes before polling

  handlePurchaseSuccess(
    undefined, planAfterPurchase, undefined, true, source, productId, subscriptionId, undefined
  ).then(({ updated }) => {
    if (!updated) {
      shipAnalyticsLog('d2p.polling-timeout', { planAfterPurchase })
      // no user feedback
    }
  }).catch((error) => {
    shipAnalyticsLog('d2p.polling-error', { error: error.message })
    // onError never called
  })
}, [/* ... */])
```

**Result:** User pays, modal closes, polling may time out silently with no feedback.

### After: with validation, guards, and error propagation

```typescript
const handlePurchaseSuccessCallback = useCallback((purchaseResult: D2PPurchaseResult) => {
  const item = purchaseResult?.purchaseData?.items?.[0]
  const candidate = item?.productPackageId?.split('.').pop()
  const planAfterPurchase = candidate && Object.values(SubscriptionPlan).includes(candidate as SubscriptionPlan)
    ? (candidate as SubscriptionPlan)
    : undefined

  if (!planAfterPurchase) {
    shipAnalyticsLog('d2p.plan-extraction.failed', { productPackageId: item?.productPackageId })
    onError?.(new Error('Could not determine purchased plan'))
    return
  }

  handleClose()

  handlePurchaseSuccess(
    undefined, planAfterPurchase, undefined, true, source, productId,
    item?.subscriptionId?.toString(), undefined
  ).then(({ updated }) => {
    if (!updated) {
      onError?.(new Error('Subscription update timed out'))
    }
  }).catch((error) => {
    shipAnalyticsLog('d2p.polling-error', { error: error.message })
    onError?.(error instanceof Error ? error : new Error(String(error)))
  })
}, [/* ... */])
```

**Result:** Invalid plan extraction fails fast with user feedback. Polling timeout propagates to error handler.

## Related

- [UPP component architecture: three distinct CDS subTypes](../best-practices/upp-component-architecture-subtypes-2026-04-14.md) - which CDS subType to use for each flow
- [New customer upgrade modal undefined entitlement](../ui-bugs/new-customer-upgrade-modal-undefined-entitlement-2026-04-13.md) - PR #2772's initial D2P attempt (used wrong subType)
- [UPP payment error investigation](../workflow-issues/upp-payment-error-investigation.md) - debugging methodology for purchase errors; `subscription_key_api_error` is a known red herring post-D2P
- [React Query dependent query loading gate](../ui-bugs/react-query-dependent-query-loading-gate-2026-04-08.md) - gate on `isSuccess` not `isLoading` for subscription routing
