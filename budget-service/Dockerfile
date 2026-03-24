# budget-service/Dockerfile
# Multi-stage build using GoDaddy Golden Container Images (GCI)
#
# =============================================================================
# GOLDEN CONTAINER IMAGE UPDATE GUIDE
# =============================================================================
# GoDaddy requires use of approved "golden" container images as base.
#
# To check available images and their deprecation/EOL dates:
#   aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | contains("golang"))'
#   aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | endswith("/alpine"))'
#
# Or browse: https://gcr.katana.int.gdcorp.tools/
#
# Current base images:
#   - Builder: alpine-golang:1.25-alpine-3.22 (Deprecation: 2026-08-01, EOL: 2026-10-30)
#   - Runtime: alpine:3.22 (Deprecation: 2027-05-01, EOL: 2027-07-30)
# =============================================================================

# Stage 1: Build - GoDaddy golden Go image
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine-golang:1.25-alpine-3.22 AS builder

WORKDIR /build

# Copy go mod files first for caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -ldflags '-extldflags "-static" -w -s' -o budget-service ./cmd/server

# Stage 2: Runtime - GoDaddy golden Alpine image
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine:3.22

# Switch to root for setup (GCI base image may run as non-root)
USER root

RUN apk --no-cache add ca-certificates

# Create non-root user for security
RUN addgroup -g 1000 budget && \
    adduser -u 1000 -G budget -s /bin/sh -D budget

WORKDIR /app

COPY --from=builder /build/budget-service /app/

# Create log directory with proper ownership
RUN mkdir -p /var/log/budget-service && \
    chown -R budget:budget /var/log/budget-service

EXPOSE 8080

# Run as non-root user
USER budget

ENTRYPOINT ["/app/budget-service"]
