# Endpoint Data Flow

End-to-end walk through the budget-service REST API in the order callers actually use it. Concrete request and response bodies are shown for each step.

1. [Health and auth probe](#1--health-and-auth-probe)
2. [Register a product](#2--register-a-product)
3. [Register a webhook](#3--register-a-webhook)
4. [Create a budget](#4--create-a-budget)
5. [Open a session](#5--open-a-session)
6. [Append spend lines (GoCode reporting)](#6--append-spend-lines-gocode-reporting)
7. [Close the session with a report](#7--close-the-session-with-a-report)

## Conventions

- **Auth.** All `/api/v1/*` calls require `Authorization: Bearer <jwt>` (IAM or Cert-class GoDaddy SSO JWT). When `LOCAL_AUTH_DISABLE=true` the header is optional. `/health`, `/openapi.yaml`, and `/swagger/` skip auth.
- **Response parity.** Successful `POST` / `PATCH` responses return the same shape as the corresponding `GET` for that resource.
- **Strict decoding.** Write endpoints reject unknown JSON fields with `400 BAD_REQUEST` and oversized payloads with `413 PAYLOAD_TOO_LARGE`.
- **Soft-delete.** `DELETE` on products, budgets, budget items, and webhooks sets `deleted_at`; pass `?includeDeleted=true` on GETs to see them.

## 1 · Health and auth probe

Before driving the flow, confirm the service is reachable and the JWT is accepted.

```http
GET /health
```

```json
{ "status": "ok" }
```

```http
GET /api/v1/auth-check
```

```json
{ "message": "awsiam token accepted", "tokenType": "awsiam", "tokenSource": "header" }
```

Accepts service tokens (`awsiam`, `cert`, `cert2s`) via the `Authorization` header and shopper tokens (`idp`) via either the header or the `auth_idp` cookie. The response reports the resolved `tokenType` and `tokenSource` so callers can confirm which extraction path matched.

## 2 · Register a product

Every budget belongs to a `productKey`. Register it once before creating budgets. If the key was previously soft-deleted and no active budgets reference it, this same call **revives** the row (clears `deleted_at`, keeps the original `createdAt`).

```http
POST /api/v1/products
Content-Type: application/json

{ "productKey": "dev-ui-product" }
```

```json
{
  "productKey": "dev-ui-product",
  "createdAt": "2026-05-20T18:00:00Z",
  "updatedAt": "2026-05-20T18:00:00Z"
}
```

`GET /api/v1/products` lists active products (use `?includeDeleted=true` to include soft-deleted rows). `DELETE /api/v1/products/{productKey}` soft-deletes and returns `409` if any active budget still references it.

## 3 · Register a webhook

Webhooks are scoped to a `productKey`, so registering them right after the product (and before any reports fire) is convenient. Subscribe a URL to lifecycle events; delivery is via a transactional outbox with retries — see [Webhooks](webhooks.md) for payload envelopes and retry schedule.

```http
POST /api/v1/webhooks
Content-Type: application/json

{
  "eventType": "report.created",
  "productKey": "dev-ui-product",
  "url": "https://your-service.gdcorp.tools/webhooks/budget"
}
```

```json
{
  "webhookId": "7d3...",
  "eventType": "report.created",
  "productKey": "dev-ui-product",
  "url": "https://your-service.gdcorp.tools/webhooks/budget",
  "createdAt": "2026-05-20T18:00:30Z",
  "updatedAt": "2026-05-20T18:00:30Z"
}
```

Supported `eventType`: `report.created`, `budget-item.reset`, `budget-item.expired`, `budget-item.exhausted`. Anything else is `400`.

`GET /api/v1/webhooks` lists subscriptions (filter with `?productKey=...`); `GET /api/v1/webhooks/{webhookId}` fetches one; `DELETE /api/v1/webhooks/{webhookId}` soft-deletes.

## 4 · Create a budget

A budget aggregates one or more **budget items** (the per-line credit pools). `items` is optional on create — omit or pass `[]` for a shell budget you'll fill in later with `POST .../budget-items`.

Per item: `creditsTotal` is required; `costToCreditRatio` defaults to `1` on input (stored as `1.000000`; USD per credit); `expiresAt`, `startsAt`, `resetsAt` are RFC3339; `resetInterval` is a string like `30d`, `1mo`, `1y` (renews `creditsUsed` to zero on cadence); `label` is a free-form tag.

```http
POST /api/v1/budgets
Content-Type: application/json

{
  "productKey": "dev-ui-product",
  "items": [
    {
      "creditsTotal": "100.000000",
      "costToCreditRatio": "0.1",
      "resetInterval": "30d",
      "label": "renewal-line"
    },
    {
      "creditsTotal": "50.000000",
      "costToCreditRatio": "0.066666",
      "expiresAt": "2027-12-31T23:59:59Z",
      "label": "expiring-line"
    }
  ]
}
```

Response is the same shape as `GET /api/v1/budgets/{budgetId}`:

```json
{
  "budgetId": "f0b5...",
  "productKey": "dev-ui-product",
  "creditsTotal": "150.000000",
  "creditsPending": "0.000000",
  "creditsUsed": "0.000000",
  "createdAt": "2026-05-20T18:01:00Z",
  "updatedAt": "2026-05-20T18:01:00Z",
  "items": [
    {
      "budgetItemId": "a1...",
      "creditsTotal": "100.000000",
      "creditsUsed": "0.000000",
      "costToCreditRatio": "0.100000",
      "resetInterval": "30d",
      "resetsAt": "2026-06-19T18:01:00Z",
      "label": "renewal-line",
      "createdAt": "2026-05-20T18:01:00Z",
      "updatedAt": "2026-05-20T18:01:00Z"
    },
    {
      "budgetItemId": "b2...",
      "creditsTotal": "50.000000",
      "creditsUsed": "0.000000",
      "costToCreditRatio": "0.066666",
      "expiresAt": "2027-12-31T23:59:59Z",
      "label": "expiring-line",
      "createdAt": "2026-05-20T18:01:00Z",
      "updatedAt": "2026-05-20T18:01:00Z"
    }
  ]
}
```

The header totals (`creditsTotal`, `creditsUsed`, `creditsPending`) aggregate across `items`.

### Updating a budget

- **`PATCH /api/v1/budgets/{budgetId}`** updates **existing** items only (each entry must include `budgetItemId`). The prior row is copied to `budget_items_history` before the update.
  ```json
  {
    "items": [
      {
        "budgetItemId": "a1...",
        "creditsTotal": "200.000000",
        "costToCreditRatio": "0.066666",
        "label": "after-patch"
      }
    ]
  }
  ```
- **`POST /api/v1/budgets/{budgetId}/budget-items`** appends a new item; body is a single `BudgetItemInput`. Response is the new `BudgetItem` with `budgetId` echoed.
- **`PATCH .../budget-items/{budgetItemId}`** updates a single item. To shift `creditsUsed` directly, send both `creditsUsed` (new absolute value) and `creditsUsedReason` (`upgrade` | `downgrade` | `reimbursement`); the service writes a ledger row with the delta.
- **`GET .../budget-items/{budgetItemId}`** returns the same `BudgetItem` shape.
- **`DELETE`** on a budget or item soft-deletes; `409` if any open session (no `reconciled_at`) still references the budget.

## 5 · Open a session

A session is a unit of work (typically one LLM run) bound to a budget. The service applies any due resets, then verifies the budget has consumable credits before inserting the row — so clients can skip a manual preflight.

```http
POST /api/v1/sessions
Content-Type: application/json

{
  "budgetId": "f0b5...",
  "metadata": { "userId": "abc", "agent": "claude-opus" }
}
```

`metadata` is optional opaque JSON (queryable in Postgres). Response matches `GET /api/v1/sessions/{sessionId}`:

```json
{
  "sessionId": "9c1...",
  "budgetId": "f0b5...",
  "costTotal": "0.000000",
  "metadata": { "userId": "abc", "agent": "claude-opus" },
  "reconciledAt": null,
  "sessionItems": [],
  "createdAt": "2026-05-20T18:05:00Z",
  "updatedAt": "2026-05-20T18:05:00Z"
}
```

**Error cases:**
- `402 NO_BUDGET_CAPACITY` — the budget has no items, or all items are exhausted/expired/not-yet-started.
- Pass `"allowOverage": true` to bypass the exhaustion gate (a budget with **zero** items still rejects). Pair this with `allowOverage` on the closing report so uncovered USD is recorded as `productCost` instead of failing reconciliation.

## 6 · Append spend lines (GoCode reporting)

While the session is open (`reconciled_at` null), append one or more `sessionItems` whenever GoCode reports a turn. `cost` is full USD spent on that call.

```http
PATCH /api/v1/sessions/{sessionId}
Content-Type: application/json

{
  "sessionItems": [
    { "cost": "2.000000", "callRequestId": "gocode-req-001" }
  ]
}
```

Each PATCH replays all prior lines in id order against a virtual pool, then allocates the new lines using the **consumption order** in [Budget Service Spec § Numbers](budget-service-spec.md#numbers): renewable items first, then by `expiresAt ASC NULLS LAST`, then `createdAt`, then `id`. Allocation may be **partial** — if `cost` exceeds remaining credits, the row is still stored and `credits_charged` reflects only what the pool covered.

No ledger spend is written here; that happens at report time.

The response is the updated session (same shape as `GET`). With `?debug=1`, an extra `debug` block shows per-line consumption (stored vs replayed credits and which item received what).

```http
GET /api/v1/sessions/{sessionId}?debug=1
```

`GET` returns `404` once the session is reconciled — use `GET .../reports/{reportId}` after close.

## 7 · Close the session with a report

A report reconciles the session. Each `reportItems` line splits a unit of work into:
- **`budgetCost`** — USD allocated against budget credits (using the same walk as session spend).
- **`productCost`** — USD the product absorbs (e.g. overages).
- **`label`** — free-form tag (used for cost aggregation and roll-ups).

```http
POST /api/v1/sessions/{sessionId}/reports
Content-Type: application/json

{
  "allowOverage": false,
  "reportItems": [
    {
      "budgetCost": "2.000000",
      "productCost": "1.000000",
      "label": "AI generation"
    }
  ]
}
```

Allocation is **strict** by default: if any line's `budgetCost` exceeds remaining allocatable credits, the call fails with `400 INSUFFICIENT_CREDITS`. To handle this manually, drop `budgetCost` to what fits and move the remainder to `productCost` (typically a separate line with `label: "overages"`).

**Auto-overage:** set `"allowOverage": true` and the service splits for you — each line's stored `budgetCost` reflects only what was allocated, and the unallocated remainder is appended as an extra item with `budgetCost: "0"`, `productCost: <remainder>`, `label: "allowed-overage"`. The label `"allowed-overage"` is reserved (callers can't use it).

On success, the service writes ledger rows, sets `reconciled_at` on the session, enqueues a `report.created` webhook, and returns the report:

```json
{
  "reportId": "4ee...",
  "sessionId": "9c1...",
  "budgetId": "f0b5...",
  "productKey": "dev-ui-product",
  "budgetCostTotal": "2.000000",
  "productCostTotal": "1.000000",
  "creditsAvailable": "130.000000",
  "createdAt": "2026-05-20T18:10:00Z",
  "sessionCallRequestIds": ["gocode-req-001"],
  "reportItems": [
    {
      "reportItemId": "5af...",
      "budgetCost": "2.000000",
      "productCost": "1.000000",
      "label": "AI generation",
      "createdAt": "2026-05-20T18:10:00Z",
      "budgetItems": [
        { "budgetItemId": "a1...", "creditsUsed": "20.000000" }
      ]
    }
  ]
}
```

The `creditsUsed` inside `reportItems[].budgetItems[]` is **credits allocated to this report line from that budget item** — not the item's running total (the running total lives on the budget item itself, maintained by the ledger trigger). `sessionCallRequestIds` lists every `callRequestId` from the session's PATCH lines (in `budget_session_items` id order) so consumers can cross-reference GoCode call records.

After close, `GET /api/v1/sessions/{sessionId}` returns `404`. To re-fetch the report:

```http
GET /api/v1/sessions/{sessionId}/reports/{reportId}
```

Returns the same body shape as the `POST` response.

## Listing and aggregating reports

- **`GET /api/v1/reports`** — paginated list of report **summaries** (`reportId`, `sessionId`, `budgetId`, `productKey`, `createdAt`). Filter with `productKey`, `budgetId`, `sessionId`; paginate with `limit` (default 50, max 500) and `offset`; sort with `order=asc|desc` (default `desc` on `createdAt`). Response includes `total` and `hasMore`. Fetch full bodies via `GET .../sessions/{sessionId}/reports/{reportId}`.
- **`GET /api/v1/reports/aggregate`** — sums `budgetCost` and `productCost` across report items in a window. At least one of `productKey` or `label` is required; optional `budgetId`, `sessionId`, `from`, `to` (RFC3339, half-open `[from, to)`; default window is the last calendar month).

## Related documents

- [Budget Service Spec](budget-service-spec.md) — flow rules, numeric semantics, overage details, consumption order.
- [OpenAPI Spec](../internal/openapi/openapi.yaml) — full schemas, error codes, every parameter.
- [Webhooks](webhooks.md) — event payload envelopes, retry schedule, URL rules.
- [Service Architecture](service-architecture.md) — endpoint-to-table map, request lifecycle, lazy resets.
- [Database Schema](database-schema.md) — tables, columns, indexes referenced above.
- [Local E2E](local-e2e.md) — running the dev UI, scripted flow, webhook sink.
