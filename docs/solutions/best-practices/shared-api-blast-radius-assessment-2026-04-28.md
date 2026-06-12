---
title: Assess blast radius when changing shared APIs
date: 2026-04-28
category: best-practices
module: app-bff
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - modifying routes or hooks with multiple consumers
  - adding parameters to shared utilities
  - changing data fetching in shared code
tags:
  - api-design
  - blast-radius
  - route-conventions
  - shared-code
  - type-safety
  - reviewer-feedback
---

# Assess blast radius when changing shared APIs

## Context

During PR 3113 (generic conversion event for free trial signup), we added `includeAttributes: true` to the shared `/api/subscriptions` route. This was a one-line change that got the feature working, but it silently added unnecessary payload to every subscription fetch for 25+ consumers (paywall checks, feedback forms, cache refreshes). A reviewer caught this along with 7 other issues. The fast-follow PR 3245 addressed all feedback.

The core mistake: optimizing for shipping speed over blast radius analysis. (auto memory [claude])

## Guidance

### Inventory consumers before changing shared code

```bash
# Before modifying a shared route or hook, count who uses it
grep -rn "api/subscriptions" app/src/ --include="*.ts" --include="*.tsx" | wc -l
```

If the count is high, default to opt-in rather than changing the default for everyone.

### Opt-in over unconditional expansion

```typescript
// Bad: every consumer now fetches attributes
const subscriptions = await client.getSubscriptions(product, { includeAttributes: true });

// Good: only the consumer that needs it opts in
// In the [id] route:
const includeAttributes = request.nextUrl.searchParams.get('include') === 'attributes';
const subscription = await client.getSubscription(id, { includeAttributes });

// In the hook that needs attributes:
const { data } = useQuery({
  queryKey: ['subscriptions', id, 'attributes'],
  queryFn: () => fetch(`/api/subscriptions/${id}?include=attributes`),
});
```

### Follow existing route conventions

Check the dominant pattern before creating new routes:

```
# This repo uses resource/[id]/action (40+ routes)
apps/[id]/deploy, sites/[id]/domains, entitlements/[subscriptionId]/update

# Not resource/action with id in body
subscriptions/acknowledge { subscriptionId: "..." }  # wrong
subscriptions/[id]/acknowledge                        # right
```

### Runtime type guards over unsafe casts

```typescript
// Bad: silent failure if API returns unexpected shape
const value = attr.value as FreePlanAttributeValue;

// Good: runtime validation before narrowing
function isFreePlanAttributeValue(v: Record<string, unknown>): v is FreePlanAttributeValue {
  return typeof v.orderId === 'string' && v.orderId.length > 0;
}
if (!isFreePlanAttributeValue(attr.value)) return null;
```

## Why This Matters

A one-line shortcut to a shared route burdened 25+ consumers with unnecessary data on every fetch. The fix required restructuring the hook to make its own targeted fetch with a dedicated React Query key, adding query param support to the `[id]` route, and reverting the shared route. What should have been built correctly the first time became a multi-file fast-follow.

Pattern consistency also matters at scale. Breaking the `[id]/action` convention used by 40+ routes makes the codebase harder to navigate. Reviewers catch this, but catching it post-merge costs more than getting it right.

## When to Apply

- Modifying routes, hooks, or utilities with multiple consumers (check references first)
- Adding data to shared API responses (prefer opt-in flags or separate endpoints)
- Creating new API routes (check existing conventions in the same resource directory)
- Consuming external API data in TypeScript (use runtime guards, not `as` casts)

Skip detailed assessment for single-consumer code, new code with no existing consumers, or internal implementation changes behind stable interfaces.

## Examples

**Blast radius on shared subscription route** (session history)

The original approach added attributes to every subscription fetch. The fast-follow:
1. Reverted the shared route to its original behavior
2. Added `?include=attributes` opt-in on the `[id]` route
3. Had `useConversionEvent` make its own targeted fetch with a dedicated query key `['subscriptions', id, 'attributes']`
4. Only the conversion hook pays the cost of fetching attributes

**Route convention alignment**

The original `/api/subscriptions/acknowledge` with `subscriptionId` in the POST body was modeled after `subscriptions/renew` (the closest sibling route). But `renew` is itself an outlier. The dominant repo pattern (`apps/[id]/deploy`, `sites/[id]/domains`, etc.) uses `[id]` in the path. The fast-follow moved to `[id]/acknowledge` and eliminated body parsing entirely.

## Related

- [Conversion event pattern](../design-patterns/signalsdatalayer-conversion-event-pattern-2026-04-23.md): the original feature this fast-follow addresses
- [Propagating optional type changes](propagating-optional-type-changes-2026-04-22.md): related blast radius lesson for shared types
- [BFF budget client stale field names](../integration-issues/bff-budget-client-stale-field-names-2026-04-07.md): API contract drift patterns
