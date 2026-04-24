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

# Detect PaaS allocations by matching productId against ^paas-.+.
# *** KEEP IN SYNC with container-scripts/preview/nomad_setup.sh ***
# Preview and publish are separate containers; no shared runtime source.
is_paas_flow() {
    if ! command -v jq >/dev/null 2>&1; then
        log_warn "is_paas_flow: jq missing; defaulting to AAB path"
        return 1
    fi

    local alloc_dir="${NOMAD_ALLOC_DIR:-/alloc}"
    local product_id=""
    local source="none"

    if [[ -f "${alloc_dir}/config.json" ]]; then
        product_id=$(jq -r '.PRODUCT_ID.VALUE // empty' "${alloc_dir}/config.json" 2>/dev/null || true)
        [[ -n "$product_id" ]] && source="alloc"
    fi

    # Fallback only when alloc yielded nothing — alloc is authoritative.
    if [[ -z "$product_id" && -f ".airo/config.json" ]]; then
        product_id=$(jq -r '.productId // empty' .airo/config.json 2>/dev/null || true)
        [[ -n "$product_id" ]] && source="airo"
    fi

    if [[ "$product_id" =~ ^paas-.+ ]]; then
        log "is_paas_flow: productId='${product_id}' source=${source} paas=true"
        return 0
    fi
    log "is_paas_flow: productId='${product_id}' source=${source} paas=false"
    return 1
}

# Load database credentials as environment variables
# Exports: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
load_database_environment_variables() {
    local config_path="${NOMAD_ALLOC_DIR}/config.json"
    if [[ ! -f "$config_path" ]]; then
        return 0
    fi

    # Check if DATABASE node exists
    if ! jq -e '.DATABASE' "$config_path" >/dev/null 2>&1; then
        return 0
    fi

    log "Loading database credentials from ${config_path}"
    export DB_HOST="$(jq -r '.DATABASE.VALUE.HOST // empty' "$config_path")"
    export DB_PORT="$(jq -r '.DATABASE.VALUE.PORT // "3306"' "$config_path")"
    export DB_NAME="$(jq -r '.DATABASE.VALUE.NAME // empty' "$config_path")"
    export DB_USER="$(jq -r '.DATABASE.VALUE.USERNAME // empty' "$config_path")"
    export DB_PASSWORD="$(jq -r '.DATABASE.VALUE.PASSWORD // empty' "$config_path")"
    log "Database credentials loaded"
}

# Load customer environment variables (SYSTEM_MANAGED=false only) from config.json and export each in the shell
load_customer_environment_variables() {
    if [[ ! -f "${NOMAD_ALLOC_DIR}/config.json" ]]; then
        return 0
    fi
    local config_path="${NOMAD_ALLOC_DIR}/config.json"
    if ! jq -e 'type == "object"' "$config_path" >/dev/null 2>&1; then
        log_warn "config.json is invalid or not a JSON object, skipping customer env load"
        return 0
    fi
    # Log keys with non-object values (wrong structure)
    while IFS= read -r key; do
        [[ -n "$key" ]] && log_warn "config.json: key '$key' has non-object value, skipping"
    done < <(jq -r 'to_entries[] | select(.value | type != "object") | .key' "$config_path" 2>/dev/null)
    # Log keys with SYSTEM_MANAGED=false but missing or non-string VALUE
    while IFS= read -r key; do
        [[ -n "$key" ]] && log_warn "config.json: key '$key' has SYSTEM_MANAGED=false but missing or non-string VALUE, skipping"
    done < <(jq -r 'to_entries[] | select(.value | type == "object" and .value.SYSTEM_MANAGED == false and (.value.VALUE == null or (.value.VALUE | type) != "string")) | .key' "$config_path" 2>/dev/null)
    log "Loading customer environment variables from ${config_path}"
    local tmp
    tmp=$(mktemp 2>/dev/null) || tmp="${TMPDIR:-/tmp}/customer-env.$$"
    if ! jq -rj 'to_entries[] | select(.value | type == "object" and .value.SYSTEM_MANAGED == false and .value.VALUE != null and (.value.VALUE | type) == "string") | "\(.key)\u0000\(.value.VALUE)\u0000"' "$config_path" > "$tmp" 2>/dev/null; then
        log_warn "jq failed to parse config.json or extract env entries, skipping"
        rm -f "$tmp"
        return 0
    fi
    while IFS= read -r -d '' key && IFS= read -r -d '' value; do
        if [[ ! "$key" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
            log_warn "config.json: skipping invalid env key: $key"
            continue
        fi
        if [[ -z "$value" || "$value" == "null" ]]; then
            log_warn "config.json: key '$key' has null or empty VALUE, skipping"
            continue
        fi
        export "$key=$value"
        log "Set env: ${key}=***"
    done < "$tmp"
    rm -f "$tmp"
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
