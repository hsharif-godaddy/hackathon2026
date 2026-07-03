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

# Emit a structured JSON event line on stdout. Picked up by the container log
# collector alongside the plain `log` / `log_warn` output, but carries an
# `event` field so Grafana/Loki can filter by event name — the plain-text
# [INFO]/[ERROR] lines above are not queryable that way.
#
# Usage: log_event <event> <level> [data_json]
#   event      dotted event name, e.g. "paas.run.config-loaded"
#   level      "info" | "warn" | "error"
#   data_json  optional RFC-8259 JSON *object* literal (already including
#              braces) — callers can pass `{}` or omit it entirely.
# Values inside data_json that come from shell variables must be
# JSON-escaped by the caller. For common cases (strings that don't contain
# quotes/backslashes/control chars) this is fine; for anything else use jq
# at the call site.
log_event() {
    local event="$1"
    local level="${2:-info}"
    local data="${3:-}"
    # Callers that pass `$(jq ...)` output can hand us an explicit empty string
    # when jq fails; `${3:-}` doesn't help there. Normalize to `{}` so we never
    # emit `"data":` (invalid JSON — Loki drops it to unqueryable text).
    [[ -z "$data" ]] && data='{}'
    # Seconds precision only — the publish container is node:*-alpine, whose
    # BusyBox `date` does not implement GNU's `%N` / `%<width>N` and silently
    # drops the format char *plus trailing literals*, leaving a dangling `.`
    # and no `Z`. Loki supplies its own ingest timestamp at nanosecond
    # resolution, so client-side ms precision isn't load-bearing.
    printf '{"event":"%s","level":"%s","timestamp":"%s","data":%s}\n' \
        "$event" "$level" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$data"
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

# Check whether the Nomad allocation config is present. Sets global
# CONFIG_EXISTS to "true"/"false" and returns 0 if found, 1 otherwise.
check_nomad_config() {
    local config_path="${NOMAD_ALLOC_DIR:-/alloc}/config.json"
    if [[ -f "$config_path" ]]; then
        log "Nomad allocation config found at ${config_path}"
        CONFIG_EXISTS=true
        return 0
    fi
    log_warn "Nomad allocation config not found at ${config_path}. Proceeding without it."
    CONFIG_EXISTS=false
    return 1
}

# Detect package manager by lockfile. Caller passes a prioritized space-separated
# list (e.g. "npm pnpm" or "pnpm yarn npm"). Sets global PACKAGE_MANAGER, verifies
# the binary is on PATH, and logs its version. Errors if no lockfile matches or
# the detected manager is missing.
detect_package_manager() {
    local supported="$1"
    local pm
    PACKAGE_MANAGER=""
    for pm in $supported; do
        case "$pm" in
            pnpm)
                if [[ -f pnpm-lock.yaml ]]; then
                    PACKAGE_MANAGER=pnpm
                    log "Found pnpm-lock.yaml"
                    break
                fi
                ;;
            yarn)
                if [[ -f yarn.lock ]]; then
                    PACKAGE_MANAGER=yarn
                    log "Found yarn.lock"
                    break
                fi
                ;;
            npm)
                if [[ -f package-lock.json ]]; then
                    PACKAGE_MANAGER=npm
                    log "Found package-lock.json"
                    break
                fi
                ;;
            *)
                error_exit "detect_package_manager: unsupported pm '$pm' in supported list"
                ;;
        esac
    done
    if [[ -z "$PACKAGE_MANAGER" ]]; then
        error_exit "No supported lockfile found (expected one of: $supported)"
    fi
    if ! command -v "$PACKAGE_MANAGER" >/dev/null 2>&1; then
        error_exit "$PACKAGE_MANAGER command not found. Ensure $PACKAGE_MANAGER is installed."
    fi
    log "$PACKAGE_MANAGER version: $($PACKAGE_MANAGER --version)"
}

lockfile_present() {
    [[ -f pnpm-lock.yaml || -f yarn.lock || -f package-lock.json ]]
}

# Sets PACKAGE_MANAGER. Call only when install recovery or pm start fallback needs it.
resolve_package_manager() {
    local airo_config="${1:-.airo/config.json}"
    local pm=""

    if [[ -f "$airo_config" ]] && jq -e '.' "$airo_config" >/dev/null 2>&1; then
        pm=$(jq -r '.runtime.packageManager // empty' "$airo_config")
    fi

    if [[ -z "$pm" && -f package.json ]]; then
        # Corepack "packageManager" field uses <pm>@<version> (e.g. pnpm@9.1.0).
        pm=$(jq -r '.packageManager // empty' package.json | sed 's/@.*//')
    fi

    if [[ -n "$pm" ]]; then
        case "$pm" in
            pnpm|yarn|npm) ;;
            *) error_exit "PaaS: unsupported package manager: $pm (expected npm, yarn, or pnpm)" ;;
        esac
        if ! command -v "$pm" >/dev/null 2>&1; then
            error_exit "$pm command not found. Ensure $pm is installed."
        fi
        PACKAGE_MANAGER="$pm"
        log "Resolved package manager: $pm"
        return 0
    fi

    detect_package_manager "pnpm yarn npm"
}

