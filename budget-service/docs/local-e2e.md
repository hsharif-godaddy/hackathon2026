# Local E2E testing (budget-service)

Tools in this module for **local and CI-style integration only**. They are not used by production deploys. The release binary is `cmd/server` only.

## Pieces

| Piece                  | Purpose                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres               | `make up` — same as everyday dev                                                                                                            |
| `webhook-sink`         | Docker service (compose **profile `e2e`**) — receives POST webhooks; `GET /__e2e/last` returns the last body as JSON                        |
| `scripts/e2e-local.sh` | Scripted flow: product → budget → session → PATCH spend → register webhook → report → assert API + sink                                     |
| `scripts/e2e-pr.sh`    | PR/CI curl suite (no report/webhook delivery); run in GitHub Actions [budget-service-ci.yml](../../.github/workflows/budget-service-ci.yml) |
| `cmd/dev-budget-ui`    | Browser UI + reverse proxy; see [Dev UI (`dev-budget-ui`)](#dev-ui-dev-budget-ui)                                                           |

## Quick start (auth disabled)

1. **Database:** `make up` (wait for healthy Postgres).
2. **Webhook sink:** `make e2e-up` (starts `webhook-sink` with profile `e2e`).
3. **Budget API:** in another shell, with `DATABASE_URL` set and **`LOCAL_AUTH_DISABLE=true`**:

   ```bash
   export DATABASE_URL='postgres://budget:budget@localhost:5432/budget_test?sslmode=disable'
   export LOCAL_AUTH_DISABLE=true
   go run ./cmd/server
   ```

4. **Run script:**

   ```bash
   make e2e-local
   ```

Defaults: `BUDGET_SERVICE_URL=http://127.0.0.1:8080`, `WEBHOOK_SINK_URL=http://127.0.0.1:9999`, webhook callback `http://127.0.0.1:9999/hook`.

**Requires:** `curl`, `jq`.

## Optional: JWT (prod-like auth)

1. Run server with **`SSO_HOST`** and auth enabled (default; do not set `LOCAL_AUTH_DISABLE`, see main README).
2. Export a valid Bearer token:

   ```bash
   export BUDGET_E2E_JWT="$(go run ./cmd/mint-cert-jwt)"   # or mint-iam-jwt / your token
   ```

   (`TOKEN` is accepted as an alias for the same value.)

3. Run `./scripts/e2e-local.sh` (or `make e2e-local`).

## Dev UI (`dev-budget-ui`)

`cmd/dev-budget-ui` serves embedded HTML/JS on **`DEV_BUDGET_UI_ADDR`** (default **`:9980`**) and reverse-proxies **`/health`** and **`/api/*`** to **`BUDGET_SERVICE_URL`**. That avoids browser CORS (the page talks to the same origin as the UI). The proxy sets the outbound **`Host`** header from `BUDGET_SERVICE_URL` so TLS virtual hosts (e.g. nginx in front of a deployed API) see the correct hostname.

### Environment

| Variable             | Default                 | Purpose                                                                                                                                                     |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUDGET_SERVICE_URL` | `http://127.0.0.1:8080` | Base URL of the budget API (`cmd/server`). May be **`https://…`** on a **remote** host your machine can reach (VPN, etc.). Must not be the dev UI URL/port. |
| `DEV_BUDGET_UI_ADDR` | `:9980`                 | Listen address for the dev UI + proxy.                                                                                                                      |

Set variables in the **shell** that runs the process, prefix the command, or put `BUDGET_SERVICE_URL=...` in **`.env.local`** / **`.env`**: **`make dev-budget-ui`** sources the same file as **`make dev`**. Raw **`go run ./cmd/dev-budget-ui`** does not read `.env`; export or prefix env vars in that case.

### Local API (typical)

```bash
# Terminal 1: Postgres + optional e2e-up for webhooks
make up
make e2e-up   # if testing webhooks to localhost:9999

# Terminal 2: budget server (LOCAL_AUTH_DISABLE=true for simplest path)
export DATABASE_URL='postgres://budget:budget@localhost:5432/budget_test?sslmode=disable'
export LOCAL_AUTH_DISABLE=true
go run ./cmd/server

# Terminal 3
make dev-budget-ui
```

Open **http://127.0.0.1:9980/**. **`BUDGET_SERVICE_URL` must be the budget API** (e.g. port **8080** locally), **not** `:9980`, or `/api/*` loops and the browser shows **`ERR_TOO_MANY_REDIRECTS`** (the dev UI exits at startup if it detects loopback + same port as the UI).

### Remote API

Point **`BUDGET_SERVICE_URL`** at the deployed base URL (no trailing path; same host you would use with `curl …/health`). Use the UI’s **JWT** field and **Save JWT** when auth is enabled (`Authorization: Bearer …` in `sessionStorage`). Your laptop must be allowed to reach that URL (network policy, VPN). Treat remote targets like any production-adjacent tool: avoid destructive tests on shared data.

### UI behavior

The UI calls **`/api/v1/…`** and **`/health`** on the dev UI origin; those requests are proxied to `BUDGET_SERVICE_URL`. The default **productKey** in the form is `dev-ui-product` (`e2e/dev-ui/app.js`); use that exact value for `GET /api/v1/reports?productKey=…` (or whatever you `POST` on `/api/v1/products` / budgets) — a different string (e.g. a typo) yields an empty `reports` list. **Single budget item:** fill `budgetId` and `budgetItemId`, then **GET …/budget-items/{budgetItemId}**.

## Networking notes

- Budget service on **host**, sink in Docker with `ports: "9999:9090"`: register webhooks as **`http://127.0.0.1:9999/...`** (or `http://localhost:9999/...`).
- If the budget API ever runs **inside** Docker while the sink is another container, use the Docker network hostname (e.g. `http://webhook-sink:9090/hook`) instead of `127.0.0.1`.
- **Linux:** if the server were in a container calling the host, you may need `host.docker.internal` / `extra_hosts` — not required for the default host-run server.

## Production safety

- Do **not** set **`LOCAL_AUTH_DISABLE`** in production.
- Do not point production webhook URLs at `webhook-sink` or local addresses.

## Makefile targets

E2E-relevant targets only; full target list in [`Makefile`](../Makefile).

| Target                  | Action                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `make up`               | Postgres only (unchanged)                                                                                           |
| `make e2e-up`           | `docker compose --profile e2e up -d` (sink + ensures postgres up)                                                   |
| `make e2e-down`         | Stop e2e profile services (postgres unchanged)                                                                      |
| `make e2e-local`        | Run `scripts/e2e-local.sh` with standard env defaults                                                               |
| `make verify-iam-auth`  | Run `scripts/verify-iam-auth.sh` (mint IAM JWT + `GET /api/v1/auth-check`)                                          |
| `make dev-budget-ui`    | `go run ./cmd/dev-budget-ui` (env: `BUDGET_SERVICE_URL`, `DEV_BUDGET_UI_ADDR` — see [above](#dev-ui-dev-budget-ui)) |

`make test` does **not** run the shell E2E script (keeps CI fast). Go tests with `TEST_DATABASE_URL` remain the hermetic option.

## Troubleshooting

- **Missing tables / schema drift:** Start the budget service with `DATABASE_URL` (golang-migrate applies embedded SQL), or run integration tests / `migrate` CLI against `migrations/`. Or reset the volume with `make down -v` then `make up` and re-seed if needed.
- **Webhook assertion fails:** Increase the sleep in `scripts/e2e-local.sh` if the host is slow; delivery runs in a background goroutine after `POST .../reports`.
- **`ERR_TOO_MANY_REDIRECTS` on :9980:** Usually `BUDGET_SERVICE_URL` points at the dev UI (same port as `DEV_BUDGET_UI_ADDR`). The dev UI now exits at startup if it detects that; fix env so the budget service runs on another port (e.g. 8080) and `BUDGET_SERVICE_URL=http://127.0.0.1:8080`.
- **HTML `403 Forbidden` (nginx) against a remote API while `curl $BUDGET_SERVICE_URL/health` returns JSON:** Older dev UI proxies forwarded the browser `Host` (`127.0.0.1:9980`). Current `dev-budget-ui` sets outbound `Host` from `BUDGET_SERVICE_URL`. Rebuild/re-run the latest `cmd/dev-budget-ui`; otherwise check edge allowlists and VPN.
