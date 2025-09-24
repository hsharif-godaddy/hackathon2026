#!/bin/sh
set -e

# This script runs as root to fix permissions on bind-mounted directories
# then switches to the agent user to run the actual application

echo "🔧 Setting up user permissions and bind-mounted directories..."

# Get the current agent user's UID/GID
AGENT_UID=$(id -u agent)
AGENT_GID=$(id -g agent)
echo "📋 Agent user configured with UID=${AGENT_UID}, GID=${AGENT_GID}"

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
# This is crucial for files created by the host user to be editable by the container user
echo "🔄 Fixing ownership of /app directory..."
chown -R agent:agent /app
echo "✅ App directory ownership fixed"

# Ensure the agent user has a proper home directory with correct permissions
if [ ! -d "/home/agent" ]; then
    mkdir -p /home/agent
fi
chown -R agent:agent /home/agent
echo "✅ Agent home directory permissions fixed"

echo "🚀 Switching to agent user (UID=${AGENT_UID}, GID=${AGENT_GID}) and starting dev-supervisor..."

# Switch to agent user and execute the original command
exec gosu agent "$@"