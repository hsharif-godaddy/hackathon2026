#!/usr/bin/env bash
# Sync cost-attribution classifier corpora from the offline ML S3 bucket into
# ./training and ./verification (same layout as under the S3 prefix).
#
# Requires AWS CLI v2 and SSO for the profile. If your session expired:
#   aws sso login --profile airobuild-prod-sso
#
# Environment (optional overrides):
#   AWS_PROFILE              default: airobuild-prod-sso
#   OFFLINE_ML_S3_BUCKET     default: airo-offline-ml-data-prod
#   OFFLINE_ML_S3_PREFIX     default: cost-attribution-classifier
#   AWS_REGION               passed through if set (omit if your profile pins region)

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
profile="${AWS_PROFILE:-airobuild-prod-sso}"
bucket="${OFFLINE_ML_S3_BUCKET:-airo-offline-ml-data-prod}"
prefix="${OFFLINE_ML_S3_PREFIX:-cost-attribution-classifier}"

export AWS_PROFILE="${profile}"

sync_one() {
  local name="$1"
  local src="s3://${bucket}/${prefix}/${name}/"
  local dst="${root}/${name}/"
  echo "sync ${src} -> ${dst}"
  mkdir -p "${dst}"
  aws s3 sync "${src}" "${dst}"
}

sync_one training
sync_one verification
echo "done"
