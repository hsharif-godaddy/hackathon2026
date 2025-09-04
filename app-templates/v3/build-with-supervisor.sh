#!/bin/bash

# Build script for V3 template with dev-supervisor
set -e

echo "🔨 Building dev-supervisor..."

# Check if we're in the right directory
if [ ! -f "../../dev-supervisor/Makefile" ]; then
    echo "❌ Error: dev-supervisor not found. Make sure you're running this from app-templates/v3/"
    exit 1
fi

# Build dev-supervisor
cd ../../dev-supervisor
make build
cd -

echo "✅ dev-supervisor built successfully"

echo "🐳 Building Docker image with dev-supervisor..."

# Build the Docker image
docker build -f Dockerfile.dev -t v3-app-template:dev .

echo "✅ Docker image built successfully"
echo ""
echo "🚀 To run the container:"
echo "   docker-compose -f docker-compose.dev.yml up"
echo ""
echo "📡 To interact with dev-supervisor:"
echo "   curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock http://localhost/health"
echo "   curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock http://localhost/info"
echo ""
echo "🔍 To check process status:"
echo "   curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock http://localhost/process/status"