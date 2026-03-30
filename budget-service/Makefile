# budget-service/Makefile

.PHONY: build dev test test-integration test-repo test-scale test-production up down logs clean

_BUDGET_SVC_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

# Build the service
build:
	go build -o dist/budget-service ./cmd/server

# Live-reload dev server (go run Air; no global install). Air is not in go.sum; version pinned here only.
# Sources .env.local if present, else .env (shell syntax: KEY=value lines; see README).
AIR_VERSION ?= v1.64.5
dev:
	cd $(_BUDGET_SVC_DIR) && \
	if [ -f .env.local ]; then \
		set -a && . ./.env.local && set +a && go run github.com/air-verse/air@$(AIR_VERSION); \
	elif [ -f .env ]; then \
		set -a && . ./.env && set +a && go run github.com/air-verse/air@$(AIR_VERSION); \
	else \
		go run github.com/air-verse/air@$(AIR_VERSION); \
	fi

# Unit tests (no database required)
test:
	go test ./...

# Start test infrastructure (postgres only - budget-service requires ECR auth)
up:
	docker-compose up -d postgres
	@echo "Waiting for postgres to be ready..."
	@sleep 3
	@echo "Postgres ready. Run 'make test-repo' or 'make test-integration' to run tests."

# Stop and clean up (fresh DB next run)
down:
	docker-compose down -v

# View logs
logs:
	docker-compose logs -f

# Integration tests (requires: make up)
test-integration:
	INTEGRATION_TEST=1 go test -tags=integration -v ./internal/integration/...

# Repository integration tests (requires: make up)
test-repo:
	INTEGRATION_TEST=1 go test -tags=integration -v ./internal/budget/...

# Scale benchmarks (requires: make up)
test-scale:
	INTEGRATION_TEST=1 go test -tags=integration -bench=. -benchtime=10s ./internal/integration/...

# Production scale soak test (requires: make up)
test-production:
	INTEGRATION_TEST=1 go test -tags=integration -bench=BenchmarkProductionScale -benchtime=5m -v ./internal/integration/...

# Full integration workflow
test-all: up test-repo test-integration test-scale down

# Clean build artifacts
clean:
	rm -rf dist/
