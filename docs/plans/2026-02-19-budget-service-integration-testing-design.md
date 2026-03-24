# Budget Service Integration Testing Design

**Date:** 2026-02-19
**Status:** Approved
**Author:** Claude + jeichorn

## Problem

The budget-service needs integration tests that validate the full request path and scale testing to ensure it can handle production workloads (>1000 req/sec, 100k budgets).

## Solution

Add Docker Compose infrastructure and Go integration/benchmark tests that:

- Run against a real PostgreSQL database
- Test the full HTTP API stack
- Validate correctness under concurrent load
- Measure throughput at various concurrency levels
- Simulate production-scale workloads

## Infrastructure

### Docker Compose

**File:** `budget-service/docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: budget
      POSTGRES_PASSWORD: budget
      POSTGRES_DB: budget_test
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U budget -d budget_test"]
      interval: 2s
      timeout: 5s
      retries: 10

  budget-service:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://budget:budget@postgres:5432/budget_test?sslmode=disable
      PORT: 8080
      LOG_LEVEL: info
      AUDIT_LOG_PATH: /var/log/budget-service/audit.log
    ports:
      - "8080:8080"
```

### Test Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  go test        │────▶│  budget-service │────▶│  PostgreSQL     │
│  (host)         │     │  (container)    │     │  (container)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

Tests run on the host and hit the budget-service HTTP API, which connects to PostgreSQL. This validates the full request path.

## Test File Structure

```
budget-service/
├── docker-compose.yml           # Infrastructure
├── internal/
│   └── integration/             # Integration test package
│       ├── integration_test.go  # Setup, helpers, API client
│       ├── budget_test.go       # CRUD integration tests
│       ├── spend_test.go        # Spend/release integration tests
│       └── scale_test.go        # Benchmark tests (testing.B)
├── Makefile                     # Test targets
```

### Build Tag Pattern

All integration test files use:

```go
//go:build integration

package integration

func skipIfNoIntegration(t testing.TB) {
    if os.Getenv("INTEGRATION_TEST") != "1" {
        t.Skip("Skipping integration test (set INTEGRATION_TEST=1)")
    }
}
```

## Integration Tests

### Budget CRUD Tests (`budget_test.go`)

| Test                          | Validates                                                         |
| ----------------------------- | ----------------------------------------------------------------- |
| `TestCreateBudget`            | Create interval/burndown budgets, verify response fields          |
| `TestCreateBudget_Validation` | Missing fields return 400, proper error messages                  |
| `TestUpdateBudget`            | Partial updates work, returns updated budget                      |
| `TestDeleteBudget`            | Returns 204, subsequent GET returns empty                         |
| `TestGetBudgets`              | Returns all budgets for subscription, totals calculated correctly |

### Spend/Release Tests (`spend_test.go`)

| Test                            | Validates                                                 |
| ------------------------------- | --------------------------------------------------------- |
| `TestSpend_Basic`               | Spend deducts credits, returns correct balance            |
| `TestSpend_ConversionFactor`    | Budget with factor 0.9 costs 90 credits for 100 requested |
| `TestSpend_MultibudgetOrdering` | Spends from soonest-expiring budget first                 |
| `TestSpend_SoftLimit`           | Allows negative balance, returns `overBudget: true`       |
| `TestSpend_Alerts`              | Returns warning_80pct, warning_90pct, exceeded alerts     |
| `TestRelease_Basic`             | Release restores credits correctly                        |
| `TestLazyReset`                 | Interval budget past reset date gets reset on spend       |

## Scale/Benchmark Tests

### Benchmark 1: Concurrent Spend Operations

```go
func BenchmarkConcurrentSpend(b *testing.B)
```

- Setup: 1 subscription, 1 budget with 1M credits
- Run: b.N concurrent spend requests of 1 credit each
- Validates: No race conditions, final balance = initial - b.N

### Benchmark 2: Throughput at Various Concurrency

```go
func BenchmarkThroughput(b *testing.B)
```

- Tests concurrency levels: 10, 50, 100, 500
- Measures: ops/sec, ns/op at each level

### Benchmark 3: Multi-Budget Stress

```go
func BenchmarkMultiBudgetAllocation(b *testing.B)
```

- Setup: 1 subscription, 10 budgets with staggered expirations
- Validates: Correct ordering maintained under load

### Benchmark 4: Production Scale Simulation

```go
func BenchmarkProductionScale(b *testing.B)
```

| Aspect           | Value                           |
| ---------------- | ------------------------------- |
| Total budgets    | 100,000                         |
| Subscriptions    | 50,000                          |
| Budgets per sub  | 2 (1 interval + 1 burndown)     |
| Read/Write ratio | 70% read, 25% spend, 5% release |
| Target interval  | ~30s per subscription           |

Metrics reported:

- ops/sec (overall and by operation type)
- Latency percentiles (p50, p95, p99)
- Error rate
- Final data integrity check

## Makefile Targets

```makefile
# Unit tests (no database required)
test:
	go test ./...

# Start test infrastructure
up:
	docker-compose up -d --build

# Stop and clean up (fresh DB next run)
down:
	docker-compose down -v

# Integration tests (requires: make up)
test-integration:
	INTEGRATION_TEST=1 go test -tags=integration -v ./internal/integration/...

# Scale benchmarks (requires: make up)
test-scale:
	INTEGRATION_TEST=1 go test -tags=integration -bench=. -benchtime=10s ./internal/integration/...

# Production scale soak test (requires: make up)
test-production:
	INTEGRATION_TEST=1 go test -tags=integration -bench=BenchmarkProductionScale -benchtime=5m -v ./internal/integration/...

# Full integration workflow
test-all: up test-integration test-scale down
```

## Usage

```bash
cd budget-service
make up                 # Start PostgreSQL + budget-service
make test-integration   # Run integration tests
make test-scale         # Run benchmarks
make test-production    # Run 5-minute soak test
make down               # Cleanup
```

## Key Decisions

| Decision           | Choice                   | Rationale                         |
| ------------------ | ------------------------ | --------------------------------- |
| Test location      | `budget-service/`        | Self-contained, easy to run       |
| Test target        | HTTP API                 | Validates full stack, realistic   |
| Database lifecycle | Fresh per session        | Clean slate, reproducible         |
| Test triggering    | Build tag + env var      | Matches existing patterns         |
| Output format      | Go benchmark             | Standard tooling, easy comparison |
| Production scale   | 50k subs, 2 budgets each | Realistic distribution            |