# Validate the archive and distribution directory, extract to $APP_DIR, then cd.
# Requires globals: DIST_DIR, ARCHIVE_PATH, APP_DIR.
process_archive() {
    [[ ! -d "$DIST_DIR" ]] && error_exit "Distribution directory not found: $DIST_DIR"
    [[ ! -f "$ARCHIVE_PATH" ]] && error_exit "Archive file not found: $ARCHIVE_PATH"
    [[ ! -r "$ARCHIVE_PATH" ]] && error_exit "Archive file is not readable: $ARCHIVE_PATH"

    log "Archive path: $ARCHIVE_PATH"
    log "Archive size: $(ls -lhL "$ARCHIVE_PATH" | awk '{print $5}')"

    log "Extracting archive to: $APP_DIR"
    local extract_start_ms extract_end_ms extract_duration_ms tar_err
    extract_start_ms=$(($(date +%s%N)/1000000))
    if ! tar_err=$(tar zxf "$ARCHIVE_PATH" -C "$APP_DIR" 2>&1); then
        error_exit "Failed to extract archive: $tar_err"
    fi
    extract_end_ms=$(($(date +%s%N)/1000000))
    extract_duration_ms=$((extract_end_ms - extract_start_ms))
    log "Archive extracted successfully, extractDurationMs=${extract_duration_ms}"

    cd "$APP_DIR" || error_exit "Failed to change directory to $APP_DIR"
    log "Changed to app directory: $APP_DIR"
}

# Load database credentials as environment variables
# Exports: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
load_database_environment_variables() {
    local config_path="${NOMAD_ALLOC_DIR:-/alloc}/config.json"
    if [[ ! -f "$config_path" ]]; then
        return 0
    fi

    # Check if DATABASE node exists. Missing is not fatal — apps without a DB
    # attachment are valid; just warn so the absence is visible in logs.
    if ! jq -e '.DATABASE' "$config_path" >/dev/null 2>&1; then
        log_warn "No DATABASE node found in ${config_path}; skipping DB credential export"
        return 0
    fi

    log "Loading database credentials from ${config_path}"
    # Assign then export: `export VAR=$(cmd)` always returns 0 (export's exit code),
    # hiding jq failures under set -e. Split so a jq parse error fails loudly
    # instead of silently exporting empty credentials.
    local db_host db_port db_name db_user db_password
    db_host=$(jq -r '.DATABASE.VALUE.HOST // empty' "$config_path") || error_exit "Failed to read DB_HOST from ${config_path}"
    db_port=$(jq -r '.DATABASE.VALUE.PORT // "3306"' "$config_path") || error_exit "Failed to read DB_PORT from ${config_path}"
    db_name=$(jq -r '.DATABASE.VALUE.NAME // empty' "$config_path") || error_exit "Failed to read DB_NAME from ${config_path}"
    db_user=$(jq -r '.DATABASE.VALUE.USERNAME // empty' "$config_path") || error_exit "Failed to read DB_USER from ${config_path}"
    db_password=$(jq -r '.DATABASE.VALUE.PASSWORD // empty' "$config_path") || error_exit "Failed to read DB_PASSWORD from ${config_path}"

    # Fail early if .DATABASE is declared but required fields are empty —
    # otherwise migrations would run with empty creds and fail with a cryptic
    # connection error. Catches infra misconfig in test/staging before prod.
    [[ -n "$db_host" ]] || error_exit "DATABASE.VALUE.HOST missing or empty in ${config_path}"
    [[ -n "$db_name" ]] || error_exit "DATABASE.VALUE.NAME missing or empty in ${config_path}"
    [[ -n "$db_user" ]] || error_exit "DATABASE.VALUE.USERNAME missing or empty in ${config_path}"
    [[ -n "$db_password" ]] || error_exit "DATABASE.VALUE.PASSWORD missing or empty in ${config_path}"

    export DB_HOST="$db_host"
    export DB_PORT="$db_port"
    export DB_NAME="$db_name"
    export DB_USER="$db_user"
    export DB_PASSWORD="$db_password"
    log "Database credentials loaded"
}

# Load customer environment variables (SYSTEM_MANAGED=false only) from config.json and export each in the shell
load_customer_environment_variables() {
    local config_path="${NOMAD_ALLOC_DIR:-/alloc}/config.json"
    if [[ ! -f "$config_path" ]]; then
        return 0
    fi
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
