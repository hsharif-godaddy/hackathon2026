#!/bin/bash
set -e

# Cluster FQDN from environment (set by CDK)
QDRANT_CLUSTER_FQDN="${QDRANT_CLUSTER_FQDN:-qdrant.dev.airo.local}"

echo "============================================"
echo "Qdrant Cluster Entrypoint"
echo "Cluster FQDN: ${QDRANT_CLUSTER_FQDN}"
echo "============================================"

echo "Performing DNS lookup for ${QDRANT_CLUSTER_FQDN}..."

if DNS_RESULT=$(dig +short "$QDRANT_CLUSTER_FQDN" A 2>/dev/null) && [ -n "$DNS_RESULT" ]; then
    RECORD_COUNT=$(echo "$DNS_RESULT" | grep -cE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' 2>/dev/null || echo 0)

    if [ "$RECORD_COUNT" -eq 0 ]; then
        echo "No valid IP records found."
        echo "Bootstrapping NEW Qdrant cluster..."
        exec ./qdrant --bootstrap "http://${QDRANT_CLUSTER_FQDN}:6335"
    else
        echo "Found ${RECORD_COUNT} DNS record(s)."
        echo "Joining EXISTING cluster..."
        exec ./qdrant --uri "http://${QDRANT_CLUSTER_FQDN}:6335"
    fi
else
    echo "DNS lookup failed or returned empty result."
    echo "Bootstrapping NEW Qdrant cluster..."
    exec ./qdrant --bootstrap "http://${QDRANT_CLUSTER_FQDN}:6335"
fi
