# budget-service threat model

Lightweight STRIDE-oriented model for security review. **Scope:** the `budget-service` HTTP API process, its PostgreSQL database, outbound webhook delivery, and dependencies described in code and [README](../README.md).

## System context

budget-service exposes a REST API for budgets, credit pools (budget items), LLM-style spend sessions, reconciliation reports, product registration, and webhook registration. **Authenticated callers** are expected to be backend services using GoDaddy SSO JWTs. **Operators** deploy and observe the service via Katana and Kibana (see [devops.md](devops.md)).

**Actors and dependencies**

- **API clients** — Present `Authorization: Bearer` or `Authorization: sso-jwt` on `/api/v1/*` (unless local auth is disabled).
- **SSO / JWKS** — `gd-auth-lib` validates JWTs against the configured `SSO_HOST`.
- **PostgreSQL** — Persistent state (budgets, sessions, ledger, webhook outbox, etc.).
- **Webhook receivers** — HTTPS endpoints registered per product; receive POSTs from the service (outbox + worker).
- **Background worker** — Same process; periodic resets, expirations, and outbox draining.

## Assets

| Asset | Notes |
| ----- | ----- |
| Budget, item, session, report, and ledger rows | Business and usage data; UUID-keyed. |
| Session `metadata` (JSON) | Caller-supplied; may contain operational or customer-adjacent strings. |
| Money and credit fields | `NUMERIC`/JSON string amounts; business-sensitive. |
| Webhook URLs | Stored per product; disclosure enables targeted callback traffic. |
| JWTs in transit | Bearer tokens; compromise enables API access within token scope. |
| `DATABASE_URL` and similar secrets | Environment/config; full DB access if leaked. |
| Application logs | Structured JSON; paths/user-agents sanitized; optional `requestBody` logging when enabled. |

## Trust boundaries

1. **Network edge → service** — TLS typically terminates at ingress (Katana); service may also use `SERVER_CERT_PATH` / `SERVER_KEY_PATH` for TLS directly.
2. **Client → `/api/v1`** — JWT validation at middleware; no cookie-based auth for API.
3. **Service → PostgreSQL** — Credentials from env; connection pool with timeouts.
4. **Service → SSO** — Token validation (library behavior; keys/caching per `gd-auth-lib`).
5. **Service → webhook URLs** — Outbound HTTPS POST; production URLs restricted by validation (see [webhooks.md](webhooks.md)).

## Authentication vs authorization

- **Authentication:** `/api/v1/*` requests must carry a valid **AWS IAM, Cert, or Cert2S**-class service JWT unless `LOCAL_AUTH_DISABLE=true` (local only). OpenAPI/Swagger and `/health` are unauthenticated by design.
- **IAM role allowlist:** When **`AUTH_ALLOWED_ROLES`** is set (JSON array of ARN patterns, supports trailing `*` wildcard), the middleware extracts the caller's IAM ARN via `gd-auth-lib.GetAwsIamArn()` and rejects tokens whose ARN does not match any entry (**403 Forbidden**). When unset, all authenticated IAM tokens are accepted (backward-compatible).
- **Cert CommonName allowlist:** When **`AUTH_ALLOWED_CERTS`** is set (JSON array of CommonName patterns, supports trailing `*` wildcard), the middleware extracts the caller's CommonName via `gd-auth-lib.GetCommonName()` and rejects tokens whose CN does not match any entry (**403 Forbidden**). When unset, all authenticated cert tokens are accepted (backward-compatible).
- **Authorization:** Handlers do **not** map JWT claims to budget or session rows. Any caller with a **valid token** (and an allowed role/cert, if `AUTH_ALLOWED_ROLES` or `AUTH_ALLOWED_CERTS` is configured) who knows a resource id (`budgetId`, `sessionId`, etc.) can invoke the corresponding API. **Access control is expected from:** the IAM role and cert allowlists, network policies, which services receive credentials, and caller-side enforcement—not from row-level checks inside this service.

Document this assumption explicitly for assessors evaluating IDOR-style risk.

## STRIDE summary

| Category | Threat | Controls (examples) | Residual risk |
| -------- | ------ | ------------------- | ------------- |
| **Spoofing** | Caller pretends to be a legitimate service | JWT validation via `gd-auth-lib`; reject missing/invalid tokens; optional allowlists (`AUTH_ALLOWED_ROLES`, `AUTH_ALLOWED_CERTS`) restrict which ARNs/CommonNames are accepted | Stolen token from an allowed identity can call API until revoked |
| **Tampering** | Alter DB rows or API payloads | TLS in transit; DB credentials; SQL via parameterized queries in `store` | Compromised DB role or app process |
| **Repudiation** | Deny having performed an action | Structured logs (`http.request.complete`); ledger append-only audit | Logs can be disabled or tampered if log pipeline compromised |
| **Information disclosure** | Leak budgets, sessions, webhook URLs, tokens | TLS; sanitize logging; webhook payload rules in docs | Optional request-body logging increases exposure if misused |
| **Denial of service** | Exhaust DB, workers, or HTTP threads | HTTP read/write/idle timeouts; worker batch limits; DB pool limits | Large payloads or high concurrency from authorized clients |
| **Elevation of privilege** | Access another tenant’s budget | **No in-app tenant ACL** — valid JWT + knowledge of id suffices | Mitigate with network segmentation and tight token issuance |

## Assumptions

- Production ingress and platform policies restrict which networks or services can reach the API.
- Secrets are injected by the runtime (e.g. Katana), not committed to source control.
- Callers do not expose budget/session UUIDs to untrusted parties.

## Related documents

- [Service architecture](service-architecture.md) — context diagram.
- [Endpoint data flow](endpoint-data-flow.md) — request paths.
- [Webhooks](webhooks.md) — outbound security rules.
