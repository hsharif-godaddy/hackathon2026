#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-dev}"

case "$ENV" in
  dev)
    AWS_PROFILE="airobuild-dev-private-sso"
    ;;
  prod)
    AWS_PROFILE="airobuild-prod-sso"
    ;;
  *)
    echo "Usage: $0 [dev|prod]" >&2
    exit 1
    ;;
esac

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

SECRET_NAME="essp_deployment_credentials"
CREDS_FILE="/tmp/essp-creds-${ENV}.env"
QUERY_SCRIPT="/tmp/essp-query-${ENV}.sh"

echo "Fetching ESSP credentials from ${ENV} (profile: ${AWS_PROFILE})..."

if ! SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_NAME" \
  --profile "$AWS_PROFILE" \
  --region us-west-2 \
  --query SecretString \
  --output text); then
  echo "Error: Failed to fetch secret '${SECRET_NAME}' from AWS Secrets Manager." >&2
  echo "Please verify that:" >&2
  echo "  - You are logged in: aws sso login --profile ${AWS_PROFILE}" >&2
  echo "  - The profile has permissions to access the secret in us-west-2" >&2
  exit 1
fi

ES_ENDPOINT=$(echo "$SECRET_JSON" | jq -r '.ingestion_url')
ES_USER=$(echo "$SECRET_JSON" | jq -r '.ingestion_user')
ES_PASSWORD=$(echo "$SECRET_JSON" | jq -r '.ingestion_user_password')

if [ -z "$ES_ENDPOINT" ] || [ "$ES_ENDPOINT" = "null" ]; then
  echo "Error: Failed to extract ingestion_url from secret" >&2
  exit 1
fi

if [ -z "$ES_USER" ] || [ "$ES_USER" = "null" ]; then
  echo "Error: Failed to extract ingestion_user from secret" >&2
  exit 1
fi

if [ -z "$ES_PASSWORD" ] || [ "$ES_PASSWORD" = "null" ]; then
  echo "Error: Failed to extract ingestion_user_password from secret" >&2
  exit 1
fi

# Write credentials to env file (mode 600 - owner only)
cat > "$CREDS_FILE" <<EOF
ES_ENDPOINT=${ES_ENDPOINT}
ES_USER=${ES_USER}
ES_PASSWORD=${ES_PASSWORD}
EOF
chmod 600 "$CREDS_FILE"

# Create query wrapper script
cat > "$QUERY_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail

CREDS_FILE="${CREDS_FILE}"
EOF

cat >> "$QUERY_SCRIPT" <<'WRAPPER'

if [ ! -f "$CREDS_FILE" ]; then
  echo "Error: Credentials file not found at $CREDS_FILE" >&2
  echo "Run essp-creds.sh first to fetch credentials." >&2
  exit 1
fi

source "$CREDS_FILE"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <path> [curl args...]" >&2
  echo "Examples:" >&2
  echo "  $0 /_cat/indices?v" >&2
  echo "  $0 /llm_spend_model_daily/_search -d '{\"query\":{\"match_all\":{}}}'" >&2
  exit 1
fi

ES_PATH="$1"
shift

# Strip leading slash if present to avoid double-slash
ES_PATH="${ES_PATH#/}"

exec curl -s -H "Content-Type: application/json" -u "${ES_USER}:${ES_PASSWORD}" "${ES_ENDPOINT}/${ES_PATH}" "$@"
WRAPPER
chmod 755 "$QUERY_SCRIPT"

echo ""
echo "Credentials written to: ${CREDS_FILE}"
echo "Query wrapper created:  ${QUERY_SCRIPT}"
echo ""
echo "Usage:"
echo "  ${QUERY_SCRIPT} /_cat/indices?v"
echo "  ${QUERY_SCRIPT} /llm_spend_model_daily/_search -d '{\"query\":{\"match_all\":{}}}'"
echo ""
echo "Or source the env file:"
echo "  source ${CREDS_FILE}"
