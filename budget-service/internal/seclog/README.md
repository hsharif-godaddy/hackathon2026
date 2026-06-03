# Security Logger (SecLog)

Emits ECS-shaped security events tagged for SIEM routing. Used by `internal/auth/middleware.go` to record authentication outcomes (allow / deny) and authorization denials (allowlist violations).

## SIEM contract

Every event includes `tags: ["security", "application"]`. Katana's Fluent Bit sidecar matches on `tags=security` and forks the event to two destinations:

- **Splunk SIEM** — GoDaddy's central security log intake. Detection rules and audit queries run here.
- **Standard application log stream** — the same line surfaces in Grafana Loki for engineering visibility, so an oncall can correlate a security event with the surrounding request flow without context-switching to Splunk.

Events follow the [Elastic Common Schema](https://www.elastic.co/guide/en/ecs/current/index.html). Splunk maps ECS to its Common Information Model (CIM) at ingest, satisfying the [Application Security Logging Standard](https://tdl.int.gdcorp.tools/docs/products/security-identity-compliance/app-sec-log/) without bespoke field mapping.

**Always-emit guarantee.** Every seclog event reaches stdout regardless of the application's `LOG_LEVEL` tuning. The package wraps `slog.Default()`'s handler in a level-bypass shim at emit time, so an operator setting `LOG_LEVEL=warn` or `LOG_LEVEL=error` filters only regular application logs — never security events. Without this, `AuthSuccess` (`slog.LevelInfo`) would be dropped at `LOG_LEVEL=warn`, leaving Splunk with denials but no allows.

## Quick start

```go
import "github.com/gdcorp-partners/airo-app-builder/budget-service/internal/seclog"

// Once at startup.
seclog.Configure(seclog.Config{
    AWSAccountID: cfg.AWSAccountID, // → cloud.account.id
})

// Token couldn't be parsed — principal not yet established.
seclog.AuthFailure(r, seclog.Event{
    Reason: "INVALID_TOKEN",
    Status: http.StatusUnauthorized,
})

// Principal established but rejected by allowlist.
seclog.AuthzFailure(r, seclog.Event{
    Reason: "IAM_ROLE_DENIED",
    Status: http.StatusForbidden,
    User:   arn,
    Labels: []slog.Attr{slog.String("token_type", "awsiam")},
})

// Principal established and allowed.
seclog.AuthSuccess(r, seclog.Event{User: arn})
```

## Event helpers

| Helper         | `event.category` | `event.outcome` | `event.type` | Use for                                                                    |
| -------------- | ---------------- | --------------- | ------------ | -------------------------------------------------------------------------- |
| `AuthFailure`  | `authentication` | `failure`       | `denied`     | Token invalid / missing / wrong type — principal not yet established.       |
| `AuthSuccess`  | `authentication` | `success`       | `allowed`    | Token validated and principal established.                                 |
| `AuthzFailure` | `iam`            | `failure`       | `denied`     | Allowlist denial / privileged-action check — principal known but rejected. |

## Event fields

`Event` populates ECS keys directly:

| `Event` field | ECS key                     | Notes                                                                                                          |
| ------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Reason`      | `event.reason`              | Stable code (`INVALID_TOKEN`, `IAM_ROLE_DENIED`, …). Used for SIEM correlation; keep cardinality bounded.       |
| `Status`      | `http.response.status_code` | HTTP status the handler will return. Omitted on `AuthSuccess` (the protected handler hasn't run yet).           |
| `User`        | `user.name`                 | Resolved principal (IAM ARN, cert CN). Empty when unknown.                                                     |
| `Err`         | `error.message`             | See [Trust boundary](#trust-boundary).                                                                         |
| `Action`      | `event.action`              | Defaults to `auth.validate`.                                                                                   |
| `Labels`      | `labels.*`                  | Free-form structured context.                                                                                  |

Process-level fields come from `Configure`:

| `Config` field | ECS key            | Default                                              |
| -------------- | ------------------ | ---------------------------------------------------- |
| `ServiceName`  | `service.name`     | `KATANA_APP` env var, then `"budget-service"`.       |
| `Hostname`     | `host.name`        | `os.Hostname()`.                                     |
| `AWSAccountID` | `cloud.account.id` | Empty → `cloud` block omitted entirely from output.  |

Per-request fields are derived from `*http.Request`:

| ECS group                     | Source                                  |
| ----------------------------- | --------------------------------------- |
| `client.ip`, `client.address` | See [Trust boundary](#trust-boundary).  |
| `http.request.method`         | `r.Method`.                             |
| `url.path`, `url.original`    | `r.URL.Path`, `r.URL.RequestURI()`.     |
| `user_agent.original`         | `User-Agent` header (omitted if absent). |

## Trust boundary

These are SIEM-bound logs. Two fields take values from sources that can be attacker-influenced:

- **`client.ip`** — derived from `X-Forwarded-For` or `RemoteAddr`. Only entries appended by trusted hops (the ALB) are attributable; entries the client supplied must be discarded. The exact rule depends on deployment topology (which proxies prepend vs. append, whether the ALB strips inbound XFF) — see `clientIP()` for the rule applied here.
- **`error.message`** — populated from `Event.Err.Error()` verbatim. If a wrapped library (e.g. `gd-auth-lib`'s `ParseToken`) echoes input bytes into its error string, those bytes ship to Splunk. Audit error-formatting of any library whose errors you forward; prefer a stable `Reason` and drop `Err` when uncertain.

## Output example

```json
{
  "@timestamp": "2026-06-01T22:14:03.142Z",
  "level": "WARN",
  "message": "auth: IAM_ROLE_DENIED",
  "tags": ["security", "application"],
  "event": {
    "kind": "event",
    "category": "iam",
    "type": "denied",
    "outcome": "failure",
    "action": "auth.validate",
    "reason": "IAM_ROLE_DENIED"
  },
  "service":    {"name": "budget-service"},
  "host":       {"name": "ip-10-0-1-42"},
  "cloud":      {"account": {"id": "123456789012"}},
  "client":     {"ip": "203.0.113.7", "address": "203.0.113.7"},
  "http":       {"request": {"method": "POST"}, "response": {"status_code": 403}},
  "url":        {"path": "/v1/budgets", "original": "/v1/budgets"},
  "user_agent": {"original": "curl/8.4.0"},
  "user":       {"name": "arn:aws:iam::123456789012:role/some-role"},
  "labels":     {"token_type": "awsiam"}
}
```

slog's default `time` and `msg` keys are renamed to `@timestamp` and `message` for Fluent Bit compatibility.

## Testing

Tests inject a logger backed by a buffer and assert against parsed JSON:

```go
var buf bytes.Buffer
restore := setLoggerForTest(slog.New(slog.NewJSONHandler(&buf, nil)))
defer restore()
```

`setLoggerForTest` mutates package-level state, so tests using it must not run in parallel.

## Cross-language parity

API and field shape mirror [`@godaddy/security-logger`](https://github.com/gdcorp-engineering/node-security-logger) (Node) so events from Go and Node services share an identical SIEM contract. Alignment points:

- `aws.accountId` is **explicitly configured**, not auto-discovered (matches the Node library's `awsAccountId` constructor option).
- `tags: ["security", "application"]` is the routing key both libraries use.
- ECS field names and nesting match.

When adding event types, check the Node library's catalog first — preserving names and shapes saves SOC effort writing cross-service detection rules.

## References

- [Application Security Logging Standard (TDL)](https://tdl.int.gdcorp.tools/docs/products/security-identity-compliance/app-sec-log/)
- [Katana SIEM logging](https://tdl.int.gdcorp.tools/docs/products/compute/managed/katana/monitoring/#logging-security-events-into-siem)
- [`@godaddy/security-logger`](https://github.com/gdcorp-engineering/node-security-logger)
- [Elastic Common Schema](https://www.elastic.co/guide/en/ecs/current/index.html)

## Extraction roadmap

This package is internal to budget-service today. The public API, ECS shape, and `Config` field set are intentionally stable and intended to survive extraction unchanged. To ship as a shared module (e.g. `github.com/gdcorp-go-charter/seclog`):

1. **Drop the package-owned slog handler.** Emit through `slog.Default()` (or an injected `*slog.Logger`) so the consuming service owns the writer. Removes the multi-handler stdout interleaving risk by construction, and removes the `@timestamp` / `message` rename — that rename is a Katana convention, not a security concern, and belongs in each consumer's logger setup.
2. **Switch to a constructor-returned `*Logger`.** Replace package-level `cfg` + `Configure` with `seclog.New(opts ...Option) *Logger`; methods hang off the returned value. Eliminates `setLoggerForTest`'s reset semantics — tests inject the logger directly.
3. **Unexport `Outcome` / `Category` / `Type`.** External callers don't pick them; the public helpers select the correct combination. Hiding them prevents illegal pairings (e.g. `OutcomeSuccess` + `TypeDenied`) at the boundary.
4. **Grow the event catalog as needed** — `Audit`, `ConfigChange`, `SessionRevoked`, etc. Mirror names and shapes from the Node library where they overlap.

Until then, only the wiring (handler ownership, package-level state) is expected to shift.
