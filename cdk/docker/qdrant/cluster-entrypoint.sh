#!/bin/bash
set -eo pipefail

# =============================================================================
# Qdrant Cluster Entrypoint (ECS Fargate — Two-Service Model)
# =============================================================================
# Mirrors the official Qdrant Docker Compose cluster generator:
#   Node 0 (seed):    ./qdrant --uri 'http://qdrant_node_0:6335'
#   Node N (worker):  sleep && ./qdrant --bootstrap 'http://qdrant_node_0:6335'
#
# On ECS Fargate, two separate services replace Docker Compose service names:
#   - qdrant-seed service (1 task):  stable FQDN for bootstrap
#   - qdrant service (N-1 tasks):    workers that join via seed FQDN
#
# TLS follows the official test config (tests/e2e_tests/tls_cluster/):
#   service.enable_tls: true      — HTTPS on ports 6333/6334
#   cluster.p2p.enable_tls: false — plaintext on port 6335
#   tls.ca_cert: set              — required by v1.16.3 even with p2p off
#
# Environment Variables:
#   QDRANT_NODE_ROLE      - "seed" or "worker" (set by CDK per service)
#   QDRANT_SEED_FQDN      - Seed node FQDN for bootstrap (workers only)
#   QDRANT_ENABLE_TLS     - Set to "true" to enable service TLS
#   QDRANT_TLS_SECRET_ARN - Secrets Manager secret ID (name or ARN) for TLS cert
#   AWS_REGION            - AWS region (defaults to us-west-2)
# =============================================================================

AWS_REGION="${AWS_REGION:-us-west-2}"

echo "============================================"
echo "Qdrant Cluster Entrypoint"
echo "Role: ${QDRANT_NODE_ROLE:-unknown}"
echo "Seed FQDN: ${QDRANT_SEED_FQDN:-N/A}"
echo "TLS Enabled: ${QDRANT_ENABLE_TLS:-false}"
echo "============================================"

# -----------------------------------------------------------------------------
# TLS Certificate Setup
# -----------------------------------------------------------------------------
setup_tls() {
    if [ "${QDRANT_ENABLE_TLS}" != "true" ]; then
        echo "TLS not enabled, skipping certificate setup"
        return 0
    fi

    if [ -z "${QDRANT_TLS_SECRET_ARN}" ]; then
        echo "ERROR: QDRANT_TLS_SECRET_ARN is required when TLS is enabled"
        return 1
    fi

    echo "Fetching TLS certificate from Secrets Manager..."

    if ! SECRET_VALUE=$(aws secretsmanager get-secret-value \
        --secret-id "${QDRANT_TLS_SECRET_ARN}" \
        --region "${AWS_REGION}" \
        --query 'SecretString' \
        --output text 2>/dev/null); then
        echo "ERROR: Failed to fetch TLS secret from Secrets Manager"
        return 1
    fi

    if [ -z "${SECRET_VALUE}" ] || [ "${SECRET_VALUE}" = "null" ]; then
        echo "ERROR: TLS secret is empty or null"
        return 1
    fi

    mkdir -p /qdrant/tls
    chmod 700 /qdrant/tls

    CERT=$(echo "$SECRET_VALUE" | jq -r '.crt // empty')
    CHAIN=$(echo "$SECRET_VALUE" | jq -r '.chain // empty')
    KEY=$(echo "$SECRET_VALUE" | jq -r '.key // empty')

    if [ -z "$CERT" ] || [ -z "$KEY" ]; then
        echo "ERROR: TLS secret missing 'crt' or 'key' fields"
        return 1
    fi

    if [ -n "$CHAIN" ]; then
        printf '%s\n%s\n' "$CERT" "$CHAIN" > /qdrant/tls/cert.pem
    else
        printf '%s\n' "$CERT" > /qdrant/tls/cert.pem
    fi
    printf '%s\n' "$KEY" > /qdrant/tls/key.pem

    # ca_cert required by v1.16.3 when service TLS is on (even with p2p TLS off)
    if [ -n "$CHAIN" ]; then
        printf '%s\n' "$CHAIN" > /qdrant/tls/cacert.pem
    else
        printf '%s\n' "$CERT" > /qdrant/tls/cacert.pem
    fi

    chmod 644 /qdrant/tls/cert.pem /qdrant/tls/cacert.pem
    chmod 600 /qdrant/tls/key.pem

    # Match official TLS test config: service TLS on, p2p TLS off
    export QDRANT__SERVICE__ENABLE_TLS=true
    export QDRANT__TLS__CERT=/qdrant/tls/cert.pem
    export QDRANT__TLS__KEY=/qdrant/tls/key.pem
    export QDRANT__TLS__CA_CERT=/qdrant/tls/cacert.pem

    echo "TLS configured (service TLS on, p2p TLS off)"
}

# -----------------------------------------------------------------------------
# Start Qdrant
# -----------------------------------------------------------------------------
start_qdrant() {
    if [ "${QDRANT_NODE_ROLE}" = "seed" ]; then
        echo "Starting as SEED node..."
        echo "URI: http://${QDRANT_SEED_FQDN}:6335"
        exec ./qdrant --uri "http://${QDRANT_SEED_FQDN}:6335"
    fi

    # Worker: wait for seed to become healthy
    if [ -z "${QDRANT_SEED_FQDN}" ]; then
        echo "ERROR: QDRANT_SEED_FQDN is required for worker nodes"
        exit 1
    fi

    local probe_proto="http"
    if [ "${QDRANT_ENABLE_TLS}" = "true" ]; then
        probe_proto="https"
    fi

    echo "Waiting for seed node at ${QDRANT_SEED_FQDN}..."
    local max_attempts=60  # 5 minutes (60 * 5s)
    local attempt=0
    until curl -sfk --connect-timeout 3 --max-time 5 \
        "${probe_proto}://${QDRANT_SEED_FQDN}:6333/healthz" >/dev/null 2>&1; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge "$max_attempts" ]; then
            echo "ERROR: Seed never became healthy after ${max_attempts} attempts. Exiting."
            exit 1
        fi
        echo "Seed not ready (attempt ${attempt}/${max_attempts})..."
        sleep 5
    done

    # Give seed's Raft consensus time to fully initialize after healthz returns OK
    echo "Seed is healthy. Waiting 10s for Raft consensus to stabilize..."
    sleep 10

    echo "Joining cluster..."
    exec ./qdrant --bootstrap "http://${QDRANT_SEED_FQDN}:6335"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if ! setup_tls; then
    echo "ERROR: TLS setup failed"
    exit 1
fi

start_qdrant
