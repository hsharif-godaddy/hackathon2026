# Budget service (budget-service)

Spec for API shape, flow, and numbers. Code lives under `budget-service/`; older reference: `budget-service/`.

## Flow

1. **Product** — `POST /api/v1/products` registers `productKey` (required before budgets).
2. **Budget** — `POST /api/v1/budgets` with `productKey` and `items` (`creditsTotal`, `costToCreditRatio`, optional dates / `resetInterval`). `PATCH /budgets/{budgetId}` sends `items[]`: **omit** `budgetItemId` to add a row; **set** `budgetItemId` to update that item. `GET` budget; single-item `GET` / `PATCH .../budget-items/{budgetItemId}` also supported.
3. **Session** — `POST /api/v1/budgets/{budgetId}/sessions` returns the same body shape as `GET /sessions/{sessionId}`. **402** `NO_BUDGET_CAPACITY` when the budget has no items or no consumable credits (same item order and pool math as spend/report). Atomic with the insert so clients can skip a separate budget preflight. A later `PATCH` can still fail if capacity is consumed before that call.
4. **Spend (GoCode)** — `PATCH /api/v1/budgets/{budgetId}/sessions/{sessionId}` with `{ "sessionItems": [ { "cost", "callRequestId" } ] }` (append lines). Only while `reconciled_at` is null. `cost` may be JSON string or number; stored as `NUMERIC(20,6)`.
5. **Inspect** — `GET .../sessions/{sessionId}` → totals, lines, optional `?debug=1` for consumption order + replayed credits per line. **404** when `reconciled_at` is set (session closed).
6. **Close out** — `POST .../sessions/{sessionId}/reports` with `reportItems` (`budgetCost`, `productCost`, `label`). One report per session; allocates credits to budget items using the same USD→credits walk as session lines; sets **`reconciled_at`**. **`GET .../sessions/{sessionId}`** returns **404** after close. `GET .../reports/{reportId}` still works.
7. **DELETE APIs (archive + remove from live tables)** — OLTP tables have **no** `deleted_at`; history lives in `*_history` tables.
   - **`DELETE /api/v1/products/{productKey}`** — copy to `products_history`, `DELETE` product; **409** if any budget references the product.
   - **`DELETE /api/v1/budgets/{budgetId}`** — copy budget/items to `budgets_history` / `budget_item_history`, then `DELETE` budget (cascade removes sessions); **409** if any session has `reconciled_at` null (open session) or any session has a report.
   - **`DELETE .../budget-items/{budgetItemId}`** — copy to `budget_item_history`, `DELETE` item; **409** if referenced in report allocations.
   - **`PATCH` item** (and upsert-by-id) copies the prior row into **`budget_item_history`** before updating the live row.
8. **Webhooks** — `POST /api/v1/webhooks` with `eventType` `report.created`, `productKey`, `url` and returns the same body shape as `GET /webhooks/{webhookId}`. **`DELETE /webhooks/{webhookId}`** copies the row to **`webhooks_history`** then deletes the live webhook. After a successful report, matching URLs get `POST` JSON `{ "eventType": "reportCreated", "productKey", "data" }` (`data` = GET report body). Fire-and-forget; failures are logged only.

### Response parity rule

For each resource with read/write APIs, successful `POST`/`PATCH` responses are formatted identically to the corresponding `GET` response for that resource.

## Numbers

- **Postgres:** `NUMERIC(20,6)` (at most 14 digits left of the point).
- **JSON:** Prefer strings for money fields; several inputs also accept JSON numbers (decoded then normalized).
- **API `costToCreditRatio`:** USD per credit (same meaning as `credit_spend_ratio` in Postgres). Stored as-is after parse/round to `NUMERIC(20,6)`.
- **Credits from USD:** `credits_used = round_6(budget_cost_usd / credit_spend_ratio)` (half away from zero at 6 dp) — `internal/credits.DollarsToCredits`.
- **Budget item consumption order** (session `PATCH` lines and report `budgetCost`): walk `budget_items` in a fixed order — rows with `renew_interval` set first, then by `expire_at ASC NULLS LAST` (soonest expiry first; no `expire_at` last among dated rows), then `created_at`, `id`. For each USD amount, consume from the first item with available credits (`credits_total - credits_used`) using **that row’s** `credit_spend_ratio` only: take `usdChunk = min(remainingUsd, availCredits × credit_spend_ratio)`, then `credits += DollarsToCredits(usdChunk, credit_spend_ratio)`; repeat until USD is covered or return insufficient credits. Appending session lines **replays** all prior lines in `id` order so later PATCHes stay consistent. **`credits_used`** on each item is a cached total maintained by an **AFTER INSERT** trigger on **`budget_item_credit_ledger`** (`credits_used += credits_delta`); the ledger is append-only audit history.

