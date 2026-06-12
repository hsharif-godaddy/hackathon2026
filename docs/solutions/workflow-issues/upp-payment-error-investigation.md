---
title: Investigating UPP payment errors for Airo Builder
date: 2026-04-07
last_updated: 2026-04-13
category: workflow-issues
module: app
problem_type: workflow_issue
component: payments
severity: high
applies_when:
  - users report checkout/upgrade/payment errors not reproducible in Airo UI
  - error appears inside CDS iframe, not Airo modal chrome
  - error rates spike during high-traffic events
  - support escalations mention empty cart or purchase failures
  - first-time customers see "something went wrong" on pricing page
tags:
  - upp
  - cds
  - kibana
  - payment-debugging
  - external-dependency
  - paywall
  - shopper-id
  - entitlement-id
---

# Investigating UPP payment errors for Airo Builder

## Context

During a university buildathon (350+ students, April 6-7 2026), ~20% of upgrade attempts hit errors: empty carts, "something went wrong" on payments, infinite loading in upgrade modal, post-purchase failures. ~10% resolved by switching from university WiFi to mobile hotspot.

Investigation over April 7-9 2026 revealed **three distinct issues**, not one:

1. **First-time customers with no subscription** seeing "something went wrong" (UPP lacks d2p support)
2. **`subscription_key_api_error`** post-purchase with "Shopper ID is not available" (red herring, not the cart failure cause)
3. **Cart errors for existing F2P users** with valid shopperIds (separate Express Cart issue)

Payment errors surface as Airo bugs to users and support, but checkout is a third-party iframe (CDS/UPP). Without this methodology, debugging dead-ends at "CDS showed an error" with no way to identify root cause or prove it's upstream.

## Guidance

### 1. Trace the Airo-side payment flow in code

- Paywall components: `app/src/app/[market]/develop/components/paywall/`
- Product IDs: `AiroBuilderProduct`, `AiroBuilderCreditsProduct` (defined in `constants.ts`)
- Flow: Upgrade click -> dynamic import `@venture/cds-loader` -> CDS renders checkout -> `onPurchaseSuccess` -> poll `/api/subscriptions` for 60s -> close modal
- Key containers: `UpgradeContainer.tsx` (routes to `DirectToPaidContainer.tsx` or `HigherPlansUpgradeContainer.tsx`), `CreditsUpgradeContainer.tsx`
- Error detection: `cdsLoader.tsx` uses MutationObserver watching for CDS's hardcoded `[data-testid="fallback-container"]`, fires `paywall.cds.internal-fallback.detected` analytics
- `shopperId` comes from `getUserInfo()?.shopperId` (client-side auth state)
- `entitlementId` comes from `subscription?.builderEntitlementId` (subscription query)
- Only `CreditsUpgradeContainer` guards against undefined `entitlementId` (returns null). `SinglePlan` and `HigherPlans` do not guard either prop.

If the error is in the CDS iframe (not Airo UI), Airo code can't fix it. Move to UPP Kibana.

### 2. Check server-side auth first

Before assuming shopperId is undefined on our side, verify via Katana logs. Our server-side auth (`customer-auth.ts:160`, the `if (!shopperId)` guard) rejects JWTs missing shopperId with a 401. If a user reaches the paywall, the server already validated their shopperId exists.

Search Katana logs for `auth.validated` events:
```
index: .ds-logs-gdelastic.katana*
query: event: "auth.validated" AND customerId: "<the-customer-id>"
```

Note: `auth.validated` logs `customerId`, `authType`, `level`, `tokenAge` but does NOT log `shopperId` directly. However, its presence confirms the JWT had a valid shopperId (the middleware would have returned 401 otherwise).

### 3. Open the UPP Kibana dashboard

- Open the "UPP Airo Builder" dashboard in the `usieventho-prod-usw2` Kibana instance
- Dashboard: "UPP Airo Builder"
- Pre-filtered by `customProperty.productId: is one of AiroBuilderProduct, AiroBuilderCreditsProduct`
- Set time range to cover incident window

### 4. Check the funnel table

"Multiplan F2P Purchase Funnel Table" key columns:
- **Cart Error %**: percentage hitting cart errors (20.14% during this incident)
- **Error Modal %**: percentage seeing generic error modal

High Cart Error % with 0% Error Modal means errors happen before CDS renders the error modal.

