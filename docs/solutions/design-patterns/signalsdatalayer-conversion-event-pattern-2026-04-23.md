---
title: _signalsDataLayer Conversion Event with Dedup
date: 2026-04-23
category: design-patterns
module: app
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - firing a one-time conversion event to GoDaddy CSP data platform
  - tracking free trial signups or other lifecycle events that must fire exactly once
  - subscription state controls whether the event should fire
last_updated: 2026-05-28
tags:
  - conversion-event
  - signalsdatalayer
  - deduplication
  - subscription-polling
  - csp
  - analytics
  - attributes-api
---

# _signalsDataLayer Conversion Event with Dedup

## Context

GoDaddy's data platform needed conversion signals to attribute free trial signups to marketing funnels. The builder app had no `_signalsDataLayer` usage (existing instrumentation pushes to `_expDataLayer` via `app/src/utils/instrumentation.ts`). A new integration surface was needed with guarantees against duplicate fires across renders, page navigations, and sessions.

Key constraints discovered during implementation:
- `_signalsDataLayer` and `_expDataLayer` are separate pipelines with different schemas. Existing `logClickEvent`/`logImpressionEvent` helpers must not be reused.
- Conversion data lives in the **Attributes API**, not as direct subscription fields. The control plane team surfaces it as a subscription attribute with key `free-plan` and value `{orderId, conversionEventDate}`. The subscriptions endpoint requires `includeAttributes=true` to return attributes.
- The `orderId`/`free-plan` attribute is provisioned asynchronously by mgmt-airo, often *after* the develop page mounts. A one-shot read at mount loses that race and the event only fires on a full reload. **The reliable trigger is bounded polling** that watches for the trial subscription and then the `orderId` to land. (Updated 2026-05-28, PR #4270: the original "stale-cache refresh after 5 min is the reliable trigger" approach was superseded by active polling. See `docs/solutions/design-patterns/tanstack-bounded-polling-for-provisioning-races.md` for the polling pattern and its gotchas.)
- Dual wiring points (e.g., GrantsPopoverContent + useInitialization) cause a race condition: two component instances evaluate guards simultaneously, both fire before the dedup guard is set. (session history)

## Guidance

### Schema shape (`add_generic_conversion`)

Use the [add_generic_conversion SCC interface](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519683741/add_generic_conversion) for client-side browser push. The [Conversion Event](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519971547) page is the event bus schema for server-side push only.

```typescript
{
  schema: 'add_generic_conversion',
  version: 'v1',
  data: {
    area: 'airo-builder',
    product: 'airo-builder-freemium',
    revenue: 'freetrial',
    action: 'signup',
    properties: orderId ? { virtual_order_id: orderId } : {},
  },
}
```

Push to `window._signalsDataLayer` (not `_expDataLayer`). The SCC client handles global context (customer data, timestamps) automatically. `properties` is required (always include it). `virtual_order_id` is optional within `properties`.

### Reading conversion state from the Attributes API

The control plane team surfaces conversion data as a subscription attribute, not as direct fields on the subscription object. The attribute key is `free-plan` with value shape:

```json
{"orderId": "10284378592", "conversionEventDate": null}
```

- `conversionEventDate: null` = unacknowledged (fire the event)
- `conversionEventDate: "2026-04-23T12:00:00Z"` = acknowledged (skip)

To include attributes in the subscription response, pass `includeAttributes=true` to the subscriptions list endpoint. Extract the conversion state with a helper:

```typescript
const FREE_PLAN_ATTRIBUTE_KEY = 'free-plan';

function getFreePlanAttribute(subscription: AiroSubscription): { orderId: string; conversionEventDate: string | null } | null {
  const attr = subscription.attributes?.find(a => a.key === FREE_PLAN_ATTRIBUTE_KEY);
  if (!attr?.value?.orderId) return null;
  return attr.value;
}
```

### Dedup (current shape, updated 2026-05-28)

1. **Module-level `acknowledgedIds` Set** (per browser tab): a `Set<string>` at module scope, checked and added before firing. Survives remounts and navigation within the tab; resets on full page reload. Replaced the earlier per-component `useRef` + optimistic `sessionStorage` pair — a single tab-scoped Set covers both the strict-mode double-fire and the simultaneous-render race without a storage round-trip.
2. **Server-side acknowledge** (authoritative, cross-device): BFF route `POST /api/subscriptions/[id]/acknowledge` updates the `free-plan` attribute's `conversionEventDate` via the Attributes API. Ownership validation (customerId match) before acknowledging. On success, `invalidateQueries(['subscriptions'])`.

The hook is now self-contained (no `subscription` argument) and owns its own bounded polling for the provisioning race (see the cross-linked polling doc). The fire effect is unchanged in spirit:

```typescript
const acknowledgedIds = new Set<string>(); // module scope

export function useConversionEvent(): void {
  const queryClient = useQueryClient();
  // ...bounded gate + attribute polling reads `subscription` and the free-plan attribute...

  useEffect(() => {
    if (!subscriptionId || !orderId) return;
    if (isAcknowledged) return;                 // server conversionEventDate set
    if (acknowledgedIds.has(subscriptionId)) return;

    acknowledgedIds.add(subscriptionId);        // tab-scoped guard, before firing
    fireConversionEvent({ orderId });

    appFetch(`/api/subscriptions/${subscriptionId}/acknowledge`, {
      method: 'POST',
      credentials: 'include',
    }).then((response) => {
      if (response.ok) queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    }).catch(() => { /* acknowledgedIds already set; at-least-once across reloads */ });
  }, [subscriptionId, orderId, isAcknowledged, queryClient]);
}
```

### Single wiring point

Wire `useConversionEvent(subscription)` from exactly one always-mounted component on the develop page. ChatPane was chosen because:
- Always mounted (even when collapsed, only CSS changes)
- Already calls `useSubscription()`
- Not gated behind a switchboard flag

Rejected alternatives:
- `GrantsPopoverContent`: only mounts when popover is open, gated behind `appbuilder-chat-gauge` switchboard flag
- `useInitialization`: 950-line XState machine with no subscription data
- Dual wiring: each component instance gets its own useRef, creating a race window before sessionStorage is set

### Acknowledge endpoint pattern

The acknowledge call finds the `free-plan` attribute on the already-fetched subscription, then updates `conversionEventDate` via `updateAttribute`. It takes the subscription (fetched with `includeAttributes`), not just an id:

```typescript
// mgmt-airo client method
async acknowledgeConversion(subscription: AiroSubscription): Promise<AiroAttribute> {
  const attribute = subscription.attributes?.find(a => a.key === ATTRIBUTE_KEYS.FREE_PLAN);
  if (!attribute) throw new AiroHttpError(404, 'Not Found', 'free-plan attribute not found');
  if (attribute.value?.conversionEventDate) return attribute; // already acknowledged
  return this.updateAttribute(attribute.id, {
    value: { ...attribute.value, conversionEventDate: new Date().toISOString() },
  });
}
```

```typescript
// BFF route: POST /api/subscriptions/[id]/acknowledge  (subscription id is a path param)
const subscription = await client.getSubscription(subscriptionId, { includeAttributes: true });
if (subscription.customerId !== authContext.user.customerId) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
await client.acknowledgeConversion(subscription);
```

Level 1 auth (analytics bookkeeping, not billing). Ownership validation is the access control.

## Why This Matters

Without layered dedup, conversion events fire multiple times per signup:
- React re-renders trigger the effect repeatedly
- Page navigation unmounts/remounts the component, resetting useRef
- Multiple browser tabs fire independently
- Acknowledge network failure leaves the subscription unacknowledged, causing re-fires on next visit

Overcounted conversions inflate marketing attribution metrics and misrepresent funnel effectiveness.

## When to Apply

- One-time lifecycle events (signup, trial start, first purchase) that must fire exactly once to an analytics pipeline
- Events where server-side state (Attributes API `conversionEventDate`) is the authoritative dedup, with client-side guards as defense-in-depth
- Subscription-gated events where the trigger data (`orderId`) arrives asynchronously

Do NOT use for high-frequency events (clicks, impressions, page views) or events that can safely fire multiple times.

## Examples

**Wiring in ChatPane** (the hook is self-contained; it reads the subscription itself):
```typescript
useConversionEvent();
```

**Failure scenario (acknowledge fails):**
```
T=0s: useConversionEvent fires, adds id to acknowledgedIds Set, pushes to _signalsDataLayer
T=1s: POST /api/subscriptions/[id]/acknowledge returns 500
T=2s: acknowledgedIds already has the id, so same-tab re-renders/polls skip
T=...: bounded polling continues for its window but the Set guard prevents a re-fire
T=next full reload: acknowledgedIds resets; if conversionEventDate is still null and
      the server is now reachable, acknowledge succeeds on re-fire. At-least-once accepted.
```

## Related

- [add_generic_conversion SCC interface](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519683741/add_generic_conversion) (correct reference for client-side browser push)
- [Conversion Event bus schema](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519971547) (server-side push only, NOT for `_signalsDataLayer`)
- [Generic Conversion Events (c1)](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519749285)
- `docs/solutions/design-patterns/tanstack-bounded-polling-for-provisioning-races.md` (the bounded-polling pattern that fixed the orderId provisioning race, plus the shared-`dataUpdateCount` and effect-vs-wrapper gotchas)
- `docs/solutions/integration-issues/conversion-event-wrong-schema-2026-05-01.md` (bug doc for the schema mismatch incident)
- `docs/solutions/best-practices/defensive-http-client-design-2026-03-31.md` (Pattern #15: transport confirmation before dedup state)
- `docs/solutions/best-practices/cds-purchase-callback-reliability-patterns-2026-04-15.md` (subscription polling guard patterns)
- `app/src/hooks/useHomepageBounceTracking.ts` (ref-guarded one-time event pattern)
