#!/usr/bin/env bash
# One-shot: active AWS identity → mint IAM JWT → GET /api/v1/auth-check.
# Run from repo root: ./scripts/verify-iam-auth.sh
#   or: make verify-iam-auth AWS_PROFILE=your-sso-profile
#
# Prereq: valid AWS creds (e.g. aws sso login --profile …). .env in cwd is loaded by
#         cmd/mint-iam-jwt via godotenv (set SSO_HOST to match the running server).
# Server: LOCAL_AUTH_DISABLE must be off and AUTH_ALLOWED_ROLES must include the minted sub.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

URL="${BUDGET_SERVICE_URL:-http://127.0.0.1:8080}"
PROFILE="${AWS_PROFILE:-}"
ASSUME_ROLE_ARN=""

usage() {
  echo "Usage: $0 [-p profile] [-u baseUrl] [-r roleArnToAssume]
  -p, --profile NAME     export AWS_PROFILE before cred check / mint (e.g. SSO profile)
  -u, --url URL          budget-service base (default: \$BUDGET_SERVICE_URL or http://127.0.0.1:8080)
  -r, --assume-role ARN  aws sts assume-role first (source: current profile/chain; then use temp keys for mint)
  -h, --help             this text"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--profile)
      PROFILE="${2:?}"
      shift 2
      ;;
    -u|--url)
      URL="${2:?}"
      shift 2
      ;;
    -r|--assume-role)
      ASSUME_ROLE_ARN="${2:?}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "verify-iam-auth: unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -n "$PROFILE" ]]; then
  export AWS_PROFILE="$PROFILE"
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "verify-iam-auth: aws CLI is required" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "verify-iam-auth: go is required" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "verify-iam-auth: curl is required" >&2
  exit 1
fi

if [[ -n "$ASSUME_ROLE_ARN" ]]; then
  _OIFS=$IFS
  IFS=$'\t' read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN < <(aws sts assume-role \
    --role-arn "$ASSUME_ROLE_ARN" \
    --role-session-name "verify-iam-auth-$$" \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
    --output text) || {
    IFS=$_OIFS
    echo "verify-iam-auth: assume-role failed. Source profile/role must be allowed to assume $ASSUME_ROLE_ARN" >&2
    exit 1
  }
  IFS=$_OIFS
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  unset AWS_PROFILE
fi

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "verify-iam-auth: no AWS credentials. Run: aws sso login --profile <name> (then re-run with -p or export AWS_PROFILE)" >&2
  exit 1
fi

echo "=== sts get-caller-identity"
aws sts get-caller-identity
echo
echo "=== mint IAM JWT (go run ./cmd/mint-iam-jwt; uses .env in $ROOT for SSO_HOST)"
TOKEN=$(go run ./cmd/mint-iam-jwt)
echo
path="/api/v1/auth-check"
echo "=== GET ${URL}${path}"
if command -v jq >/dev/null 2>&1; then
  curl -sS -f -H "Authorization: Bearer ${TOKEN}" "${URL}${path}" | jq .
else
  curl -sS -f -H "Authorization: Bearer ${TOKEN}" "${URL}${path}"
  echo
fi
echo "verify-iam-auth: ok"
echo
echo "=== JWT (copy for Authorization: Bearer or: export TOKEN=<paste>)"
printf '%s\n' "$TOKEN"
