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
