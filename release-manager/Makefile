BINARY_NAME := release-manager
BUILD_DIR := dist
GO := go

.PHONY: build test lint fmt fmt-fix vet check clean run dry-run tidy

build:
	@mkdir -p $(BUILD_DIR)
	$(GO) build -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/release-manager/

run: build
	$(BUILD_DIR)/$(BINARY_NAME)

dry-run: build
	$(BUILD_DIR)/$(BINARY_NAME) --dry-run

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
