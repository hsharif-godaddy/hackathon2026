#!/bin/bash
# Common functions and constants shared across runner scripts

readonly APP_DIR="/app"

# Error handler
error_exit() {
    echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
    exit "${2:-1}"
}

# Log informational message
log() {
    echo "[INFO] $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Log warning message
log_warn() {
    echo "[WARN] $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

# Create .env file for runtime configuration
create_env_file() {
    local dist_dir="$1"
    log "Creating .env file for runtime configuration"
    cat <<-EOF > "${dist_dir}/.env"
SERVER_HOST=0.0.0.0
SERVER_PORT=${PORT:-20000}
EOF
    log "Environment configuration: HOST=0.0.0.0 PORT=${PORT:-20000}"
}
