# Build stage - using GoDaddy golden container image
# Check available tags: aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | test("alpine-golang"))'
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine-golang:1.25-alpine AS builder

# Switch to root for build operations (GCI base image runs as non-root)
USER root

WORKDIR /app

# Copy go mod files first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

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
    chmod 644 /app/certs/server.key

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
