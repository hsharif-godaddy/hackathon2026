#!/bin/sh

# Exit on any error
set -e

# Check if API_SECRET is set
if [ -z "$API_SECRET" ]; then
    echo "ERROR: API_SECRET environment variable is not set"
    echo "Please set API_SECRET to your OpenAI API key"
    echo "API_SECRET is set to dummy key"
    API_SECRET="dummy"
fi

echo "Starting nginx proxy with API secret configuration..."

# Substitute environment variables in nginx configuration
envsubst '${API_SECRET}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Validate nginx configuration
nginx -t

echo "Nginx configuration validated successfully"
echo "Starting nginx..."

# Execute the main command
exec "$@"
