# Endpoint and data flow

How HTTP requests move through **logging**, **auth**, **handlers**, and the **store** to PostgreSQL. Behavioral detail and numeric rules remain in [budget-service-spec.md](budget-service-spec.md).

## Typical authenticated `/api/v1` request

The router applies **logging** around the entire mux (`internal/api/middleware.go`); `/api/v1` routes use **JWT middleware** then the handler (`internal/api/routes.go`).

```mermaid
sequenceDiagram
  participant Client
  participant Logging as LoggingMiddleware
  participant Mux as mux_Router
  participant Auth as AuthenticateAWSIAMService
  participant Handler as API_handler
  participant Store as store_Package
  participant DB as PostgreSQL

  Client->>Logging: HTTP_request
  Logging->>Mux: next
  Mux->>Auth: /api/v1_only
  Auth->>Handler: JWT_ok
  Handler->>Store: typed_methods
  Store->>DB: SQL
  DB-->>Store: rows
  Store-->>Handler: models
  Handler-->>Client: JSON_response
  Note over Logging: After response, slog emits http.request.complete on stdout
```

Unauthenticated paths (`/health`, `/openapi.yaml`, `/swagger/`) skip `AuthenticateAWSIAMService` but still pass through **Logging**. Access logs are **structured JSON on stdout**, not an extra HTTP response to the client.

## Write path with lazy resets and reporting

Session spend (`PATCH` session), report creation, and reset processing call into the store, which may invoke **`process_due_budget_item_resets`** **in the same transaction** before capacity checks or allocation—see spec. Those code paths may enqueue **`webhook_outbox`** rows (e.g. `report.created`, `budget-item.exhausted`, `budget-item.reset`, `budget-item.expired`). Successful report finalization writes **ledger** rows and usually **`report.created`** outbox events.

```mermaid
flowchart TD
  req[PATCH_or_POST_session_or_report]
  tx[DB_transaction]
  resets[process_due_budget_item_resets]
  logic[Business_rules_spend_or_allocate]
  persist[Persist_rows_ledger_allocations]
  outbox[Insert_webhook_outbox_optional]

  req --> tx
  tx --> resets
  resets --> logic
  logic --> persist
  persist --> outbox
```

## Webhook delivery (async)

Store methods running inside HTTP handlers or **reset/expiration** processing insert into **`webhook_outbox`** in the same transaction as the business write when an event applies. The **background worker** (`internal/worker`) drains the outbox and delivers by calling `Server.DeliverEventWebhooks`, which POSTs JSON to each registered URL. When JWT auth is enabled, outbound requests set **`Authorization: sso-jwt`** with a generated service token (no outbound auth header when `LOCAL_AUTH_DISABLE=true`). Retries and payload shape: [webhooks.md](webhooks.md).

```mermaid
sequenceDiagram
  participant Producer as Store_TX_handler_or_reset_job
  participant DB as PostgreSQL
  participant Worker as BackgroundWorker
  participant Target as Webhook_URL

  Producer->>DB: INSERT_webhook_outbox_in_tx
  Worker->>DB: drain_pending_batch
  Worker->>Target: HTTPS_POST_json_optional_sso_jwt
  Target-->>Worker: HTTP_status
  Worker->>DB: UPDATE_outbox_status
```

## Endpoint to persistence (summary)

| Area | Methods / path pattern | Primary persistence |
| ---- | ------------------------ | ------------------- |
| Health | `GET/HEAD /health` | Optional DB ping for status |
| OpenAPI | `GET /openapi.yaml`, `/swagger/*` | None (static / redirect) |
| Auth probe | `GET /api/v1/auth-check` | None |
| Products | `GET/POST /api/v1/products`, `DELETE .../products/{productKey}` | `products` |
| Webhooks | `GET/POST /api/v1/webhooks`, `GET/DELETE .../webhooks/{webhookId}` | `webhooks` |
| Budgets | `POST /api/v1/budgets`, `GET/PATCH/DELETE .../budgets/{budgetId}` | `budgets`, `budget_items` |
| Budget items | `POST .../budget-items`, `GET/PATCH/DELETE .../budget-items/{budgetItemId}` | `budget_items`, `budget_items_history` on some updates |
| Sessions | `POST /api/v1/sessions`, `GET/PATCH .../sessions/{sessionId}` | `budget_sessions`, `budget_session_items`; may enqueue `webhook_outbox` (e.g. `budget-item.exhausted`) |
| Reports | `POST/GET .../sessions/{sessionId}/reports[...]`, `GET /api/v1/reports` | `budget_session_reports`, `budget_session_report_items`, allocations, `budget_item_credit_ledger`, `webhook_outbox` (list: paged summary rows from list query + count; no per-row report detail load) |

Exact columns and constraints: [database-design.md](database-design.md). Machine-readable paths: [`internal/openapi/openapi.yaml`](../internal/openapi/openapi.yaml).

## Related documents

- [Service architecture](service-architecture.md)
- [Threat model](threat-model.md)
