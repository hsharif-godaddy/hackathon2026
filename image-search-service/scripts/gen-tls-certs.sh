#!/bin/bash
# Generate self-signed TLS certificates for local Qdrant development
# Certificates are written to ./tls/ (gitignored)
set -e

TLS_DIR="$(cd "$(dirname "$0")/.." && pwd)/tls"
mkdir -p "$TLS_DIR"

# Skip if certs already exist and aren't expired
if [ -f "$TLS_DIR/cert.pem" ] && [ -f "$TLS_DIR/key.pem" ]; then
    if openssl x509 -checkend 86400 -noout -in "$TLS_DIR/cert.pem" 2>/dev/null; then
        echo "TLS certs already exist and are valid, skipping generation"
        exit 0
    fi
    echo "TLS certs expired, regenerating..."
fi

echo "Generating self-signed TLS certificates in $TLS_DIR..."

openssl req -x509 -newkey rsa:2048 \
    -keyout "$TLS_DIR/key.pem" \
    -out "$TLS_DIR/cert.pem" \
    -days 365 \
    -nodes \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,DNS:qdrant,IP:127.0.0.1"

chmod 644 "$TLS_DIR/cert.pem"
chmod 600 "$TLS_DIR/key.pem"

echo "TLS certificates generated:"
echo "  cert: $TLS_DIR/cert.pem"
echo "  key:  $TLS_DIR/key.pem"
