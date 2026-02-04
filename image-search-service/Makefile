# image-search-service Makefile

.PHONY: build clean test test-integration lint fmt fmt-fix vet run help deps

# Build variables
BINARY_NAME := image-search-service
BUILD_DIR := dist
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags="-w -s -X main.Version=${VERSION}"

# Default target
.DEFAULT_GOAL := help

## Build the binary
build:
	@echo "Building ${BINARY_NAME}..."
	@mkdir -p ${BUILD_DIR}
	CGO_ENABLED=0 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME} ./cmd/server

## Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf ${BUILD_DIR}
	@go clean

## Run tests
test:
	@echo "Running tests..."
	go test -v -race -coverprofile=coverage.out ./...

## Run tests with coverage report
test-coverage: test
	@echo "Generating coverage report..."
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

## Run integration tests (requires credentials in .env)
test-integration:
	@echo "Running integration tests..."
	@echo "Loading .env and running tests..."
	@if [ -f .env ]; then \
		set -a && . ./.env && set +a && \
		INTEGRATION_TEST=1 go test -v -timeout 120s ./internal/search/... -run Integration; \
	else \
		echo "Error: .env file not found"; \
		exit 1; \
	fi

## Run linter
lint:
	@echo "Running linter..."
	@golangci-lint run --timeout=5m ./...

## Format code (check only)
fmt:
	@echo "Checking code formatting..."
	@if [ -n "$$(gofmt -s -l .)" ]; then \
		echo "The following files are not properly formatted:"; \
		gofmt -s -l .; \
		echo "Run 'make fmt-fix' to fix formatting issues."; \
		exit 1; \
	else \
		echo "All Go files are properly formatted."; \
	fi

## Format and fix all Go files
fmt-fix:
	@echo "Formatting and fixing all Go files..."
	@echo "Running go fmt..."
	go fmt ./...
	@echo "Running gofmt with simplify..."
	gofmt -s -w .
	@echo "Formatting complete!"

## Run go vet
vet:
	@echo "Running go vet..."
	go vet ./...

## Run the application (logs to stdout and server.log)
run: build
	@echo "Running ${BINARY_NAME}... (logging to server.log)"
	./${BUILD_DIR}/${BINARY_NAME} 2>&1 | tee server.log

## Install dependencies
deps:
	@echo "Installing dependencies..."
	go mod download
	go mod tidy

## Run all checks (format, vet, lint, test)
check: fmt-fix vet lint test

## Show help
help:
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'
