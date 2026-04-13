# Build stage - using GoDaddy golden container image
# Check available tags: aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | test("alpine-golang"))'
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine-golang:1.25-alpine AS builder

# Switch to root for build operations (GCI base image runs as non-root)
USER root

WORKDIR /app

# Install build dependencies for CGO (required by gd-auth-lib FFI)
RUN apk --no-cache add gcc musl-dev

# Copy go mod files first for better caching
COPY budget-service/go.mod budget-service/go.sum ./

# Use JFrog OIDC token mounted as a secret to fetch private gdcorp modules
# from JFrog Artifactory go-virt virtual repository. The token is scoped to this
# RUN command and never persisted in any image layer.
RUN --mount=type=secret,id=jfrog_token \
    JFROG_TOKEN=$(cat /run/secrets/jfrog_token) \
    GOPROXY="https://:${JFROG_TOKEN}@gdartifactory1.jfrog.io/artifactory/api/go/go-virt" \
    GOPRIVATE= \
    GONOPROXY=none \
    GONOSUMDB="github.com/gdcorp-identity/*" \
    GOFLAGS="-mod=mod" \
    go mod download

# Production sources: cmd/server + internal + migrations (embedded SQL via migrations/embed.go).
# Skip e2e, docs, scripts, docker-compose, dev CLIs under cmd/, local certs/env, etc.
COPY budget-service/cmd/server ./cmd/server
COPY budget-service/internal ./internal
COPY budget-service/migrations ./migrations

# Build the binary with CGO enabled for gd-auth-lib FFI support.
# JFrog token is required to resolve any go.sum entries for private modules.
RUN --mount=type=secret,id=jfrog_token \
    JFROG_TOKEN=$(cat /run/secrets/jfrog_token) \
    GOPROXY="https://:${JFROG_TOKEN}@gdartifactory1.jfrog.io/artifactory/api/go/go-virt" \
    GOPRIVATE= \
    GONOPROXY=none \
    GONOSUMDB="github.com/gdcorp-identity/*" \
    GOFLAGS="-mod=mod" \
    CGO_ENABLED=1 GOOS=linux go build -tags musl -trimpath -ldflags="-s -w" -o /app/server ./cmd/server

# Copy gd-auth-lib FFI native library from Go module cache for runtime.
# The musl variant is used because Alpine uses musl libc.
RUN mkdir -p /app/lib && \
    cp $(go env GOPATH)/pkg/mod/github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib@*/lib/musl_x64_linux/libffi_bridge.so /app/lib/

# Runtime stage - using GoDaddy golden container image
# Alpine 3.22 EOL: 2027-07-30
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine:3.22

# Switch to root for package installation (GCI base image runs as non-root)
USER root

WORKDIR /app

# Install CA certificates for HTTPS calls, wget for health checks, openssl for cert generation,
# and libgcc for gd-auth-lib FFI runtime dependencies
RUN apk --no-cache add ca-certificates wget openssl libgcc

# Generate self-signed TLS certificate for Katana ELB backend HTTPS
RUN mkdir -p /app/certs && \
    openssl req -x509 -newkey rsa:2048 \
    -keyout /app/certs/server.key -out /app/certs/server.crt \
    -days 365 -nodes -subj "/CN=budget-service" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0" && \
    chmod 644 /app/certs/server.crt && \
    chmod 600 /app/certs/server.key && \
    chown 1000:1000 /app/certs/server.key /app/certs/server.crt

# Copy binary and gd-auth-lib FFI native library from builder
COPY --from=builder /app/server /app/server
COPY --from=builder /app/lib/libffi_bridge.so /usr/lib/libffi_bridge.so

# Writable audit log dir (matches config default) and /app for AUDIT_LOG_PATH=./audit.log
RUN mkdir -p /var/log/budget-service && \
    chown -R 1000:1000 /var/log/budget-service /app

# Run as non-root user (GCI base image already has user with UID 1000)
USER 1000

# Expose port
EXPOSE 8080

# Environment variables for server TLS
ENV SERVER_CERT_PATH=/app/certs/server.crt
ENV SERVER_KEY_PATH=/app/certs/server.key
ENV AUDIT_LOG_PATH=/var/log/budget-service/audit.log

# Health check - start-period aligned with Katana healthcheckGracePeriod (60s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8080/health || exit 1

# Run the server
CMD ["/app/server"]
