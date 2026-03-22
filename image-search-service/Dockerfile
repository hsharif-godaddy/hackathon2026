# Build stage - using GoDaddy golden container image
# Check available tags: aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | test("alpine-golang"))'
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine-golang:1.25-alpine AS builder

# Switch to root for build operations (GCI base image runs as non-root)
USER root

WORKDIR /app

# Install git required by go mod download for VCS-hosted private dependencies
RUN apk add --no-cache git

# Copy packages/go-auth to satisfy the replace directive in go.mod:
#   replace .../packages/go-auth => ../packages/go-auth
# With WORKDIR=/app, that resolves to /packages/go-auth inside the container.
COPY packages/go-auth /packages/go-auth

# Copy go mod files first for better caching
COPY image-search-service/go.mod image-search-service/go.sum ./

# Use GHEC-SA token mounted as a secret to authenticate private gdcorp-golang modules.
# The git config is written and removed within the same RUN step so the token
# is never persisted in any image layer. The subshell ensures cleanup runs even
# if go mod download fails.
RUN --mount=type=secret,id=ghec_token \
    TOKEN=$(cat /run/secrets/ghec_token) && \
    git config --global --add "url.https://x-access-token:${TOKEN}@github.com/gdcorp-golang/.insteadOf" "https://github.com/gdcorp-golang/" && \
    { GOPRIVATE=github.com/gdcorp-golang/* go mod download; rc=$?; \
      git config --global --remove-section "url.https://x-access-token:${TOKEN}@github.com/gdcorp-golang/"; \
      exit $rc; }

# Copy service source code
COPY image-search-service/ .

# Build the binary with optimizations for smaller, reproducible builds
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app/server ./cmd/server

# Runtime stage - using GoDaddy golden container image
# Alpine 3.22 EOL: 2027-07-30
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine:3.22

# Switch to root for package installation (GCI base image runs as non-root)
USER root

WORKDIR /app

# Install CA certificates for HTTPS calls, wget for health checks, and openssl for cert generation
RUN apk --no-cache add ca-certificates wget openssl

# Generate self-signed TLS certificate for Katana ELB backend HTTPS
RUN mkdir -p /app/certs && \
    openssl req -x509 -newkey rsa:2048 \
    -keyout /app/certs/server.key -out /app/certs/server.crt \
    -days 365 -nodes -subj "/CN=image-search-service" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0" && \
    chmod 644 /app/certs/server.crt && \
    chmod 600 /app/certs/server.key && \
    chown 1000:1000 /app/certs/server.key /app/certs/server.crt

# Copy binary from builder
COPY --from=builder /app/server /app/server

# Run as non-root user (GCI base image already has user with UID 1000)
USER 1000

# Expose port
EXPOSE 8080

# Environment variables for server TLS
ENV SERVER_CERT_PATH=/app/certs/server.crt
ENV SERVER_KEY_PATH=/app/certs/server.key

# Health check - start-period aligned with Katana healthcheckGracePeriod (60s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8080/api/v1/health || exit 1

# Run the server
CMD ["/app/server"]
