---
title: "Unified credit grants: one fetch path for BMS and legacy, adapted at the boundary"
date: 2026-06-11
last_updated: 2026-06-11
category: best-practices
module: app
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "consuming credit/budget data on the frontend regardless of backend source"
  - "wiring WebSocket events to React Query cache with optimistic updates"
  - "deciding between caller-level branching and boundary-level adaptation for two data sources"
tags:
  - react-query
  - websocket
  - credit-grants
  - budget-service
  - adapter
  - optimistic-update
---

# Unified credit grants: one fetch path for BMS and legacy, adapted at the boundary

## Context

The frontend consumes credit data that can originate from two sources: the Budget Service (BMS) or the legacy grants system (mgmt-airo). Callers must not know or care which source is active.

The current model is UNIFIED. Every consumer calls a single `useCreditGrants` hook that hits one BFF route, `GET /api/credits/grants`. That route decides BMS-vs-legacy server-side and, on the BMS path, runs `adaptBudgetToGrants` so the client always receives `CreditGrant[]`. There is no caller-level fork.

Prior state (superseded by PR [#3036](https://github.com/gdcorp-partners/airo-app-builder/pull/3036)): a flag-gated DUAL-PATH design where callers branched on a `budgetServiceEnabled` boolean, calling a now-deleted `useBudgetService` hook for BMS versus a grants hook for legacy, with a separate `/api/credits/status` route. That route and hook no longer exist. The dual-path branch pushed source-selection logic into every consumer; the unified model collapses it into the BFF and an adapter.

## Guidance

### Pattern 1: One fetch path, source decided at the BFF, adapted at the boundary

Consumers call `useCreditGrants({ subscriptionId })` and get `CreditGrant[]`. They do not branch on billing mode. The runtime BMS-vs-legacy distinction lives entirely in the BFF route.

From `ChatPane.tsx`:

```typescript
// Unified grants fetch - works for both BMS and legacy paths
const { data: grants, isFetching: isGrantsFetching } = useCreditGrants({
  subscriptionId: subscription?.id,
});

const hasAvailableCredits = grants !== undefined && getActiveGrant(grants) !== undefined;

// Data loaded gate: prevents false "budget exceeded" during fetches
const dataLoaded = grants !== undefined && !isGrantsFetching;

// Empty array means provisioning, not exceeded
const grantsStillProvisioning = grants !== undefined && grants.length === 0;
const budgetExceeded =
  !isImpersonating && !hasAvailableCredits && !grantsStillProvisioning && (dataLoaded || budgetExceededFlag);
```

The BFF route (`app/src/app/api/credits/grants/route.ts`) resolves the source. When BMS migration is in effect it fetches the budget and adapts it; otherwise it returns legacy grants. Both return the same shape:

```typescript
// BMS path: fetch from budget service and adapt to CreditGrant[] format
const budget = await budgetClient.getBudget(bmsBudgetId);
grants = adaptBudgetToGrants(budget, subscriptionId);
// ... else: legacy path
grants = await mgmtClient.getCreditGrants(subscriptionId, syncSpend);
```

The adapter is shared, not app-local. `app/src/lib/credit-adapter` is a thin wrapper that injects the request-context logger into the pure `@airo/shared/credit-adapter`, so debug-console and any other consumer reuse the same logic.

`useUsage.ts` states the contract directly: "Data source (BMS vs legacy grants) is determined by the BFF based on feature flag and `subscription.bmsBudgetId`. The client always receives `CreditGrant[]` format."

### Pattern 2: WebSocket event -> optimistic cache + invalidate (the durable React Query lesson)

`budget_update` events from the agent patch the React Query cache directly, then fall back to invalidation only on error paths. This is the same optimistic-then-authoritative shape worth keeping.

From `useBudgetUpdate.ts`:

```typescript
// Error path: agent couldn't build full payload, refetch from BFF
if (!isBudgetUpdateSuccess(data)) {
  void queryClient.invalidateQueries({ queryKey: ['credit-grants'] });
  return;
}

// Happy path: full budget items included, adapt and write cache directly (no BFF round-trip)
const grants = adaptBudgetItemsToGrants(data.budgetItems, data.budgetId, subscriptionId);
queryClient.setQueryData<CreditGrant[]>(['credit-grants', subscriptionId, true], grants);
queryClient.setQueryData<CreditGrant[]>(['credit-grants', subscriptionId, false], grants);
```

`setQueryData` = instant gauge update. `invalidateQueries` = authoritative refetch when the WS payload is incomplete. Note the cache write targets BOTH `syncSpend` key variants (`true` and `false`) so consumers on either variant stay consistent.

### Pattern 3: Invalidate every related key on purchase/upgrade

Purchase flows invalidate multiple query keys at once. Invalidating a key with no cached entry is a no-op, so it is always safe to invalidate the full set.

From `useCreditPurchase.ts`:

```typescript
const invalidateQueries = useCallback(() => {
  queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
  queryClient.invalidateQueries({ queryKey: ['credit-grants'] });
}, [queryClient]);
```

With the unified model there is only one credit query key (`['credit-grants', ...]`) to worry about, plus `['subscriptions']`. The old dual-path version also invalidated a separate budget-status key; that key is gone.

### Pattern 4: The client-side billing-mode signal is informational, not a fetch fork

`budgetServiceEnabled` still exists on the client, but it no longer selects which hook to call. It is resolved per app from the agent-token response and the WebSocket connect payload (`useResolvedBillingMode` reading `useBillingModeStore`, populated in `agent-fetch.ts` and `ConnectionManager.ts`). Server-side, the agent-token route sets the JWT claim from the budget-service flag plus the presence of `subscription.bmsBudgetId`.

Two WebSocket hooks gate their side effects on this signal so only one set of grant-sync effects runs:

```typescript
// useBudgetUpdate.ts — runs only in BMS mode
const effectiveEnabled = enabled && budgetServiceEnabled === true;

// useGrantContext.ts — runs only in legacy mode (inverse)
const effectiveEnabled = enabled && budgetServiceEnabled === false;
```

This is a side-effect guard for WebSocket emissions, not a data-fetch branch. The fetch path stays unified through `useCreditGrants`. Use `budgetServiceEnabled` to decide which WS sync effects fire, never to decide which endpoint to read.

## Why This Matters

- A single fetch path means new consumers cannot accidentally read the wrong source or double-fetch. Source selection lives in one BFF route, not scattered across callers.
- Adapting at the boundary (`adaptBudgetToGrants`) keeps `CreditGrant[]` as the only shape the UI knows, so BMS rollout/rollback requires no component changes.
- Optimistic `setQueryData` keeps the gauge under the latency budget; writing both `syncSpend` key variants prevents a stale read from a consumer on the other variant.
- Gating WebSocket side effects on `budgetServiceEnabled` (not the fetch) prevents duplicate `grant_context` emissions while keeping the data path single.

## When to Apply

- You have two backend sources for the same UI concept and want callers source-agnostic: collapse selection into one server route and adapt to a single shape at the boundary, rather than branching in every consumer.
- You are wiring real-time events into React Query: patch optimistically with `setQueryData`, invalidate only when the payload is incomplete, and write all relevant key variants.
- You need a client signal to gate side effects (WS emissions, polling) but not data fetching: keep the fetch unified and use the signal only for the effect guard.

If a true coexistence period with two distinct client fetch shapes is unavoidable, a caller-level branch may be justified short-term, but prefer boundary adaptation so the dual paths never reach consumers.

## Related

- [Zero-credits blocking and optimistic update scope](budget-frontend-state-zero-credits-and-optimistic-scope-2026-04-09.md) -- spec-backed defense of specific design decisions
- [React Query dependent query loading gate](../ui-bugs/react-query-dependent-query-loading-gate-2026-04-08.md) -- loading-state gotcha that the `dataLoaded` gate addresses
- [Feature flag guard replacement](feature-flag-guard-replacement-2026-03-30.md) -- removing dual paths after a migration completes
- PR [#3036](https://github.com/gdcorp-partners/airo-app-builder/pull/3036) -- unification (removed the dual-path `useBudgetService` hook and `/api/credits/status`)
