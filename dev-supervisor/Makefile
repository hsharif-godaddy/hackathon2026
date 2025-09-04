# dev-supervisor Makefile

.PHONY: build clean test lint fmt fmt-fix vet run help install deps

# Build variables
BINARY_NAME := dev-supervisor
BUILD_DIR := dist
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags="-w -s -X main.Version=${VERSION}"

# Default target
.DEFAULT_GOAL := help

## Build the binary
build:
	@echo "Building ${BINARY_NAME}..."
	@mkdir -p ${BUILD_DIR}
	go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME} .

## Build for multiple platforms
build-all:
	@echo "Building for multiple platforms..."
	@mkdir -p ${BUILD_DIR}
	GOOS=linux GOARCH=amd64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-linux-amd64 .
	GOOS=linux GOARCH=arm64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-linux-arm64 .
	GOOS=darwin GOARCH=amd64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-darwin-amd64 .
	GOOS=darwin GOARCH=arm64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-darwin-arm64 .
	GOOS=windows GOARCH=amd64 go build ${LDFLAGS} -o ${BUILD_DIR}/${BINARY_NAME}-windows-amd64.exe .

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
	go test -v -timeout 60s

## Run tests with coverage report
test-coverage: test
	@echo "Generating coverage report..."
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

## Run linter
lint:
	@echo "Running linter..."
	golangci-lint run --timeout=5m ./...

## Format code (check only)
fmt:
	@echo "Checking code formatting..."
	@if [ -n "$$(gofmt -l .)" ]; then \
		echo "The following files are not properly formatted:"; \
		gofmt -l .; \
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
	@echo "Formatting complete!"

## Run go vet
vet:
	@echo "Running go vet..."
	go vet ./...

## Run the application
run:
	@echo "Running ${BINARY_NAME}..."
	go run . 

## Install dependencies
deps:
	@echo "Installing dependencies..."
	go mod download
	go mod tidy

## Install golangci-lint
install-lint:
	@echo "Installing golangci-lint..."
	@which golangci-lint > /dev/null || curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(shell go env GOPATH)/bin v1.55.2

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
