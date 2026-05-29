# Rust builder stage — builds the airo-workspace PID1 init binary
FROM rust:1.96-alpine AS rust-builder

RUN apk add --no-cache musl-dev

WORKDIR /build
COPY rust/ rust/

RUN cd rust && cargo build --release && \
    cp target/release/airo-workspace /usr/local/bin/airo-workspace

# Go builder stage
FROM golang:1.25-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git make ca-certificates tzdata

WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build statically-linked binaries (CGO_ENABLED=0 uses Go's internal linker)
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-w -s -X main.Version=${VERSION}" -o /usr/local/bin/dev-supervisor ./cmd/dev-supervisor
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-w -s" -o /usr/local/bin/airo-sandbox ./cmd/airo-sandbox

# Final stage - minimal Alpine image suitable for copying binary from
FROM alpine:3.22

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Create directories with proper permissions
RUN mkdir -p /tmp/supervisor && chmod 755 /tmp/supervisor

# Copy binaries from builder stages
COPY --from=rust-builder /usr/local/bin/airo-workspace /usr/local/bin/airo-workspace
COPY --from=builder /usr/local/bin/dev-supervisor /usr/local/bin/dev-supervisor
COPY --from=builder /usr/local/bin/airo-sandbox /usr/local/bin/airo-sandbox

# Set default socket paths for when used standalone
ENV AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH=/tmp/supervisor/dev-supervisor-preview.sock
ENV AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH=/tmp/supervisor/dev-supervisor-publish.sock
ENV DEV_SUPERVISOR_SOCKET_PATH=/tmp/supervisor/dev-supervisor.sock

# This image is primarily used as a source for COPY --from in app templates
# But it can also be run standalone for testing
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["/usr/local/bin/airo-workspace", "/usr/local/bin/dev-supervisor"]
