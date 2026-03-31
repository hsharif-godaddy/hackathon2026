BINARY_NAME := dev-runner
BUILD_DIR := dist
GO := go

.PHONY: build test lint fmt fmt-fix vet check clean run

build:
	@mkdir -p $(BUILD_DIR)
	$(GO) build -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/dev-runner/

run: build
	$(BUILD_DIR)/$(BINARY_NAME)

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
