# Build stage - using GoDaddy golden container image
# Check available tags: aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | test("alpine-golang"))'
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine-golang:1.25-alpine AS builder

# Switch to root for build operations (GCI base image runs as non-root)
USER root

WORKDIR /app

# Copy packages/go-auth to satisfy the replace directive in go.mod:
#   replace .../packages/go-auth => ../packages/go-auth
# With WORKDIR=/app, that resolves to /packages/go-auth inside the container.
COPY packages/go-auth /packages/go-auth

# Copy go mod files first for better caching
COPY knowledge-service/go.mod knowledge-service/go.sum ./

# Use JFrog OIDC token mounted as a secret to fetch private gdcorp-golang modules
# from JFrog Artifactory go-virt virtual repository. The token is scoped to this
# RUN command and never persisted in any image layer.
RUN --mount=type=secret,id=jfrog_token \
    JFROG_TOKEN=$(cat /run/secrets/jfrog_token) \
    GOPROXY="https://:${JFROG_TOKEN}@gdartifactory1.jfrog.io/artifactory/api/go/go-virt|direct" \
    GONOSUMDB="github.com/gdcorp-golang/*" \
    GOFLAGS="-mod=mod" \
    go mod download

# Copy service source code
COPY knowledge-service/ .

# Build the binary with optimizations for smaller, reproducible builds.
# JFrog token is required to resolve any go.sum entries for private modules
# discovered during compilation of local replace dependencies (packages/go-auth).
RUN --mount=type=secret,id=jfrog_token \
    JFROG_TOKEN=$(cat /run/secrets/jfrog_token) \
    GOPROXY="https://:${JFROG_TOKEN}@gdartifactory1.jfrog.io/artifactory/api/go/go-virt|direct" \
    GONOSUMDB="github.com/gdcorp-golang/*" \
    GOFLAGS="-mod=mod" \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app/server ./cmd/server

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
    -days 365 -nodes -subj "/CN=knowledge-service" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0" && \
    chmod 644 /app/certs/server.crt && \
    chmod 600 /app/certs/server.key && \
    chown 1000:1000 /app/certs/server.key /app/certs/server.crt

# Copy binary from builder
COPY --from=builder /app/server /app/server

# Run as non-root user (GCI base image already has user with UID 1000)
USER 1000

# Expose port
EXPOSE 8081

# Environment variables for server TLS
ENV SERVER_CERT_PATH=/app/certs/server.crt
ENV SERVER_KEY_PATH=/app/certs/server.key

# Health check - start-period aligned with Katana healthcheckGracePeriod (60s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8081/api/v1/health || exit 1

# Run the server
CMD ["/app/server"]
