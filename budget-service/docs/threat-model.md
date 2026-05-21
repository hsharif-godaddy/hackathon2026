# Threat Model

Lightweight STRIDE-oriented model for security review. **Scope:** the `budget-service` HTTP API process, its PostgreSQL database, outbound webhook delivery, and dependencies described in code and [README](../README.md).

## System context

budget-service exposes a REST API for budgets, credit pools (budget items), LLM-style spend sessions, reconciliation reports, product registration, and webhook registration. **Authenticated callers** are expected to be backend services using GoDaddy SSO JWTs. **Operators** deploy and observe the service via Katana and Kibana (see [DevOps](devops.md)).

**Actors and dependencies**

- **API clients** — Present `Authorization: Bearer` or `Authorization: sso-jwt` on `/api/v1/*` (unless local auth is disabled).
- **SSO / JWKS** — [gd-auth-lib](https://github.com/gdcorp-identity/gd-auth-lib/tree/main/go/gd_auth_lib) validates JWTs against the configured `SSO_HOST`.
- **PostgreSQL** — Persistent state (budgets, sessions, ledger, webhook outbox, etc.).
- **Webhook receivers** — HTTPS endpoints registered per product; receive POSTs from the service (outbox + worker).
- **Background worker** — Same process; periodic resets, expirations, and outbox draining.

## Assets

| Asset                                          | Notes                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Budget, item, session, report, and ledger rows | Business and usage data; UUID-keyed.                                                                               |
| Session `metadata` (JSON)                      | Caller-supplied; valid JSON only, **256 KiB** max raw bytes; may contain operational or customer-adjacent strings. |
| Money and credit fields                        | `NUMERIC`/JSON string amounts; business-sensitive.                                                                 |
| Webhook URLs                                   | Stored per product; disclosure enables targeted callback traffic.                                                  |
| JWTs in transit                                | Bearer tokens; compromise enables API access within token scope.                                                   |
| `DATABASE_URL` and similar secrets             | Environment/config; full DB access if leaked.                                                                      |
| Application logs                               | Structured JSON; paths/user-agents sanitized; optional `requestBody` logging when enabled.                         |

## Trust boundaries

1. **Network edge → service** — TLS typically terminates at ingress (Katana); service may also use `SERVER_CERT_PATH` / `SERVER_KEY_PATH` for TLS directly.
2. **Client → `/api/v1`** — JWT validation at middleware; no cookie-based auth for API.
3. **Service → PostgreSQL** — Credentials from env; connection pool with timeouts.
4. **Service → SSO** — Token validation (library behavior; keys/caching per [gd-auth-lib](https://github.com/gdcorp-identity/gd-auth-lib/tree/main/go/gd_auth_lib)).
5. **Service → webhook URLs** — Outbound HTTPS POST; production URLs restricted by validation (see [Webhooks](webhooks.md)).

## Authentication vs Authorization

- **Authentication:** `/api/v1/*` requests must carry a valid **AWS IAM, Cert, or Cert2S**-class service JWT unless `LOCAL_AUTH_DISABLE=true` (local only). OpenAPI/Swagger and `/health` are unauthenticated by design.
- **IAM role allowlist:** **`AUTH_ALLOWED_ROLES`** (JSON array of ARN patterns, trailing `*` wildcard) must be non-empty when JWT auth is enabled; otherwise **`config.Load`** fails at startup. The middleware extracts the caller's IAM ARN via `gd-auth-lib.GetAwsIamArn()` and rejects tokens whose ARN does not match any entry (**403 Forbidden**). With **`LOCAL_AUTH_DISABLE=true`**, allowlists are omitted for local open API.
- **Cert CommonName allowlist:** **`AUTH_ALLOWED_CERTS`** (JSON array of CommonName patterns, trailing `*` wildcard) must be non-empty when JWT auth is enabled; otherwise startup fails. The middleware extracts the caller's CommonName via `gd-auth-lib.GetCommonName()` and rejects tokens whose CN does not match any entry (**403 Forbidden**).
- **Authorization:** Handlers do **not** map JWT claims to budget or session rows. Any caller with a **valid token** and an allowed role/cert (per allowlists when JWT auth is enabled) who knows a resource id (`budgetId`, `sessionId`, etc.) can invoke the corresponding API. **Access control is expected from:** the IAM role and cert allowlists, network policies, which services receive credentials, and caller-side enforcement—not from row-level checks inside this service.

Document this assumption explicitly for assessors evaluating IDOR-style risk.

## Request input validation

For security review / ticket responses: **layered body limits** — JSON request bodies are first capped at **1 MiB** (`decodeJSONBody` / `http.MaxBytesReader` in `internal/api/decode.go`), then decoded with **unknown fields rejected**. Path parameters use **UUID parsing** or **identifier regex** (`requireUUIDParam`, `validateIdentifier` / `validateLabel` in `internal/api/validate.go`); identifier and label strings are also bounded to **`maxFieldLen` (256 bytes)** by the same helpers (regex alone does not imply length). **Strict query keys (`rejectUnknownQueryKeys`, `internal/api/query.go`):** **`GET /api/v1/reports`**, **`GET /api/v1/reports/aggregate`**, **`GET /api/v1/webhooks`** (list: `productKey`, `includeDeleted`), **`GET /api/v1/webhooks/{webhookId}`** (`includeDeleted` only), **`GET /api/v1/products`**, **`GET /api/v1/budgets/{budgetId}`**, **`GET /api/v1/budgets/{budgetId}/budget-items/{budgetItemId}`** (products and budget GETs: `includeDeleted` only). Undocumented query keys on these endpoints return **400**. Amounts and ratios go through **`internal/credits`**; dates RFC3339; webhook **`eventType`** is allowlisted and **`url`** is scheme/host validated with **no userinfo** (credentials) allowed (`internal/api/webhook_handlers.go`). **`POST /api/v1/sessions`** `metadata`: the overall body still obeys the **1 MiB** cap; for a non-`null` metadata value the handler enforces a **`maxSessionMetadataBytes` (256 KiB)** size limit, requires **valid JSON** (`json.Valid`), and rejects nesting deeper than **`maxMetadataDepth` (5)** levels (`maxSessionMetadataBytes`/`maxMetadataDepth` in `internal/api/validate.go`). A JSON **`null`** metadata value is treated as omitted (no stored metadata, no separate size check). **`POST`/`PATCH`** requests must declare **`Content-Type: application/json`** or receive **415** (`RequireJSONContentType` middleware in `internal/api/middleware.go`). Decimal amount fields (`flexAmount`) are bounded to **`maxDecimalLen` (64 bytes)** before parsing; date strings to **`maxDateStringLen` (64 bytes)** before `time.Parse`; `resetInterval` to **`maxFieldLen` (256 bytes)** before normalization. SQL uses **parameterized** queries in `internal/store` (dynamic `WHERE` clauses use `$n` placeholders only). The API is **JSON-only** (no HTML rendering in this service).

## STRIDE summary

| Category                   | Threat                                       | Controls (examples)                                                                                                                                                                                                                                                 | Residual risk                                                    |
|----------------------------|----------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| **Spoofing**               | Caller pretends to be a legitimate service   | JWT validation via [gd-auth-lib](https://github.com/gdcorp-identity/gd-auth-lib/tree/main/go/gd_auth_lib); reject missing/invalid tokens; `AUTH_ALLOWED_ROLES` and `AUTH_ALLOWED_CERTS` (required when JWT auth is on) restrict which ARNs/CommonNames are accepted | Stolen token from an allowed identity can call API until revoked |
| **Tampering**              | Alter DB rows or API payloads                | TLS in transit; DB credentials; SQL via parameterized queries in `store`                                                                                                                                                                                            | Compromised DB role or app process                               |
| **Repudiation**            | Deny having performed an action              | Structured logs (`http.request.complete`); ledger append-only audit                                                                                                                                                                                                 | Logs can be disabled or tampered if log pipeline compromised     |
| **Information disclosure** | Leak budgets, sessions, webhook URLs, tokens | TLS; sanitize logging; API handlers use `writeInternalError` (`{"code":"INTERNAL","error":"internal error"}`); JWT middleware uses `writeAuthError` with stable `code` + short `error` (no stack or wrapped driver text in the body); webhook payload rules in docs | Optional request-body logging increases exposure if misused      |
| **Denial of service**      | Exhaust DB, workers, or HTTP threads         | HTTP read/write/idle timeouts; worker batch limits; DB pool limits                                                                                                                                                                                                  | Large payloads or high concurrency from authorized clients       |
| **Elevation of privilege** | Access another tenant's budget               | **No in-app tenant ACL** — valid JWT + knowledge of id suffices                                                                                                                                                                                                     | Mitigate with network segmentation and tight token issuance      |

## Assumptions

- Production ingress and platform policies restrict which networks or services can reach the API.
- Secrets are injected by the runtime (e.g. Katana), not committed to source control.
- Callers do not expose budget/session UUIDs to untrusted parties.

## Related documents

- [Service Architecture](service-architecture.md) — context diagram and request paths.
- [Webhooks](webhooks.md) — outbound security rules.
