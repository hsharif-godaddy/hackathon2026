#!/bin/sh
set -e

# This script runs as root to fix permissions on bind-mounted directories
# then switches to the agent user to run the actual application

echo "🔧 Fixing permissions on bind-mounted directories..."

# Fix ownership and permissions on socket directory (bind mounted from host)
if [ -d "/tmp/supervisor" ]; then
    chown -R agent:agent /tmp/supervisor
    chmod -R 755 /tmp/supervisor
    echo "✅ Socket directory permissions fixed"
else
    echo "⚠️ Socket directory not found, creating it"
    mkdir -p /tmp/supervisor
    chown -R agent:agent /tmp/supervisor
    chmod -R 755 /tmp/supervisor
fi

# Fix ownership on logs directory if it exists
if [ -d "/app/logs" ]; then
    chown -R agent:agent /app/logs
    echo "✅ Logs directory permissions fixed"
fi

# Ensure agent user owns the app directory contents (important for bind mounts)
chown -R agent:agent /app
echo "✅ App directory ownership fixed"

echo "🚀 Switching to agent user and starting dev-supervisor..."

# Switch to agent user and execute the original command
exec gosu agent "$@"