---
title: "NaN bypass in Budget Service fail-closed gate"
date: 2026-04-06
category: logic-errors
module: budget-service
problem_type: logic_error
component: service_object
symptoms:
  - "Prompt execution proceeds despite malformed BMS credit strings"
  - "computeRemaining returns NaN but BudgetExceededError not thrown"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - budget-service
  - fail-closed
  - nan
  - numeric-validation
  - parsefloat
  - javascript
---

# NaN bypass in Budget Service fail-closed gate

> **Re-anchored (2026-06-11).** The agent-side gate this doc describes (`getBudget` -> `computeRemaining` -> `!(remaining > 0)`) no longer exists. `agents/src/server/budget-pre-check.ts` now validates capacity server-side via `createSession` -> BMS 402 `BudgetNoCapacityError`, so the client-side NaN-bypass can't occur on that path. The surviving live analog of this fail-closed principle is the BFF adapter's `toNumber` coercion (fail-closed to 0). The JavaScript NaN-semantics lesson below remains durable and is why `!(value > threshold)` is preferred for any numeric fail-closed gate.

## Problem

Budget Service pre-execution check used `remaining <= 0` to gate prompt execution. When BMS returns malformed credit strings (empty string, non-numeric), `computeRemaining` returns NaN, and `NaN <= 0` evaluates to false in JavaScript, allowing execution to proceed without valid budget verification.

## Symptoms

- Prompt executions bypass budget validation when BMS returns empty or non-numeric strings
- No `BudgetExceededError` thrown despite invalid budget data
- `computeRemaining()` silently returns NaN from `parseFloat("")` or `parseFloat("invalid")`

## What Didn't Work

Original check:

```typescript
const remaining = computeRemaining(budget.creditsTotal, budget.creditsUsed)
if (remaining <= 0) {
  throw BudgetExceededError.fromBudgetCheck(subscriptionId)
}
```

Failed because `NaN <= 0` evaluates to `false` in JavaScript. All comparisons with NaN return false (except `!=` and `!==`), so the gate never throws when budget data is malformed. This violates the fail-closed requirement.

## Solution

Changed comparison to negate the valid condition:

```typescript
// Pre-execution credit check (fail-closed)
// !(remaining > 0) catches NaN from malformed BMS strings (NaN <= 0 is false)
const budget = await budgetClient.getBudget(subscriptionId)
const remaining = computeRemaining(budget.creditsTotal, budget.creditsUsed)
if (!(remaining > 0)) {
  throw BudgetExceededError.fromBudgetCheck(subscriptionId)
}
```

## Why This Works

JavaScript NaN comparison semantics: ALL comparisons with NaN return false except `!=` and `!==`.

| Expression | Result |
|-----------|--------|
| `NaN > 0` | false |
| `NaN <= 0` | false |
| `NaN == NaN` | false |
| `!(NaN > 0)` | true |

`!(remaining > 0)` throws when:
- `remaining` is NaN (invalid/malformed data)
- `remaining` is 0 (exhausted budget)
- `remaining` is negative (overspent budget)

Only allows execution when `remaining > 0` strictly evaluates to true.

## Prevention

1. **Prefer negated positive assertions for fail-closed gates**: use `!(value > threshold)` instead of `value <= threshold` when NaN must be rejected. The negated form is fail-closed by default because any non-numeric input blocks execution.
2. **Test fail-closed gates with NaN inputs**: mock upstream services to return empty/malformed strings and verify the gate throws.
3. **Validate at API boundary**: zod `.string()` validation passes empty strings. For numeric strings, add `.refine(s => !isNaN(parseFloat(s)))` or parse to number at the schema level.

## Related Issues

- `docs/solutions/logic-errors/budget-service-enabled-without-subscription-id-2026-04-02.md` -- sibling fail-safe pattern (missing data vs malformed data)
- `docs/solutions/best-practices/budget-service-client-simplification-patterns-2026-04-03.md` -- documents `computeRemaining` implementation
- PR #2532: feat(budget): pre-execution budget check + session creation
- `docs/solutions/best-practices/bff-parallel-fetch-enrichment-2026-04-07.md` -- applies fail-closed `toNumeric()` pattern in BFF credit status route
- `docs/solutions/architecture-patterns/cost-attribution-sdk-native-over-custom-tracker-2026-04-24.md` -- cost-attribution fail-safe uses same principle: on any error, GoDaddy absorbs 100%
