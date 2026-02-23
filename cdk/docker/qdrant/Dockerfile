# Qdrant Vector Database - Custom Image for ECS Fargate Cluster
# Multi-stage build using GoDaddy golden container images
#
# =============================================================================
# GOLDEN CONTAINER IMAGE UPDATE GUIDE
# =============================================================================
# GoDaddy requires use of approved "golden" container images as base.
#
# To check available images and their deprecation/EOL dates:
#   aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | contains("debian"))'
#
# Or browse: https://gcr.katana.int.gdcorp.tools/
#
# Current base image: debian:bookworm-slim
#   - Deprecation: 2026-06-10
#   - EOL: 2026-09-08
#
# When updating, ensure the new base is glibc-compatible (Debian/Ubuntu),
# as the Qdrant binary has glibc dependencies (libunwind, libstdc++, etc.)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Source - Extract binary and assets from official Qdrant image
# -----------------------------------------------------------------------------
FROM qdrant/qdrant:v1.13.2 AS qdrant-source

# -----------------------------------------------------------------------------
# Stage 2: Runtime - GoDaddy golden Debian image
# -----------------------------------------------------------------------------
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/debian:bookworm-slim

# Switch to root for package installation (GCI base image runs as non-root)
USER root

# Install runtime dependencies
# - dnsutils: provides 'dig' for DNS lookups in cluster entrypoint
# - libunwind8: required by qdrant binary
# - ca-certificates: for HTTPS connections
# - curl: for health checks
# Note: GCI base image may be missing apt lists directory, create it first
RUN mkdir -p /var/lib/apt/lists/partial && \
    apt-get update && apt-get install -y --no-install-recommends \
    dnsutils \
    libunwind8 \
    ca-certificates \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create qdrant user (matching upstream UID 1000)
RUN groupadd -g 1000 qdrant && \
    useradd -u 1000 -g qdrant -m -s /bin/bash qdrant

# Create qdrant directory structure
RUN mkdir -p /qdrant/storage /qdrant/snapshots && \
    chown -R qdrant:qdrant /qdrant

WORKDIR /qdrant

# Copy qdrant binary and assets from official image
COPY --from=qdrant-source --chown=qdrant:qdrant /qdrant/qdrant /qdrant/qdrant
COPY --from=qdrant-source --chown=qdrant:qdrant /qdrant/config /qdrant/config
COPY --from=qdrant-source --chown=qdrant:qdrant /qdrant/static /qdrant/static

# Copy custom cluster entrypoint
COPY --chown=qdrant:qdrant cluster-entrypoint.sh /qdrant/cluster-entrypoint.sh
RUN chmod +x /qdrant/cluster-entrypoint.sh

# Switch to non-root user
USER qdrant:qdrant

# Qdrant ports
# 6333 - REST API & Dashboard
# 6334 - gRPC API
# 6335 - Cluster/Raft communication
EXPOSE 6333 6334 6335

# Health check - uses /healthz per Qdrant monitoring docs
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:6333/healthz || exit 1

ENTRYPOINT ["/qdrant/cluster-entrypoint.sh"]