### 5. Drill into error events

KQL filter to isolate errors:
```
detail.event.data.traffic.eid.keyword : *error* or detail.event.data.traffic.eid.keyword : *failed*
```

Use the **Inspect** panel (hover over chart, click Inspect icon) to get the full data table with exact event names and unique customer counts.

### 6. Query UPP logs via curl (faster than Kibana UI)

Get the session cookie from an authenticated Kibana browser session (`playwright-cli cookie-list --domain=usieventho-prod-usw2.kb.us-west-2.aws.found.io`) then query directly:

```bash
curl -s 'https://usieventho-prod-usw2.kb.us-west-2.aws.found.io:9243/api/console/proxy?path=%2F*%2F_search&method=POST' \
  -H "Cookie: sid=$SID" \
  -H 'Content-Type: application/json' \
  -H 'kbn-xsrf: true' \
  -d '{
    "size": 0,
    "query": {
      "bool": {
        "must": [
          { "match_phrase": { "detail.event.data.traffic.eid.keyword": "upp.subscription_key_api_error.impression" } },
          { "match_phrase": { "detail.event.data.traffic.customProperties.productId": "AiroBuilderProduct" } },
          { "range": { "@timestamp": { "gte": "now-5d" } } }
        ]
      }
    },
    "aggs": {
      "error_messages": {
        "terms": { "field": "detail.event.data.traffic.customProperties.error", "size": 20 }
      }
    }
  }'
```

Similarly for Airo Katana logs (different Kibana instance, use internal search API):
```bash
curl -s "https://airobuilde-prod-usw2.kb.us-west-2.aws.found.io:9243/internal/search/es" \
  -H "Cookie: sid=$AIRO_SID" \
  -H 'Content-Type: application/json' \
  -H 'kbn-xsrf: true' \
  -d '{"params":{"index":".ds-logs-gdelastic.katana*","body":{...}}}'
```

### 7. Identify root cause vs. downstream errors vs. red herrings

Error events form a cascade. But high-count errors are not always the root cause:

- **`subscription_key_api_error`** (7,837 events, 2,555 customers over 5 days): 100% had error "Shopper ID is not available." The UPP team confirmed this is a **red herring**. It fires post-cart (after purchase), not during checkout. It does not cause cart failures.
- **`og_company_info_request_failed`**: UPP confirmed this is non-blocking and should not prevent UPP from operating correctly.
- The actual cart errors (`generic_plan_box_cart_error`, `express_checkout_general_error`) are the real user-facing failures.

### 8. Check for TLA/delegated account filtering

UPP logs have `detail.global.context.isDelegated` field. Some dashboards filter TLA (Three Letter Account) / employee accounts by default. When investigating, check whether your queries exclude delegated sessions.

To break down delegated vs non-delegated:
```json
"aggs": {
  "delegated": {
    "filter": { "term": { "detail.global.context.isDelegated": true } },
    "aggs": { "unique_customers": { "cardinality": { "field": "detail.global.context.customerId.keyword" } } }
  },
  "not_delegated": {
    "filter": { "bool": { "must_not": { "term": { "detail.global.context.isDelegated": true } } } },
    "aggs": { "unique_customers": { "cardinality": { "field": "detail.global.context.customerId.keyword" } } }
  }
}
```

For the April 2026 buildathon incident: 97.7% of errors were non-delegated (real users), 2.3% delegated (TLA). The istla filter did not meaningfully change the numbers.

### 9. Look up shopperIds via Airo Console

UPP logs store `customerId` (UUID) and `account_uid`, not shopperIds or TLAs. To get shopperIds for the cart team:

1. Get top affected customerIds from UPP error aggregations
2. Look up each in `https://console.airo-builder.godaddy.com/?customerId=<id>`
3. Click into an app to see the **SHOPPER ID** field on the app details page
4. Share shopperIds with the #cart team

### 10. Escalate with data

- UPP issues: `#upp-unified-plans-and-pricing` (UPP team)
- Cart issues: `#cart` (cart team) -- they need shopperIds, not customerIds
- Paywall squad: `#airo-ai-builder-squad-paywall`

## Three Distinct Issues Found (April 2026)

### Issue 1: First-time customers (no subscription) -- UPP d2p gap

**Symptom:** Brand new accounts see "something went wrong" when trying to upgrade from the landing page.

