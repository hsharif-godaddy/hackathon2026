# Budget service (budget-service)

Spec for API shape, flow, and numbers. Code lives under `budget-service/`; older reference: `budget-service/`.

**OpenAPI 3:** [`internal/openapi/openapi.yaml`](../internal/openapi/openapi.yaml) (source of truth for machine-readable paths and schemas). Served without authentication at **`GET /openapi.yaml`** and interactive docs at **`GET /swagger/`** (redirect from `/swagger`). **`/api/v1/*` still requires JWT** when calling the API from Swagger “Try it out” or any client.

## Flow

1. **Product** — `POST /api/v1/products` registers `productKey` (required before budgets). If the key was previously soft-deleted (`DELETE /products/{productKey}`) and no active budgets reference it, the same `POST` **revives** the row by clearing `deleted_at` (same primary key; `createdAt` is unchanged).
2. **Budget** — `POST /api/v1/budgets` creates a budget; `items` is optional (omit or `[]` for a shell budget). Each item specifies `creditsTotal`, `costToCreditRatio`, and optional `expiresAt`, `startsAt`, `resetInterval`, `resetsAt`.
3. **Session** — `POST /api/v1/sessions` with body `{ "budgetId", "metadata"? }` returns the same body shape as `GET /api/v1/sessions/{sessionId}`. Before checking capacity, the service lazily applies any due resets for that budget inside the same transaction. **402** `NO_BUDGET_CAPACITY` when the budget has no items or no consumable credits (same item order and pool math as spend/report after reset catch-up). Atomic with the insert so clients can skip a separate budget preflight.
4. **Spend (GoCode)** — `PATCH /api/v1/sessions/{sessionId}` with `{ "sessionItems": [ { "cost", "callRequestId" } ] }` (append lines). Only while `reconciled_at` is null. `cost` may be JSON string or number; stored as `NUMERIC(20,6)`. Before replaying prior lines and allocating new spend, the service lazily applies any due resets for that budget in the same transaction. Each line’s **virtual** USD→credits walk allocates **as much as the current pool allows**; if `cost` USD cannot be fully covered, the row is still stored and `credits_charged` reflects only the allocated credits (see `?debug=1` for per-line replay vs stored). No ledger spend until the report.
5. **Inspect** — `GET /api/v1/sessions/{sessionId}` → totals, lines, optional `?debug=1` for consumption order + replayed credits per line. **404** when `reconciled_at` is set (session closed).
6. **Close out** — `POST /api/v1/sessions/{sessionId}/reports` with `reportItems` (`budgetCost`, `productCost`, `label`). One report per session; before allocation, the service lazily applies any due resets for that budget in the same transaction. It then allocates credits to budget items using the same USD→credits walk as session lines, but **requires full coverage** of each line’s `budgetCost`: **400** `INSUFFICIENT_CREDITS` if any line’s `budgetCost` cannot be allocated. On success it sets **`reconciled_at`**. **`GET /api/v1/sessions/{sessionId}`** returns **404** after close. `GET /api/v1/sessions/{sessionId}/reports/{reportId}` still works.

### Overages (reconciling budget vs product cost)

If usage exceeds what the budget can absorb as **budget** spend, callers should not put the uncovered USD entirely in `budgetCost`. Allocate up to the pool in `budgetCost`, put the remainder in **`productCost`**, typically on a line with **`label`: `"overages"`**. The error body for `INSUFFICIENT_CREDITS` describes this split. The service does not auto-split report lines.

7. **DELETE APIs (soft-delete)** — `budgets`, `budget_items`, `products`, and `webhooks` use **`deleted_at`**; rows stay in place so FKs (sessions, reports, allocations) remain valid. **`GET`** budget/report responses can include **`deletedAt`** on the budget and items when set. Mutations require an **active** budget/product (no `deleted_at`).

- **`DELETE /api/v1/products/{productKey}`** — sets `products.deleted_at`; **409** if any **active** budget (`deleted_at` null) references the product.
- **`DELETE /api/v1/budgets/{budgetId}`** — sets `deleted_at` on the budget and all its items; **409** if any session has `reconciled_at` null (open session). Reports and sessions remain readable.
- **`DELETE .../budget-items/{budgetItemId}`** — sets `budget_items.deleted_at`; **409** if any open session exists for the budget. Report lines still reference the item id.
- **`PATCH` item** (and upsert-by-id) copies the prior row into **`budget_items_history`** before updating the live row (update audit only; no history row on soft-delete).

8. **Webhooks** — `POST /api/v1/webhooks` with `eventType`, `productKey`, `url` and returns the same body shape as `GET /webhooks/{webhookId}`. Supported event types: `report.created`, `budget-item.reset`, `budget-item.expired`, `budget-item.exhausted`. Unsupported values return **400**. **`DELETE /webhooks/{webhookId}`** sets **`webhooks.deleted_at`**. Webhooks are delivered via a transactional outbox pattern with automatic retries (configurable via `OUTBOX_MAX_ATTEMPTS`, default 7). See [`webhooks.md`](webhooks.md) for payload details and retry schedule.

### Response parity rule

For each resource with read/write APIs, successful `POST`/`PATCH` responses are formatted identically to the corresponding `GET` response for that resource.

## Numbers

