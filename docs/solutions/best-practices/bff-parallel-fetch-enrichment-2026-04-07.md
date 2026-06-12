---
title: BFF credit grants adapter, fail-closed coercion and graceful degradation
date: 2026-06-11
last_updated: 2026-06-11
category: best-practices
module: app-bff-api
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - Frontend reads credit/grant data through the BFF
  - A secondary signal (feature flag, enrichment source) gates which upstream is used
  - String-encoded numeric values cross into client arithmetic
  - Graceful degradation required when a non-core dependency fails
tags:
  - bff-pattern
  - credit-adapter
  - data-adaptation
  - graceful-degradation
  - fail-closed
  - budget-service
  - grants
---

# BFF credit grants adapter, fail-closed coercion and graceful degradation

## Context

The BFF serves credit data to frontend components (UsageGauge, BudgetExceededBanner, GrantsPopoverContent). The live endpoint is `GET /api/credits/grants` (`app/src/app/api/credits/grants/route.ts`), which always returns a `CreditGrant[]` regardless of the underlying source.

Two upstreams can supply that data:

- **BMS** (`app/src/lib/budget-service/client.ts`): returns a `BudgetResponse` whose items carry decimal strings (`"150.000000"`), no grant `type`, and BMS-specific shape.
- **Legacy grants** (mgmt-airo `getCreditGrants`): already returns `CreditGrant[]`.

The route picks one source based on BMS migration state, then normalizes BMS output into the common `CreditGrant[]` shape via the adapter at `app/src/lib/credit-adapter` (a thin logger-injecting wrapper over the pure `adaptBudgetToGrants` in `packages/shared/src/credit-adapter/index.ts`).

This is **source selection plus pure adaptation**, not a fetch-both-and-join. The previous `/api/credits/status` endpoint joined a budget response against grant metadata in an `enrichBudgetResponse()` helper; that route and helper were deleted (PR #3036) and replaced by this grants-adapter path. The durable lessons below survived that change.

## Guidance

### Source selection, not enrichment join

The route does not fetch BMS and grants concurrently and merge them. It evaluates migration flags, and when BMS is active fetches `budgetClient.getBudget(bmsBudgetId)` and runs it through `adaptBudgetToGrants(budget, subscriptionId)`; otherwise it returns `mgmtClient.getCreditGrants(...)` directly. Both branches converge on `{ success, data: CreditGrant[], source }`. The adapter is a pure transform with no second source, so there is no parallel join to optimize here.

### Soft-fail the gating signal

The feature-flag lookups that decide the source are wrapped so a switchboard outage cannot deny a read-only endpoint:

```typescript
let isBudgetFlagEnabled = false;
let isBmsExistingEnabled = false;
try {
  const [budgetFlag, bmsExistingFlag] = await Promise.all([
    checkSwitchboardFlag('app-builder-budget-service', request),
    checkSwitchboardFlag('app-builder-bms-existing', request),
  ]);
  isBudgetFlagEnabled = budgetFlag;
  isBmsExistingEnabled = bmsExistingFlag;
} catch (error) {
  logger.warn('credits.grants.api.bms-flag-lookup.failed', { subscriptionId, error: ... });
}
```

Both flags default to `false`, so a failed lookup degrades to the legacy grants path rather than throwing. The `Promise.all` here is two flag reads, not a data join.

### Fail-closed numeric coercion

BMS credit fields are decimal strings; the adapter coerces them at the boundary and refuses to emit `NaN`:

```typescript
function toNumber(value: string, logger: AdapterLogger): number {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) {
    logger.error('budget.adapter.invalid_credit_value', { value, message: '...defaulting to 0' })
    return 0
  }
  return n
}
```

Returning `0` (not `null`/`NaN`) is fail-closed: a bad value reads as no credits available rather than poisoning downstream arithmetic. `NaN` would propagate silently and break comparisons like `remaining > 0`. The logger is injected (`AdapterLogger`) so the pure shared module stays host-agnostic while still surfacing the bad value.

### Typed errors map to HTTP status

The route classifies upstream failures so observability and clients can distinguish them:

| Error | Status |
| --- | --- |
| `BudgetServiceAuthError` | 401 |
| `BudgetServiceTimeoutError` | 504 |
| `BudgetServiceUnavailableError` | 503 |
| `BudgetServiceError` | `statusCode || 500` |
| `AiroHttpError` (404) | 404 (no grants) |
| anything else | 500 |

The client (`app/src/lib/budget-service/client.ts`) races token retrieval against a timeout and wraps non-BudgetService failures as `BudgetServiceUnavailableError`, so token/auth problems surface as upstream-unavailable rather than internal-error.

## Why This Matters

**Availability:** Soft-failing the gating flags keeps a read-only credits endpoint serving (via legacy grants) during a switchboard outage.

**Safety:** Fail-closed coercion prevents `NaN` from reaching budget math. See `docs/solutions/logic-errors/nan-bypass-budget-service-fail-closed-2026-04-06.md` for how `!(remaining > 0)` fails open under `NaN`.

**Clarity:** Source-selection plus a single pure adapter keeps one return shape (`CreditGrant[]`) and one set of error boundaries, instead of an enrichment join that has to reconcile two partial responses.

**Reuse:** The pure adapter lives in `@airo/shared/credit-adapter` with an injected logger, so debug-console and the BFF share one transform with no forked logic.

## When to Apply

- A secondary signal (flag, config) selects which upstream serves a request: soft-fail it to a safe default rather than throwing.
- String-encoded numbers cross into client arithmetic: coerce at the boundary and return a fail-closed default on non-finite input, logging the bad value.
- Multiple upstreams must present one shape to the client: normalize each into the common type with a pure adapter rather than branching shapes downstream.
- Upstream failures should be distinguishable by HTTP status (auth vs timeout vs unavailable vs internal).

## Related

- `docs/solutions/best-practices/bff-budget-client-iam-s2s-auth-2026-04-07.md` -- BFF budget client auth and token-timeout wrapping
- `docs/solutions/best-practices/defensive-http-client-design-2026-03-31.md` -- HTTP client resilience patterns
- `docs/solutions/logic-errors/nan-bypass-budget-service-fail-closed-2026-04-06.md` -- fail-closed numeric pattern (directly referenced)
- `docs/solutions/best-practices/cp-contract-alignment-bms-signup-runtime-gating-2026-04-13.md` -- BMS migration gating context; `bmsBudgetItemId` now lives on `AiroCreditGrant` in `app/src/lib/mgmt-airo/types.ts`
