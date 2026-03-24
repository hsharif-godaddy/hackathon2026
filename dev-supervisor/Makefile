# dev-supervisor Makefile

.PHONY: build build-supervisor build-sandbox build-all clean test test-all test-docker test-docker-go lint lint-all fmt fmt-fix vet run help install deps

# Build variables
BINARY_NAME := dev-supervisor
BUILD_DIR := dist
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags="-w -s -X main.Version=${VERSION}"

# Force Go 1.25.7 toolchain (matches go.mod)
export GOTOOLCHAIN := go1.25.7

# Default target
.DEFAULT_GOAL := help

## Build the binary
build: build-supervisor build-sandbox

## Build the dev-supervisor binary
build-supervisor:
	@echo "Building ${BINARY_NAME}..."
	@mkdir -p ${BUILD_DIR}
	CGO_ENABLED=0 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME} ./cmd/dev-supervisor

## Build the airo-sandbox binary
build-sandbox:
	@echo "Building airo-sandbox..."
	@mkdir -p ${BUILD_DIR}
	CGO_ENABLED=0 go build ${LDFLAGS} -o ${BUILD_DIR}/airo-sandbox ./cmd/airo-sandbox

## Build for multiple platforms
build-all:
	@echo "Building for multiple platforms..."
	@mkdir -p ${BUILD_DIR}
	GOOS=linux GOARCH=amd64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-linux-amd64 ./cmd/dev-supervisor
	GOOS=linux GOARCH=arm64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-linux-arm64 ./cmd/dev-supervisor
	GOOS=darwin GOARCH=amd64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-darwin-amd64 ./cmd/dev-supervisor
	GOOS=darwin GOARCH=arm64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-darwin-arm64 ./cmd/dev-supervisor
	GOOS=windows GOARCH=amd64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-windows-amd64.exe ./cmd/dev-supervisor
	GOOS=linux GOARCH=amd64 go build ${LDFLAGS} -o ${BUILD_DIR}/airo-sandbox-linux-amd64 ./cmd/airo-sandbox
	GOOS=linux GOARCH=arm64 go build ${LDFLAGS} -o ${BUILD_DIR}/airo-sandbox-linux-arm64 ./cmd/airo-sandbox
	GOOS=darwin GOARCH=amd64 go build ${LDFLAGS} -o ${BUILD_DIR}/airo-sandbox-darwin-amd64 ./cmd/airo-sandbox
	GOOS=darwin GOARCH=arm64 go build ${LDFLAGS} -o ${BUILD_DIR}/airo-sandbox-darwin-arm64 ./cmd/airo-sandbox
	# airo-sandbox is not built for Windows (requires POSIX sh)

## Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf ${BUILD_DIR}
	@go clean

## Run tests
test:
	@echo "Running tests..."
	go test -v -race -coverprofile=coverage.out ./...

## Run integration tests
test-integration:
	@echo "Running integration tests..."
	go test -v -timeout 60s ./cmd/dev-supervisor

## Run tests with coverage report
test-coverage: test
	@echo "Generating coverage report..."
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

## Run all tests including Linux-specific (same as test on Linux, cross-platform elsewhere)
test-all: test
	@echo "Note: On Linux, all tests run automatically. On other platforms, Linux-specific tests are skipped."

## Run Docker integration tests
test-docker:
	@echo "Running Docker integration tests..."
	@chmod +x test/run-docker-tests.sh
	@./test/run-docker-tests.sh

## Run Docker tests via Go test wrapper
test-docker-go:
	@echo "Running Docker integration tests via Go..."
	@go test -v -tags=docker_integration -run TestDockerIntegration ./cmd/dev-supervisor

## Run linter
lint:
	@echo "Verifying linter configuration..."
	@golangci-lint config verify
	@echo "Running linter..."
	@golangci-lint run --timeout=5m ./...

## Run linter for all platforms (catches Linux-specific files on macOS)
lint-all:
	@echo "Verifying linter configuration..."
	@golangci-lint config verify
	@echo "Running linter for current platform..."
	@golangci-lint run --timeout=5m ./...
	@echo "Running linter for Linux (platform-specific files)..."
	@GOOS=linux golangci-lint run --timeout=5m ./...

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
	@echo "Running goimports (if available)..."
	@if command -v goimports >/dev/null 2>&1; then \
		goimports -w .; \
	else \
		echo "goimports not found, skipping import formatting"; \
		echo "Install with: go install golang.org/x/tools/cmd/goimports@latest"; \
	fi
	@echo "Running golines (if available)..."
	@if command -v golines >/dev/null 2>&1; then \
		golines -w --max-len=120 .; \
	else \
		echo "golines not found, skipping line length formatting"; \
		echo "Install with: go install github.com/segmentio/golines@latest"; \
	fi
	@echo "Formatting complete!"

## Run go vet
vet:
	@echo "Running go vet..."
	go vet ./...

## Run the application
run:
	@echo "Running ${BINARY_NAME}..."
	go run ./cmd/dev-supervisor

## Install dependencies
deps:
	@echo "Installing dependencies..."
	go mod download
	go mod tidy

## Install golangci-lint
install-lint:
	@echo "Installing golangci-lint..."
	@CURRENT_VERSION=$$(golangci-lint version 2>/dev/null | grep -oE '(v)?[0-9]+\.[0-9]+\.[0-9]+' | head -1); \
	if [ "$$CURRENT_VERSION" != "2.8.0" ] && [ "$$CURRENT_VERSION" != "v2.8.0" ]; then \
		echo "Current version: $$CURRENT_VERSION, installing v2.8.0..."; \
		curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(shell go env GOPATH)/bin v2.8.0; \
	else \
		echo "golangci-lint v2.8.0 is already installed"; \
	fi

## Run all checks (format, vet, lint, test)
check: fmt-fix vet lint test

## Install the binary to GOPATH/bin
install: build
	@echo "Installing ${BINARY_NAME} to ${GOPATH}/bin..."
	@cp ${BUILD_DIR}/${BINARY_NAME} ${GOPATH}/bin/

## Docker build
docker-build:
	@echo "Building Docker image..."
	docker build -t ${BINARY_NAME}:latest .

## Show help
help:
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'