- **Postgres:** `NUMERIC(20,6)` (at most 14 digits left of the point).
- **JSON:** Prefer strings for money fields; several inputs also accept JSON numbers (decoded then normalized).
- **API `costToCreditRatio`:** USD per credit (same meaning as `cost_credit_ratio` in Postgres). Stored as-is after parse/round to `NUMERIC(20,6)`.
- **Hybrid resets:** renewable items use both a periodic background worker and lazy transactional catch-up. A Go background worker (configurable via `WORKER_INTERVAL`, default 1 minute) processes due rows, delivers `budget-item.reset` webhooks, and checks for expired items. The write paths call the SQL function `process_due_budget_item_resets` for the target budget before capacity or allocation work. For due items with positive usage, the reset writes a `periodic_reset` ledger row with a negative `credits_delta`; for due items already at zero usage, it only advances `resets_at`.
- **Credits from USD:** `credits_used = round_6(budget_cost_usd / cost_credit_ratio)` (half away from zero at 6 dp) — `internal/credits.DollarsToCredits`.
- **Budget item consumption order** (session `PATCH` lines and report `budgetCost`): walk `budget_items` in a fixed order — rows with `reset_interval` set first, then by `expires_at ASC NULLS LAST` (soonest expiry first; no `expires_at` last among dated rows), then `created_at`, `id`. For each USD amount, consume from the first item with available credits (`credits_total - credits_used`) using **that row’s** `cost_credit_ratio` only: take `usdChunk = min(remainingUsd, availCredits × cost_credit_ratio)`, then `credits += DollarsToCredits(usdChunk, cost_credit_ratio)`; repeat until USD is covered. **Session `PATCH`** stops when the pool is exhausted (partial `credits_charged`); **report `budgetCost`** requires full coverage or **`INSUFFICIENT_CREDITS`**. Appending session lines **replays** all prior lines in `id` order so later PATCHes stay consistent. **`credits_used`** on each item is a cached total maintained by an **AFTER INSERT** trigger on **`budget_item_credit_ledger`** (`credits_used += credits_delta`); the ledger is append-only audit history (updated on successful report, not on PATCH).

## REST (implemented)

| Method                   | Path                                                             | Notes                                                                                                          |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET`, `HEAD`            | `/health`                                                        | No auth                                                                                                        |
| `GET`                    | `/api/v1/auth-check`                                             | Auth probe                                                                                                     |
| `GET`, `POST`            | `/api/v1/products`                                               | List / register `productKey` (or revive after soft-delete; **409** if key is already active)                   |
| `DELETE`                 | `/api/v1/products/{productKey}`                                  | Soft-delete; 409 if active budgets reference product                                                           |
| `POST`                   | `/api/v1/webhooks`                                               | Body: `eventType`, `productKey`, `url` → same shape as `GET /webhooks/{webhookId}`                             |
| `GET`, `DELETE`          | `/api/v1/webhooks/{webhookId}`                                   | `GET` body includes `createdAt`, `updatedAt`. `DELETE` → soft-delete (`deleted_at`), then 204                  |
| `POST`                   | `/api/v1/budgets`                                                | Create budget; optional `items` (shell budget if omitted/empty); response matches `GET /budgets/{budgetId}`    |
| `GET`, `PATCH`, `DELETE` | `/api/v1/budgets/{budgetId}`                                     | DELETE soft-deletes budget + items; 409 if unreconciled session                                                |
| `POST`                   | `/api/v1/budgets/{budgetId}/budget-items`                        | Append one item; create-time `startsAt`/`resetsAt` defaults apply; response matches item `GET`                 |
| `GET`, `PATCH`, `DELETE` | `/api/v1/budgets/{budgetId}/budget-items/{budgetItemId}`         | `PATCH` response matches item `GET`; DELETE 409 if unreconciled session                                        |
| `POST`                   | `/api/v1/sessions`                                               | Body: `budgetId`, optional `metadata`; response matches session `GET`; **402** when no capacity                |
| `GET`, `PATCH`           | `/api/v1/sessions/{sessionId}`                                   | `PATCH` append: partial virtual `credits_charged` ok; response matches session `GET`; GET 404 if reconciled    |
| `POST`, `GET`            | `/api/v1/sessions/{sessionId}/reports`, `.../reports/{reportId}` | `POST`: strict `budgetCost`; **400** `INSUFFICIENT_CREDITS` if allocation fails; response matches report `GET` |

Auth: `packages/go-auth` `AuthenticateAWSIAMService` by default (`Bearer` or `sso-jwt`). `LOCAL_AUTH_DISABLE=true` skips auth (local only).

Request decoding: write endpoints use strict JSON decoding (unknown fields are rejected with **400**) and enforce request-size limits (oversized payloads return **413** `PAYLOAD_TOO_LARGE`).

## Seed (`make data`)

Three single-item budgets, product `seed-local`, fixed UUIDs — see comments in `seed/seed_test_data.sql`.

## Local E2E (script + UI)

See [local-e2e.md](local-e2e.md) for Docker profile `e2e`, `make e2e-local`, and `dev-budget-ui` (including pointing `BUDGET_SERVICE_URL` at a remote deployed API).

## Integration tests

Set `TEST_DATABASE_URL` (same shape as `DATABASE_URL`); tests run golang-migrate automatically. Then:

```bash
go test ./internal/api/... ./internal/credits/...
```

`TestGoCodeSpendMathOverHTTP`: product → budget → session → `PATCH` spend → `POST` report → `GET` report → `GET` session (404). `TestPostSessionReturns402WhenBudgetExhausted`: exhaust budget via report, then `POST` session → **402** `NO_BUDGET_CAPACITY`. `TestReportAllocatesRenewalItemBeforePlainItem` checks report allocation uses renewal-sorted priority. `TestPatchBudgetItemInsertsHistoryRow` asserts `budget_items_history`. `TestDeleteWebhookSoftDeletesRow` asserts `webhooks.deleted_at`. Store `TestConsumeBudgetCostUSDRespectsSliceOrder` covers the USD walker; `TestBudgetHasConsumableCapacity` covers the session gate helper.
