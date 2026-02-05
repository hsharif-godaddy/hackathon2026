#!/bin/sh

# Detection script for conditional process startup
# Exit 0 = defer start (restart scenario)
# Exit 1 = start immediately (first boot scenario)

# Validate CUSTOMER_APP_DIR is set
if [ -z "$CUSTOMER_APP_DIR" ]; then
    echo "ERROR: CUSTOMER_APP_DIR environment variable is not set"
    exit 127  # Fatal error - script cannot execute
fi

# Check if .git/config exists (indicates app has been initialized)
if [ ! -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    echo "Fresh pre-prov creation detected: .git/config does not exist"
    exit 1  # Start immediately
fi

# If we reach here, .git/config exists → this is a restart
echo "Restart detected: .git/config exists"
exit 0  # Defer start (wait for first HTTP request)
