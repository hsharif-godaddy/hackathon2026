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
	gofumpt -l .

fmt-fix:
	gofumpt -w .

vet:
	$(GO) vet ./...

check: fmt vet lint test

clean:
	rm -rf $(BUILD_DIR)

tidy:
	$(GO) mod tidy
