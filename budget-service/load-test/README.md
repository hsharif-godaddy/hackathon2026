# Budget Service — Load Tests

k6-based load tests for the Budget Management Service (BMS).

## Prerequisites

```bash
brew install k6 watch  # macOS (watch is needed for `make load-test-monitor`; pre-installed on Linux)
# or: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## Quick Start

```bash
# 1. Start Postgres + budget-service (from budget-service/)
make up
make dev   # or: make build && LOCAL_AUTH_DISABLE=true ./bin/budget-service

# 2. Run all load tests (default: http://localhost:8080)
make load-test

# 3. Run a specific scenario
make load-test-contention     # Single-budget lock contention (highest risk)
make load-test-throughput     # Many-budget parallel throughput
make load-test-lifecycle      # Full session lifecycle at steady rate
```

## Scenarios

### 1. Single-Budget Contention (`contention.js`)

**What it tests:** Many concurrent sessions targeting the _same_ budget. Spend uses
optimistic concurrency (read without lock → short write lock + verify), so sessions
no longer serialize for the full replay+compute duration. The ledger trigger still
UPDATEs the same `budget_items` rows, so contention isn't eliminated — just reduced.

- Creates 1 product + 1 budget with a large credit pool
- Ramps VUs from 2 → 5 → 10 → 20 → 25 against that single budget
- Each VU: open session → 3 spend lines → **multi-line** report (default 24 `reportItems`, split of the same total cost) → **GET** that report by id

**What to watch:** `session_spend_duration` and `session_report_get_duration` in the k6 summary (PATCH vs GET detail), 409 conflict/retry rate, Postgres lock waits. `http_req_duration` blends all endpoints; use the custom Trends to isolate POST report vs GET report.

### 2. Multi-Budget Throughput (`throughput.js`)

**What it tests:** Horizontal scale — many independent budgets receiving parallel traffic.
Lock contention is low (each budget is independent), so this tests connection pool
saturation and overall query throughput.

- `setup()` pre-creates one product + budget per max VU
- Starts at 5 VUs and ramps through 25 → 50 → 100 → 200 VUs
- Each VU: open session → 3 spend lines → multi-line report → GET report, on its own budget

**What to watch:** Connection pool exhaustion (503s), p99 latency, Postgres `pg_stat_activity`.

### 3. Steady Lifecycle (`lifecycle.js`)

**What it tests:** Sustained constant-rate traffic simulating realistic production load.
Uses a fixed arrival rate rather than ramping VUs.

- Pre-creates a pool of budgets
- Sends 30 iterations/sec for 3 minutes
- Full lifecycle per iteration (including GET report after a successful POST)

**What to watch:** Sustained p99 latency, error rate stability, ledger table growth.

## Environment Variables

| Variable            | Default                 | Description                                                               |
| ------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `BASE_URL`          | `http://localhost:8080` | Budget service URL                                                        |
| `AUTH_TOKEN`        | _(empty)_               | Bearer token (skip if LOCAL_AUTH_DISABLE=true)                            |
| `REPORT_ITEM_LINES` | _(unset)_               | Override number of `reportItems` per close (1–200; default 24 when unset) |

Example with auth:

```bash
k6 run --env BASE_URL=https://dev.example.com --env AUTH_TOKEN="$JWT" load-test/contention.js
```

## Monitoring Postgres During Tests

Open a second terminal:

```bash
make load-test-monitor   # Polls pg_stat_activity every 2s
```

Or manually:

```bash
watch -n 2 'psql "postgres://budget:budget@localhost:5432/budget_test?sslmode=disable" -f load-test/pg-monitor.sql'
```

## Tuning the Service Under Load

Key env vars to adjust in `.env` (or `.env.local`) before running:

```env
DB_MAX_OPEN_CONNS=50       # Default 50; increase further for throughput test
DB_MAX_IDLE_CONNS=25       # Default 25; reduce churn under sustained load
DB_CONN_MAX_LIFETIME=5m    # Default 5m; fine as-is
WORKER_ENABLED=false       # Disable worker to isolate API performance
```

## Interpreting Results

k6 prints a summary after each run. Key lines:

```
http_req_duration .....: avg=12ms  med=8ms  p(95)=45ms  p(99)=120ms
http_req_failed .......: 2.1%  ✗ 84  ✓ 3916
```

**Healthy targets:**

- p95 < 500ms, p99 < 2s (aggregate `http_req_duration`)
- Error rate < 5%
- No 500s (409 CONFLICT from optimistic retries and ALREADY_RECONCILED are expected at high concurrency)

**Will this PR show up in load tests?** Only where the scenario hits the changed path:

- **`session_report_get_duration`** — In CI, k6 scripts come from the **PR checkout** while `bench-run.sh` hits the **Docker image** (baseline = `origin/main` binary, candidate = PR). So both runs already include GET + multi-line close; **`bench-diff` compares main vs PR server** for the same traffic shape. Expect the clearest delta on `session_report_get p95/p99` when `REPORT_ITEM_LINES` is high (e.g. 80).
- **`session_report_duration` (POST)** — batched inserts may shave a little latency; often noise vs DB jitter on a laptop runner.
- **Worker / parallel webhooks / outbox batching** — not exercised when `WORKER_ENABLED=false` (recommended for API-focused runs).

**Red flags:**

- p99 > 5s → row lock contention; check `pg-monitor.sql` output
- Error rate > 10% → connection pool exhaustion; increase `DB_MAX_OPEN_CONNS`
- Steady p99 climb → ledger table growth; check row counts

## A/B Comparison (laptop or CI)

`bench-run.sh` runs a scenario N times and emits medians as JSON. `bench-diff.sh` diffs two JSON files into a ratio table. Lets you compare two code revisions on the same hardware without tracking absolute numbers.

Prerequisites: bash 4+, `jq`, `k6`, util-linux `column` (BusyBox `column` on Alpine does not support `-s`).

```bash
# 1. Check out the baseline branch, start service + DB, record:
git checkout main
make up && make dev   # separate terminal
make bench-baseline   # default SCENARIO=contention, RUNS=3

# 2. Check out the candidate branch, restart service, record:
git checkout my-feature
make dev              # restart (keep Postgres running)
make bench-candidate

# 3. Diff:
make bench-diff
# metric                    baseline  candidate  ratio  dir
# http_req_duration p99     1200      450        0.375  better
# iterations / sec          85.2      210.7      2.473  better
# ...
```

Rules for honest laptop runs: plug in power, close other apps, run three times (default), compare ratios not absolute numbers. A 1.5× ratio is the minimum trustworthy signal on laptop-class hardware.

### CI

`.github/workflows/budget-service-load-test.yml` runs this automatically on PRs touching `budget-service/`. It builds the `main` image, benches it, builds the PR image, benches it, and posts a ratio table as a PR comment. Fails the check if any latency/error metric regresses >20%.

Manual invocation from GitHub UI: Actions → `budget-service load test (PR diff)` → Run workflow → pick scenario + run count.
