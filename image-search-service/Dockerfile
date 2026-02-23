# Build stage
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/gd-golang:1.25-alpine AS builder

WORKDIR /app

# Copy go mod files first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary with optimizations for smaller, reproducible builds
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app/server ./cmd/server

# Runtime stage
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/gd-alpine:3.20

WORKDIR /app

# Install CA certificates for HTTPS calls and wget for health checks
RUN apk --no-cache add ca-certificates wget

# Copy binary from builder
COPY --from=builder /app/server /app/server

# Run as non-root user
RUN adduser -D -u 1000 appuser
USER appuser

# Expose port
EXPOSE 8080

# Health check - start-period aligned with Katana healthcheckGracePeriod (60s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/v1/health || exit 1

# Run the server
CMD ["/app/server"]
