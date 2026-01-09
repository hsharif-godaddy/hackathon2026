# Build stage
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

# Build binary with static linking for Alpine
RUN CGO_ENABLED=0 GOOS=linux go build -a -ldflags '-extldflags "-static" -w -s' -o dev-supervisor .

# Final stage - minimal Alpine image suitable for copying binary from
FROM alpine:3.22

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Create directories with proper permissions
RUN mkdir -p /tmp/supervisor && chmod 755 /tmp/supervisor

# Copy binary from builder stage
COPY --from=builder /build/dev-supervisor /usr/local/bin/dev-supervisor
RUN chmod +x /usr/local/bin/dev-supervisor

# Set default socket paths for when used standalone
ENV AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH=/tmp/supervisor/dev-supervisor-preview.sock
ENV AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH=/tmp/supervisor/dev-supervisor-publish.sock
ENV DEV_SUPERVISOR_SOCKET_PATH=/tmp/supervisor/dev-supervisor.sock

# This image is primarily used as a source for COPY --from in app templates
# But it can also be run standalone for testing
ENTRYPOINT ["/usr/local/bin/dev-supervisor"]
