BINARY_NAME := local-control-plane
BUILD_DIR := dist
GO := go

.PHONY: build test lint fmt fmt-fix vet check clean run

build:
	$(GO) build -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/server/

run:
	exec $(GO) run ./cmd/server/

test:
	$(GO) test ./... -v -count=1

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
	$(GO) vet ./...

check: fmt vet lint test

clean:
	rm -rf $(BUILD_DIR)

tidy:
	$(GO) mod tidy
