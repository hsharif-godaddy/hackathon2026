#!/bin/sh

# Setup certificates from environment variables
# This script supports two ways to provide Getty API certificates:
#   1. GETTY_CERT and GETTY_KEY - Individual certificate content (preferred)
#   2. Pre-mounted certificate files in /app/proxy/certs/

set -e

CERTS_DIR="/app/proxy/certs"

echo "[SETUP] Setting up Getty certificates..."

# Create certs directory
mkdir -p "$CERTS_DIR"

if [ -n "$GETTY_CERT" ] && [ -n "$GETTY_KEY" ]; then
    echo "[SETUP] GETTY_CERT and GETTY_KEY found, creating certificate files..."
    
    # Write certificate content directly from environment variables
    echo "$GETTY_CERT" > "$CERTS_DIR/getty-client.crt"
    echo "[SETUP] Certificate file created: $CERTS_DIR/getty-client.crt"
    
    echo "$GETTY_KEY" > "$CERTS_DIR/getty-client.key"
    echo "[SETUP] Key file created: $CERTS_DIR/getty-client.key"
    
    # Set proper permissions
    chmod 644 "$CERTS_DIR/getty-client.crt"
    chmod 600 "$CERTS_DIR/getty-client.key"
    
    echo "[SETUP] Certificate setup completed successfully"
else
    echo "[SETUP] No certificate environment variables provided - checking for existing certificates..."
    
    if [ -f "$CERTS_DIR/getty-client.crt" ] && [ -f "$CERTS_DIR/getty-client.key" ]; then
        echo "[SETUP] Found existing certificate files"
    else
        echo "[ERROR] No certificates found. Please provide one of:"
        echo "  - GETTY_CERT and GETTY_KEY (individual certificate content)"
        echo "  - Mount certificate files to $CERTS_DIR/"
        exit 1
    fi
fi

echo "[SETUP] Certificate setup completed"