## REST (implemented)

| Method                   | Path                                                            | Notes                                                                               |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET`, `HEAD`            | `/health`                                                       | No auth                                                                             |
| `GET`                    | `/api/v1/auth-check`                                            | Auth probe                                                                          |
| `GET`, `POST`            | `/api/v1/products`                                              | List / register `productKey`                                                        |
| `DELETE`                 | `/api/v1/products/{productKey}`                                 | Archive + delete; 409 if budgets reference product                                  |
| `POST`                   | `/api/v1/webhooks`                                              | Body: `eventType`, `productKey`, `url` → same shape as `GET /webhooks/{webhookId}`  |
| `GET`, `DELETE`          | `/api/v1/webhooks/{webhookId}`                                  | `DELETE` → archive to `webhooks_history`, then 204                                  |
| `POST`                   | `/api/v1/budgets`                                               | Create budget + items; response matches `GET /budgets/{budgetId}`                   |
| `GET`, `PATCH`, `DELETE` | `/api/v1/budgets/{budgetId}`                                    | DELETE archives then removes row; 409 if unreconciled session or any session report |
| `POST`                   | `/api/v1/budgets/{budgetId}/budget-items`                       | Append one item; response matches item `GET`                                        |
| `GET`, `PATCH`, `DELETE` | `/api/v1/budgets/{budgetId}/budget-items/{budgetItemId}`        | `PATCH` response matches item `GET`; DELETE 409 if item in report allocations        |
| `POST`                   | `/api/v1/budgets/{budgetId}/sessions`                           | Optional `metadata`; response matches session `GET`; **402** when no capacity       |
| `GET`, `PATCH`           | `/api/v1/budgets/{budgetId}/sessions/{sessionId}`               | `PATCH` response matches session `GET`; GET 404 if `reconciled_at` set              |
| `POST`, `GET`            | `.../sessions/{sessionId}/reports` and `.../reports/{reportId}` | `POST` response matches report `GET`                                                |

Auth: `packages/go-auth` `AuthenticateAWSIAMService` by default (`Bearer` or `sso-jwt`). `LOCAL_AUTH_DISABLE=true` skips auth (local only).

## Seed (`make data`)

Three single-item budgets, product `seed-local`, fixed UUIDs — see comments in `seed/seed_test_data.sql`.

## Local E2E (script + UI)

See [local-e2e.md](local-e2e.md) for Docker profile `e2e`, `make e2e-local`, and `dev-budget-ui` (including pointing `BUDGET_SERVICE_URL` at a remote deployed API).

## Integration tests

Set `TEST_DATABASE_URL` (same shape as `DATABASE_URL`); tests run golang-migrate automatically. Then:

```bash
go test ./internal/api/... ./internal/credits/...
```

`TestGoCodeSpendMathOverHTTP`: product → budget → session → `PATCH` spend → `POST` report → `GET` report → `GET` session (404). `TestPostSessionReturns402WhenBudgetExhausted`: exhaust budget via report, then `POST` session → **402** `NO_BUDGET_CAPACITY`. `TestReportAllocatesRenewalItemBeforePlainItem` checks report allocation uses renewal-sorted priority. `TestPatchBudgetItemInsertsHistoryRow` asserts `budget_item_history`. `TestDeleteWebhookInsertsWebhooksHistory` asserts `webhooks_history`. Store `TestConsumeBudgetCostUSDRespectsSliceOrder` covers the USD walker; `TestBudgetHasConsumableCapacity` covers the session gate helper.
