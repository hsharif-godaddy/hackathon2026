# Rust builder stage — builds the airo-workspace PID1 init binary
FROM rust:1.96-alpine AS rust-builder

# musl-dev: musl C library for the final binary.
# gcc: provides the system C linker plus libgcc / libgcc_s. Proc-macro
# crates (e.g. tokio-macros) and build scripts produce intermediate
# artifacts that must dynamically link to libgcc/libc; the rust-lld
# default doesn't search /usr/lib, so we route linking through cc/gcc
# below.
RUN apk add --no-cache musl-dev gcc

# Override the per-target linker set in rust/.cargo/config.toml for the
# Alpine native build. cc (= gcc on Alpine) auto-includes /usr/lib and
# /usr/lib/gcc/... in its search path, so proc-macro / build-script
# compiles can resolve -lgcc_s / -lc / -lgcc. The cross-compile path in
# CI is unaffected (glibc host has the libs in standard locations and
# rust-lld works there). crt-static stays on by default for the musl
# target, so the final binary is still fully static. Cargo documents
# CARGO_TARGET_<triple>_LINKER as overriding the config-file setting,
# which is more explicit than RUSTFLAGS=-C linker=cc would be.
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=cc
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=cc

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
