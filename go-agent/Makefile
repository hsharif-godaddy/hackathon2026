BINARY_NAME := go-agent
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
DIST_DIR := dist

export GOTOOLCHAIN := go1.25.7

.PHONY: build run ensure-air dev bridge-deps test lint fmt fmt-fix vet check check-ci clean

build:
	@mkdir -p $(DIST_DIR)
	go build -ldflags="-w -s -X main.Version=$(VERSION)" -o $(DIST_DIR)/$(BINARY_NAME) ./cmd/agent

# Start Go agent with TS bridge (for local development)
dev: build bridge-deps
	TS_BRIDGE_DIR=$(shell cd .. && pwd)/ts-bridge ./dist/go-agent

# Ensure TS bridge dependencies are built
bridge-deps:
	cd .. && pnpm --filter @airo/agents run build:deps

run: ensure-air
	LOG_LEVEL=$${LOG_LEVEL:-debug} air

ensure-air:
	@which air > /dev/null 2>&1 || (echo "Installing air..."; go install github.com/air-verse/air@latest)

test:
	go test -race -count=1 ./...

test-coverage:
	go test -race -count=1 -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

lint:
	golangci-lint run --timeout=5m ./...

fmt:
	@test -z "$$(gofmt -s -l .)" || (echo "Files need formatting (run 'make fmt-fix' to fix):"; gofmt -s -l .; exit 1)

fmt-fix:
	go fmt ./...
	gofmt -s -w .

vet:
	go vet ./...

check: fmt-fix vet lint test

check-ci: fmt vet lint test

clean:
	rm -rf $(DIST_DIR) coverage.out coverage.html
