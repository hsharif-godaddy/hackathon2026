# budget-service — see README.md, docs/budget-service-spec.md, docs/local-e2e.md

.PHONY: build dev test coverage clean lint fmt fmt-fix vet check up down logs otel e2e-up e2e-down e2e-local dev-budget-ui verify-iam-auth \
       load-test load-test-contention load-test-throughput load-test-lifecycle load-test-monitor \
       bench-baseline bench-candidate bench-diff

_BUDGET_SVC_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
_COMPOSE := docker compose -f $(_BUDGET_SVC_DIR)docker-compose.yml

build:
	go build -o bin/budget-service ./cmd/server

# Live-reload dev server (go run Air; no global install). Air is not in go.sum; version pinned here only.
# Sources .env.local if present, else .env (shell syntax: KEY=value lines).
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

test:
	go test ./...

coverage:
	TEST_DATABASE_URL=postgres://budget:budget@localhost:5432/budget_test?sslmode=disable \
	go test -race -coverprofile=coverage.out ./internal/... ./cmd/server/...
	go test -race ./cmd/...
	go install github.com/jandelgado/gcov2lcov@v1.1.1
	mkdir -p coverage
	gcov2lcov -infile=coverage.out -outfile=coverage/lcov.info
	go tool cover -html=coverage.out -o coverage/index.html
	@echo ""
	@go tool cover -func=coverage.out
	@echo ""
	@echo "lcov written to coverage/lcov.info"
	@echo "HTML report: coverage/index.html"

clean:
	rm -rf bin/ tmp/

lint:
	golangci-lint run

fmt:
	@if [ -n "$$(gofmt -s -l .)" ]; then \
		echo "The following files are not properly formatted:"; \
		gofmt -s -l .; \
		echo "Run 'make fmt-fix' to fix."; \
		exit 1; \
	fi

fmt-fix:
	gofmt -s -w .

vet:
	go vet ./...

check: fmt vet lint test

e2e-up:
	$(_COMPOSE) up -d postgres
	$(_COMPOSE) --profile e2e up -d --build webhook-sink
	@echo "webhook-sink -> http://127.0.0.1:9999 (POST any path; GET /__e2e/last)"

e2e-down:
	-$(_COMPOSE) --profile e2e stop webhook-sink

e2e-local:
	@BUDGET_SERVICE_URL="$${BUDGET_SERVICE_URL:-http://127.0.0.1:8080}" \
		WEBHOOK_SINK_URL="$${WEBHOOK_SINK_URL:-http://127.0.0.1:9999}" \
		"$(_BUDGET_SVC_DIR)scripts/e2e-local.sh"

# AWS creds + mint IAM JWT + GET /api/v1/auth-check. Optional: AWS_PROFILE, BUDGET_SERVICE_URL; args: make verify-iam-auth AWS_PROFILE=p BUDGET_SERVICE_URL=u
verify-iam-auth:
	@"$(_BUDGET_SVC_DIR)scripts/verify-iam-auth.sh"

dev-budget-ui:
	cd $(_BUDGET_SVC_DIR) && \
	if [ -f .env.local ]; then \
		set -a && . ./.env.local && set +a && go run ./cmd/dev-budget-ui; \
	elif [ -f .env ]; then \
		set -a && . ./.env && set +a && go run ./cmd/dev-budget-ui; \
	else \
		go run ./cmd/dev-budget-ui; \
	fi

up:
	$(_COMPOSE) up -d postgres
	@echo "Postgres on localhost:5432 (user budget, db budget_test). DATABASE_URL:"
	@echo "postgres://budget:budget@localhost:5432/budget_test?sslmode=disable"
	@echo "Schema: start ./cmd/server (or run tests) with that URL so migrations apply."

down:
	$(_COMPOSE) down -v

logs:
	$(_COMPOSE) logs -f postgres

otel:
	$(_COMPOSE) up otel-collector

# ── Load tests (k6) ─────────────────────────────────────────────────
# Prerequisites: brew install k6; make up && make dev
load-test:
	$(_BUDGET_SVC_DIR)load-test/run.sh

load-test-contention:
	$(_BUDGET_SVC_DIR)load-test/run.sh contention

load-test-throughput:
	$(_BUDGET_SVC_DIR)load-test/run.sh throughput

load-test-lifecycle:
	$(_BUDGET_SVC_DIR)load-test/run.sh lifecycle

load-test-monitor:
	watch -n 2 'psql "postgres://budget:budget@localhost:5432/budget_test?sslmode=disable" -f $(_BUDGET_SVC_DIR)load-test/pg-monitor.sql'

# ── Bench comparison (local A/B) ────────────────────────────────────
# Typical flow on a laptop:
#   git checkout main    && make up && make dev && make bench-baseline  SCENARIO=contention
#   git checkout feature && make dev                   && make bench-candidate SCENARIO=contention
#   make bench-diff
SCENARIO ?= contention
RUNS     ?= 3
bench-baseline:
	@mkdir -p $(_BUDGET_SVC_DIR)load-test/results
	RUNS=$(RUNS) $(_BUDGET_SVC_DIR)load-test/bench-run.sh $(SCENARIO) > $(_BUDGET_SVC_DIR)load-test/results/baseline.json
	@echo "wrote baseline: $(_BUDGET_SVC_DIR)load-test/results/baseline.json"

bench-candidate:
	@mkdir -p $(_BUDGET_SVC_DIR)load-test/results
	RUNS=$(RUNS) $(_BUDGET_SVC_DIR)load-test/bench-run.sh $(SCENARIO) > $(_BUDGET_SVC_DIR)load-test/results/candidate.json
	@echo "wrote candidate: $(_BUDGET_SVC_DIR)load-test/results/candidate.json"

bench-diff:
	$(_BUDGET_SVC_DIR)load-test/bench-diff.sh \
	  $(_BUDGET_SVC_DIR)load-test/results/baseline.json \
	  $(_BUDGET_SVC_DIR)load-test/results/candidate.json

