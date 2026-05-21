# Testing

## Strategy

Coverage target is **>80%** via Go integration tests (`*_integration_test.go` and `*_test.go` files under `internal/`). These tests run against a real Postgres instance and exercise store logic, handler behavior, validation, and error paths directly — providing fast feedback and fine-grained assertions.

## CI jobs (`.github/workflows/budget-service-ci.yml`)

| Job      | Purpose                               | What it validates                                                              |
|----------|---------------------------------------|--------------------------------------------------------------------------------|
| **lint** | Static analysis                       | `go vet`, `gofmt`                                                              |
| **test** | Unit + integration coverage (primary) | All `./internal/...` tests against Postgres; produces lcov for SPAQ            |
| **e2e**  | Container smoke test                  | Dockerfile builds, binary boots, migrations run, HTTP routing works end-to-end |

## Maintenance guidance

- **New behavior coverage → integration tests.** Add `*_integration_test.go` or `*_test.go` files under the relevant `internal/` package. These are the primary coverage vehicle and where the >80% target is measured.
- **e2e job (`scripts/e2e-pr.sh`)** is a lightweight contract check: it confirms the container image builds, the server starts, and key routes respond correctly. It is *not* the place to add detailed scenario coverage — keep it thin. Only extend it when validating something the integration tests structurally cannot (e.g. Docker build, startup sequencing, TLS termination).
- **`make coverage`** runs the same suite locally and produces an HTML report + lcov.

## Running tests locally

```bash
make up         # Start Postgres
make test       # Unit tests (no DB required for pure-unit)
make coverage   # Integration + unit against Postgres, produces coverage/
make e2e-local  # Full container smoke (Docker required)
```

Tests requiring Postgres use the `TEST_DATABASE_URL` env var; `make coverage` sets it automatically. `make test` does **not** run the shell E2E script (keeps CI fast). Go tests with `TEST_DATABASE_URL` remain the hermetic option.

For the local E2E harness (Docker webhook sink, scripted flow, dev UI), see [Local E2E](local-e2e.md).
