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
- Each VU: open session → 3 spend lines → close with report

**What to watch:** p95/p99 latency on PATCH (spend), 409 conflict/retry rate, Postgres lock waits.

### 2. Multi-Budget Throughput (`throughput.js`)

**What it tests:** Horizontal scale — many independent budgets receiving parallel traffic.
Lock contention is low (each budget is independent), so this tests connection pool
saturation and overall query throughput.

- `setup()` pre-creates one product + budget per max VU
- Starts at 5 VUs and ramps through 25 → 50 → 100 → 200 VUs
- Each VU: open session → 3 spend lines → report, on its own budget

**What to watch:** Connection pool exhaustion (503s), p99 latency, Postgres `pg_stat_activity`.

### 3. Steady Lifecycle (`lifecycle.js`)

**What it tests:** Sustained constant-rate traffic simulating realistic production load.
Uses a fixed arrival rate rather than ramping VUs.

- Pre-creates a pool of budgets
- Sends 30 iterations/sec for 3 minutes
- Full lifecycle per iteration

**What to watch:** Sustained p99 latency, error rate stability, ledger table growth.

## Environment Variables

| Variable     | Default                 | Description                                    |
| ------------ | ----------------------- | ---------------------------------------------- |
| `BASE_URL`   | `http://localhost:8080` | Budget service URL                             |
| `AUTH_TOKEN` | _(empty)_               | Bearer token (skip if LOCAL_AUTH_DISABLE=true) |

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

- p95 < 500ms, p99 < 2s
- Error rate < 5%
- No 500s (409 CONFLICT from optimistic retries and ALREADY_RECONCILED are expected at high concurrency)

**Red flags:**

- p99 > 5s → row lock contention; check `pg-monitor.sql` output
- Error rate > 10% → connection pool exhaustion; increase `DB_MAX_OPEN_CONNS`
- Steady p99 climb → ledger table growth; check row counts
