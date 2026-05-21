# Local Development

Workstation setup for running, debugging, and testing JWT auth against a local server. For the local E2E harness (Docker webhook sink, scripted flow, dev UI) see [Local E2E](local-e2e.md).

## Run

```bash
cd budget-service
# Server loads `.env` from cwd (process env wins).
go run ./cmd/server
# or
make build && ./bin/budget-service
# or hot reload (sources `.env.local` or `.env` for the air parent process)
make dev
```

`make build` and `make test` do not load `.env` — export vars in the shell or prefix the command. See [Configuration](configuration.md) for the full env variable reference.

## Postgres

`make up` starts Postgres 15 (`budget` / `budget_test` on `localhost:5432`) from the official `postgres:15` image. The database starts **empty**; run the server with `DATABASE_URL` set (or integration tests with `TEST_DATABASE_URL`) so golang-migrate applies embedded SQL from [`migrations/`](../migrations/) after a successful ping (`schema_migrations` tracks versions).

If tables exist but `schema_migrations` was never populated, baseline once (see Migration in [Database Design](database-design.md)) or reset the volume with `make down -v && make up`.

For integration tests, set `TEST_DATABASE_URL` (tests run `migrate.Up` automatically). Example: `TestGoCodeSpendMathOverHTTP` in `internal/api/budget_handlers_test.go`.

## Private modules (JFrog Artifactory)

`github.com/gdcorp-identity/*` resolves through GoDaddy's Artifactory Go virtual repo (`go-virt`), same as [`Dockerfile`](../Dockerfile) builds. To match `go.sum` checksums, use that proxy (not a direct Git fetch) and skip the public sum DB for those paths.

**Recommended — persist for all `go` commands on this machine** (writes `go env GOENV`, usually under your user config dir; no shell variable expansion, so embed the token in `GOPROXY`):

```bash
go env -w GOPROXY='https://:YOUR_JFROG_TOKEN@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct'
go env -w GONOPROXY=none
go env -w GONOSUMDB='github.com/gdcorp-identity/*'
go env -u GOPRIVATE
```

Use a real JFrog identity token for `YOUR_JFROG_TOKEN`. If you previously set `GOPRIVATE` for `gdcorp-identity`, clear it (`go env -u GOPRIVATE`) — leaving it set can pull different zips than CI and cause checksum mismatch against `go.sum`.

Inspect or clear: `go env GOPROXY GONOPROXY GOPRIVATE GONOSUMDB`, `go env -u GOPROXY`, etc.

**Shell alternative:** export the same variables in `~/.zshrc` (or source a gitignored file). `make dev` and `make dev-budget-ui` source `.env.local` then `.env` for the Air parent process — handy for `GOPROXY` and related vars.

## Testing JWT locally

Server: set `SSO_HOST` (unless `LOCAL_AUTH_DISABLE=true`), then `go run ./cmd/server`.

```bash
curl -sS -H "Authorization: sso-jwt YOUR_JWT" "http://localhost:8080/api/v1/auth-check"
```

With `LOG_LEVEL=debug`, look for `branch=sso_service_bearer` / `sso_service_sso_jwt` and `domain=sso_service` in auth-related slog output.

### Cert JWT

`cmd/mint-cert-jwt` mints a Cert JWT from a PEM cert/key pair. Place files under `./.certs/` (gitignored). `SSO_HOST` must match the server. Required env: `CERT_PEM_PATH`, `CERT_KEY_PATH`.

```bash
cd budget-service
TOKEN="$(go run ./cmd/mint-cert-jwt)"
curl -sS -H "Authorization: sso-jwt $TOKEN" "http://localhost:8080/api/v1/auth-check"
```

`gdmock`-signed tokens do not validate against real `gdsso`.

### IAM JWT

`cmd/mint-iam-jwt` mints an AWS IAM JWT using the AWS credential chain. Run from `budget-service/` so `.env` loads (`godotenv`). Required: `SSO_HOST`. Optional: `AWS_PROFILE` (or other AWS credential chain config).

```bash
aws sso login --profile airobuild-dev-private-sso
export AWS_PROFILE=airobuild-dev-private-sso
# JFrog / module proxy: configure once via `go env -w` (see "Private modules" above).

TOKEN="$(go run ./cmd/mint-iam-jwt)"
curl -sS -H "Authorization: sso-jwt $TOKEN" "http://localhost:8080/api/v1/auth-check"
```

### `verify-iam-auth.sh`

All-in-one check (STS identity, mint, `GET /api/v1/auth-check`). After `aws sso login`, run from `budget-service/`:

```bash
./scripts/verify-iam-auth.sh
# or
AWS_PROFILE=your-profile ./scripts/verify-iam-auth.sh
```

Optional: `-p profile`, `-u baseUrl` (or `BUDGET_SERVICE_URL`), `-r <role-arn>` to `sts assume-role` first.

Same env requirements as the server: `LOCAL_AUTH_DISABLE` off, `SSO_HOST` in `.env`, non-empty `AUTH_ALLOWED_ROLES` / `AUTH_ALLOWED_CERTS`, and roles including the minted role.

`make verify-iam-auth` runs the script with env-only flags; use the script directly for `-p` / `-r`.

## Makefile targets

See [`Makefile`](../Makefile) for the full target list. Frequently used:

| Target              | Purpose                                                       |
|---------------------|---------------------------------------------------------------|
| `make up` / `down`  | Start / stop local Postgres                                   |
| `make logs`         | Tail Postgres logs                                            |
| `make dev`          | Air hot-reload                                                |
| `make build`        | Build the server binary                                       |
| `make test`         | Run Go tests                                                  |
| `make coverage`     | Integration + unit coverage against Postgres                  |
| `make otel`         | Local OTel Collector (foreground)                             |
| `make e2e-up` / `e2e-down` / `e2e-local` | Local E2E harness ([Local E2E](local-e2e.md)) |
| `make dev-budget-ui`| Browser CRUD UI ([Local E2E](local-e2e.md#dev-ui-dev-budget-ui)) |
| `make verify-iam-auth` | Mint IAM JWT + `GET /api/v1/auth-check`                    |
| `make load-test*`, `make bench-*` | Load and benchmark targets (see Makefile)        |