**Root cause:** UPP's plan upgrade component only supports f2p (free-to-paid), not d2p (direct-to-paid). Without an existing freemium subscription, there is no `entitlementId` to pass to CDS, and UPP can't render.

**Evidence:**
- The UPP team reproduced: `/api/subscriptions` returns 403 for unregistered customers
- Our BFF handles this gracefully (returns empty subscriptions with 200), but `entitlementId` ends up undefined

**Resolution:** RESOLVED. `DirectToPaidContainer.tsx` now exists and uses the `DirectToPaid` CDS subType with `offerGroupId` (not `planGroupId`). `UpgradeContainer.tsx` routes to it when `!hasSubscriptionWithEntitlement`. The old `SinglePlanUpgradeContainer.tsx` no longer exists. See `docs/solutions/best-practices/upp-component-architecture-subtypes-2026-04-14.md` for UPP component architecture.

### Issue 2: subscription_key_api_error -- red herring

**Symptom:** 7,837 `subscription_key_api_error` events over 5 days, 2,555 unique customers. 100% have error message "Shopper ID is not available."

**Initial hypothesis:** We're passing `shopperId={undefined}` to CDS.

**Why it's a red herring:**
- The UPP team confirmed: `subscription_key_api_error` only fires post-cart, when preparing to show post-upgrade information. It does not cause cart failures.
- UPP confirmed: "The `subscription_key_api_error` is likely a red herring. We were able to see two different errors happening non-deterministically from airo builder landing page where entitlementId/subscriptionId wasn't provided."
- Our server-side auth confirms shopperId IS present in the JWT (middleware rejects missing shopperId with 401). So the "Shopper ID is not available" error is UPP failing to resolve it on their end, not us passing undefined.

**Key learning:** High-volume error events are not always the root cause. Always verify whether an error fires pre-cart or post-cart before assuming it causes checkout failures.

### Issue 3: Cart errors for existing F2P users -- Express Cart issue

**Symptom:** 943 unique customers hit cart errors over 5 days. Error breakdown: 67% generic `Error`, 17% `TypeError`, 10% `badPayloadError`, <1% `authError`.

**Key finding:** These are existing users with active subscriptions and valid shopperIds. Not the same root cause as Issue 1 or 2. Airo never calls Express Cart APIs directly. We embed the CDS/UPP component with props (productId, shopperId, entitlementId, itc) and UPP handles all cart operations internally. Express Cart errors in UPP Kibana are internal to the CDS component.

**Evidence:** Looked up top 5 affected customers in Airo Console -- all have apps, subscriptions, and shopperIds. Plans range from free to starter, most are trial accounts.

**Resolution:** Shared shopperIds with the #cart team for Express Cart investigation. This appears to be an intermittent Express Cart issue, not an Airo-side bug. The cart team had previously seen this pattern and last time it was due to a payments outage.

**April 2026 update:** A new variant surfaced where UPP's add-to-cart returns success + basketId but the basket is actually empty. Escalated through UPP to #ecomm-platform-support. Separately, purchasing 15+ credit packs triggered a 502 from the cart purchase endpoint, fixed by Cart team (deployed 2026-04-20).

