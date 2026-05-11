.PHONY: build dev test lint vet fmt clean

_SVC_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

build:
	cd $(_SVC_DIR) && go build -o bin/stripe-service ./cmd/server

dev:
	cd $(_SVC_DIR) && LOG_LEVEL=debug LOG_FORMAT=text AUTH_TYPE=none go run ./cmd/server

test:
	cd $(_SVC_DIR) && go test -race ./...

vet:
	cd $(_SVC_DIR) && go vet ./...

fmt:
	cd $(_SVC_DIR) && gofmt -s -w .

lint: vet
	cd $(_SVC_DIR) && \
	if [ "$$(gofmt -s -l . | wc -l)" -gt 0 ]; then \
		echo "The following files are not properly formatted:" >&2; \
		gofmt -s -l .; \
		exit 1; \
	fi

clean:
	cd $(_SVC_DIR) && rm -rf bin/ tmp/
