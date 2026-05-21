# Budget Service

Also called **Budget Management Service (BMS)** in documentation and conversation. Go HTTP API (Postgres-backed) for budgets, LLM sessions, session spend lines, session reports (reconciliation), products, and outbound webhooks. Standalone service — separate deploy pipeline, not part of the agents/app/preview/publish runtime.

- **Entry point:** [`cmd/server/main.go`](cmd/server/main.go)
- **OpenAPI spec:** [`internal/openapi/openapi.yaml`](internal/openapi/openapi.yaml) — served at `GET /openapi.yaml` and `GET /swagger/`
- **Deploy workflow:** [`.github/workflows/aws-deploy-budget-service.yml`](../.github/workflows/aws-deploy-budget-service.yml)
- **Go module:** `github.com/gdcorp-partners/airo-app-builder/budget-service` (Go 1.25.5)

Topical docs index: [README](README.md) → "Documentation".

## Conventions and gotchas

**Always update the OpenAPI spec** ([`internal/openapi/openapi.yaml`](internal/openapi/openapi.yaml)) when changing routes, request shapes, or response shapes. The spec is served live and is the contract clients code against.

**Always update [Database Schema](docs/database-schema.md)** when changing migrations — adding/removing tables or columns, changing constraints, adding triggers, functions, or indexes. The schema doc is a human-readable index over `migrations/`; if it drifts from the SQL, it stops being useful. Update [Database Design](docs/database-design.md) only if the *rationale* changes (ledger model, soft-delete philosophy, hybrid reset approach, etc.).

**Doc titles and links.** Doc H1s are the filename in Title Case (`database-design.md` → `# Database Design`); link text matches that title (`[Database Design](docs/database-design.md)`), not the filename. Section-anchored links keep descriptive text (e.g. `[migration](docs/database-design.md#migration)`).

**H2/H3 are sentence case** (`## Quick start`, `### Retry strategy`) — only proper nouns and acronyms keep their case (`## Katana (continuous deployment)`, `## OpenTelemetry`). H1s are the lone exception, since they double as the doc title.

**Match the existing structure** when adding handlers, store methods, or migrations — symmetry matters here for review velocity. Look at the closest existing route or table before designing a new one.

**Money is strings in JSON** (6 decimal places) for `creditsTotal`, `cost`, report-line costs, etc. Requests often accept string-or-number for those fields. `costToCreditRatio` is **USD per credit** — credits used = `budget_cost_usd / cost_credit_ratio`. Example: a ratio of `0.1` means 1 USD = 10 credits. See `internal/credits`.

**Nil-Store pattern.** If `DATABASE_URL` is unset, `Store` is `nil`: `/health` reports DB unconfigured and budget/product/webhook write paths return 503. Don't assume a non-nil Store in handlers — check.

## Out of scope

The root [`CLAUDE.md`](../CLAUDE.md) covers monorepo-wide conventions but most apply to the TypeScript services. budget-service is Go and standalone. The Engineering Guidelines in [`docs/gd-charter/systems/guidelines.md`](../docs/gd-charter/systems/guidelines.md) still apply (explicit types, constrained mutable state), adapted to Go idioms.