**Top affected shopperIds (shared with #cart):**
- `710992304` (132 cart errors, starter plan)
- `707248149` (91 cart errors, starter trial)
- `711495060` (81 cart errors, free trial)
- `710532970` (78 cart errors, starter trial)
- `710989680` (69 cart errors, free trial)

## Why This Matters

The UPP Kibana dashboard is the only way to get actionable data on CDS/checkout errors. It's not discoverable without knowing it exists. Our Airo-side logs only show "CDS rendered its fallback." The actual error detail lives exclusively in UPP's telemetry.

Key organizational knowledge:
- UPP logs are at `usieventho-prod-usw2`, Airo logs are at `airobuilde-prod-usw2` (different Kibana instances, separate auth)
- UPP logs store `customerId` and `account_uid`, not shopperIds or TLAs
- The Airo Console (`console.airo-builder.godaddy.com`) maps customerId to shopperId via app details
- The `isDelegated` field in UPP logs identifies TLA/employee accounts
- Airo Katana logs (`auth.validated` event) confirm shopperId presence in JWT but don't log the actual value

## When to Apply

- Users report checkout/upgrade/payment errors that are not reproducible in Airo UI
- Error appears inside the CDS iframe (not Airo's own modal chrome)
- Error rates spike during high-traffic events
- Support escalations mention "empty cart", "something went wrong" on payments, or purchase button failures
- First-time customers can't upgrade (no existing subscription)
- Airo-side logs (`paywall.cds.*` analytics events) show errors but no root cause detail

## Examples

### Error events and what they mean

| Event | Meaning | Buildathon count | Pre/Post Cart |
|---|---|---|---|
| `og_company_info_request_failed` | OG company info API failed | 303 | Pre-cart (non-blocking per UPP) |
| `subscription_key_api_error` | Subscription key lookup failed | 284 | **Post-cart** (red herring) |
| `generic_plan_box_cart_error` | Cart construction failed | 59 | Pre-cart |
| `express_checkout_general_error` | Express checkout failed | 58 | During cart |
| `f2p_plan_box_cart_error` | Free-to-paid cart error | 57 | Pre-cart |
| `error_modal_content_impression` | User saw generic error modal | 36 | Post-error |
| `plans_container_offers_not_loaded_error` | Offers Graph data never loaded | 30 | Pre-cart |
| `plans_container_plan_failed_to_map_error` | Plan data couldn't map to UI | 30 | Pre-cart |
| `og_api_request_failed` | Generic OG API failure | 29 | Pre-cart |
| `express_checkout_bad_payload_error` | Malformed checkout payload | 14 | During cart |
| `express_checkout_user_deleted_empty_cart_error` | Cart empty after user action | 8 | During cart |

### Airo-side analytics events (for cross-reference)

| Event | Meaning |
|---|---|
| `paywall.cds.import.failed` | `@venture/cds-loader` dynamic import failed (network) |
| `paywall.cds.error` | CDS `onError` callback fired |
| `paywall.cds.internal-fallback.detected` | CDS rendered its own error fallback |
| `paywall.error.displayed` | User saw Airo error modal |
| `airoplus.purchase.polling-timeout` | Purchase succeeded but subscription didn't reflect in 30s |

## Collaboration Timeline

- **April 7:** Initial investigation of UPP logs, identified 20% cart error rate and top error events. Posted findings in `#upp-unified-plans-and-pricing`.
- **April 7-8:** UPP team confirmed `subscription_key_api_error` and `og_company_info_request_failed`, clarified `subscription_key_api_error` is post-cart only.
- **April 8:** #cart support request filed and escalated as priority.
- **April 9:** UPP shipped d2p fix locally (PR in progress). UPP confirmed `subscription_key_api_error` is a red herring. Shared shopperIds with #cart team. Verified via Katana logs that shopperId is present in JWT.

## Related

- UPP Kibana dashboard: "UPP Airo Builder" (`usieventho-prod-usw2` Kibana instance)
- UPP error logs: `usieventho-prod-usw2` Kibana instance
- Airo Customer Metrics dashboard: "Airo Customer Metrics" (`airobuilde-prod-usw2` Kibana instance)
- Airo Console: `https://console.airo-builder.godaddy.com`
- Escalation channel: `#upp-unified-plans-and-pricing`
- Cart issues channel: `#cart`
- Paywall squad: `#airo-ai-builder-squad-paywall`
- Paywall components: `app/src/app/[market]/develop/components/paywall/`
- CDS loader: `app/src/app/[market]/develop/components/paywall/cdsLoader.tsx`
- Product ID constants: `app/src/app/[market]/develop/components/paywall/constants.ts`
- Auth middleware: `app/src/lib/customer-auth.ts`
- Subscriptions route: `app/src/app/api/subscriptions/route.ts`
- Related doc: `docs/solutions/test-failures/usePaywallModal-stale-spy-assertions-2026-03-31.md`
- Related doc: `docs/solutions/developer-experience/gasket-nextjs-local-testing-constraints-2026-03-31.md`
- Related doc: `docs/solutions/best-practices/nextjs16-vendored-react-canary-breaks-cds-upp.md` -- Next.js 16 vendored React canary breaking CDS-loaded UPP checkout (different root cause, same component system)
- Related doc: `docs/solutions/architecture-patterns/cart-billing-term-visibility-owned-by-cds-upp.md` -- cart display issues (hostnames, labels, terms, pricing) are cart-side ownership, not Airo code
