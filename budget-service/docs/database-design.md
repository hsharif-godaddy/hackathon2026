# Database Design

Rationale for **why** the schema is shaped this way: domain model, ledger semantics, hybrid resets, soft-delete philosophy, history tables, application-enforced rules, and migration policy. For the **current** table-by-table reference (columns, constraints, triggers, indexes), see [Database Schema](database-schema.md). DDL source of truth: [`migrations/`](../migrations/).

API-facing behavior is summarized in [Budget Service Spec](budget-service-spec.md).

## Domain overview

- A **product** (`product_key`) registers with the service; **budgets** belong to a product (optional FK for migration flexibility).
- A **budget** owns **budget items** (credit pools with terms: totals, USD-per-credit ratio, reset cadence, expiry, etc.).
- A **budget session** is an LLM-style spend window on one budget. **Session items** record GoCode USD lines and derived credits while the session is open.
- Closing a session uses a **session report** (one per session): report lines carry USD costs; the service allocates credits to budget items and **persists finalized credit movement** in the **credit ledger** and **report allocations**.
- Renewable budget items use **hybrid reset handling** (see below).
- **Webhooks** are product-scoped URLs for events (e.g. report created).

Live OLTP tables either use a **`deleted_at`** soft-delete column (`budgets`, `budget_items`, `products`, `webhooks`) or are append-only (e.g. `budget_item_credit_ledger`); `*_history` tables capture pre-update copies for select PATCH paths.

## Numeric and type conventions

- Money and credit amounts use **`NUMERIC(20, 6)`** (at most 14 digits left of the decimal point).
- **Credit spend ratio** (`cost_credit_ratio`): USD **per one credit** (same meaning as API `costToCreditRatio`).
- **Credits from USD** (application layer): `internal/credits.DollarsToCredits` — rounding half away from zero at 6 decimal places.

## Sensitive or business-meaningful data

- **Money and credits:** `NUMERIC(20,6)` columns and API-aligned string amounts — financial / usage sensitive.
- **Session `metadata`:** JSON from clients; treat as potentially sensitive or PII depending on upstream usage.
- **Webhook `url`:** Callback targets; sensitive for abuse if disclosed.
- **Identifiers:** UUIDs for budgets, sessions, reports — knowledge of id enables API access when combined with a valid service JWT (see [Threat Model](threat-model.md)).

Encryption at rest and the network path to PostgreSQL are platform concerns, not configured in application code beyond TLS to the DB URL if used.

## Credit ledger vs `budget_items.credits_used`

| Concern                                    | Mechanism                                                                                                                  |
|--------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| **Audit / why credits moved**              | Rows in `budget_item_credit_ledger` (`entry_kind`, `credits_delta`, optional `report_item_id`, `created_at`).              |
| **Fast read / consumption input**          | `budget_items.credits_used` — maintained **only** by the database trigger (not read-then-write in application code). |
| **Invariant** (when ledger is append-only) | For each `budget_item_id`, `credits_used = SUM(credits_delta)` over all ledger rows for that item.                         |

**Persisted spend today:** the application inserts into `budget_item_credit_ledger` when finalizing a session report (per allocation chunk). Session PATCH lines do **not** by themselves write the ledger; they only record USD/credits on `budget_session_items` until reconciliation.

**Administrative adjustments:** `PATCH` budget item with `creditsUsed` + `creditsUsedReason` (one of `upgrade`, `downgrade`, `reimbursement`) inserts a ledger row whose `credits_delta` is the difference between the new and current `credits_used`. Validation: `creditsUsed` must be non-negative and ≤ `creditsTotal`; `reimbursement` requires a reduction (negative delta). The trigger keeps `credits_used` consistent for any client connection.

## Hybrid reset handling

Due resets are applied in two places to balance latency against background work:

- **Periodic path:** A Go background worker (`internal/worker`) runs on a configurable interval (default 1 minute) and calls `Store.ProcessDueResetsWithOutbox` to sweep due rows in batches, delivering `budget-item.reset` webhooks for items that had credits reset.
- **Lazy path:** budget write paths (`CreateBudgetSession`, `AppendSessionItems`, `CreateSessionReport`) call the SQL function `process_due_budget_item_resets` in-transaction for the target budget before checking capacity or consuming credits — so a session opened seconds after a reset boundary sees the reset, even if the worker hasn't run yet.

For a due item with `credits_used > 0`, the processor inserts a `periodic_reset` ledger row with `credits_delta = -credits_used`, which brings the cached usage back to zero through the trigger. For a due item already at zero usage, the processor advances `resets_at` without inserting a ledger row.

## Soft-delete (`deleted_at`)

`budgets`, `budget_items`, `products`, and `webhooks` use nullable **`deleted_at`** rather than row deletion. Rows are retained so foreign keys to sessions, reports, allocations, and product keys stay valid — historical reports must remain readable after a budget is "deleted."

## `budget_items_history` (update audit only)

Rows are **inserted by application logic** immediately before an **`UPDATE budget_items`** from PATCH (batch or single-item; prior row copied). There are **no** triggers that write this table when `credits_used` changes from the ledger — credit movement is already audited there. **Soft-delete** of an item or budget does **not** insert here; tombstones use **`deleted_at`** on `budget_items`.

## Application-enforced delete rules (409-style)

These are implemented in the service layer, not as DB constraints:

- **Delete budget:** rejected if any session has `reconciled_at` null (open session).
- **Delete budget item:** rejected if any open session exists for that budget.
- **Delete product:** rejected if any **active** budget (`deleted_at` null) references the product.

## Migration

The server applies pending `.up.sql` files on startup (after a successful DB ping) via [golang-migrate](https://github.com/golang-migrate/migrate), using the same `DATABASE_URL` unless `MIGRATE_DATABASE_URL` is set for a DDL-capable role. Applied versions are recorded in **`schema_migrations`**.

Each `.up.sql` file is **one golang-migrate version**; the PostgreSQL driver applies the file as a single migration step (multiple DDL statements in that file are fine as one script). Do **not** enable golang-migrate's `x-multi-statement` mode for files that contain PL/pgSQL (`$$` bodies): its `;` splitter breaks functions.

Add new files such as `000002_description.up.sql` for schema changes; deploy a new image. Reset processing is introduced by `000004_periodic_resets.up.sql` (SQL function plus optional `pg_cron` scheduling when the extension exists). Migration `000009_remove_pg_cron` removes the scheduled job; local and deployed environments use the Go worker for periodic resets. Local Docker uses stock `postgres:15` (see [`docker-compose.yml`](../docker-compose.yml)).

### Baseline (legacy databases)

If the database already contains the full schema (e.g. created by an older `001_init.sql` / initdb hook) but **`schema_migrations` is missing or empty**, a blind `Up()` will fail with "already exists". After verifying the live schema matches `000001_init.up.sql`, mark version **1** without re-running SQL, for example with the migrate CLI:

`migrate -path ./migrations -database "$DATABASE_URL" force 1`

(or insert the equivalent row into `schema_migrations` per golang-migrate's table format). Use `force` only when the schema truly matches that version.
