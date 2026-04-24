BINARY_NAME := dev-runner
BUILD_DIR := dist
GO := go

# Force the public proxy for `go` commands invoked by this Makefile so
# `pnpm run dev` bootstraps even when the Artifactory JWT baked into the
# user's GOPROXY is expired (dev-runner's deps are all public -- see
# CLAUDE.md). Intentionally NOT exported: once dev-runner starts, it must
# see the user's real GOPROXY so preflight can detect/fix an expired
# Artifactory token. Applied inline to module-fetching recipes only.
BOOTSTRAP_ENV := GOPROXY=https://proxy.golang.org,direct GOSUMDB=sum.golang.org

.PHONY: build test lint fmt fmt-fix vet check clean run tidy

build:
	@mkdir -p $(BUILD_DIR)
	$(BOOTSTRAP_ENV) $(GO) build -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/dev-runner/

# Depend on build (which already resolves modules via BOOTSTRAP_ENV) and
# exec the compiled binary so dev-runner runs with the user's real env --
# NOT with GOPROXY forced to the public proxy, which would mask the
# Artifactory config that preflight is meant to validate.
run: build
	exec ./$(BUILD_DIR)/$(BINARY_NAME)

test:
	$(BOOTSTRAP_ENV) $(GO) test ./... -v -count=1

lint:
	$(BOOTSTRAP_ENV) golangci-lint run

fmt:
	gofumpt -l .

fmt-fix:
	gofumpt -w .

vet:
	$(BOOTSTRAP_ENV) $(GO) vet ./...

check: fmt vet lint test

clean:
	rm -rf $(BUILD_DIR)

tidy:
	$(BOOTSTRAP_ENV) $(GO) mod tidy
