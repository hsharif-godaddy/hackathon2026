#!/usr/bin/env bash
# Fetch a BERT checkpoint from S3 to ./checkpoints/<stamp>/
#
# Usage:
#   bash fetch-bert-from-s3.sh [stamp]
#
#   stamp: checkpoint directory name on S3 (default: best-checkpoint)
#          Pass "latest" to auto-select the most recently uploaded checkpoint.
#
# Environment (optional overrides):
#   AWS_PROFILE          default: airobuild-prod-sso
#   OFFLINE_ML_S3_BUCKET default: airo-offline-ml-data-prod
#   OFFLINE_ML_S3_PREFIX default: cost-attribution-classifier/bert/checkpoints

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stamp="${1:-best-checkpoint}"
profile="${AWS_PROFILE:-airobuild-prod-sso}"
bucket="${OFFLINE_ML_S3_BUCKET:-airo-offline-ml-data-prod}"
prefix="${OFFLINE_ML_S3_PREFIX:-cost-attribution-classifier/bert/checkpoints}"

export AWS_PROFILE="${profile}"

if [[ "${stamp}" == "latest" ]]; then
  stamp=$(aws s3 ls "s3://${bucket}/${prefix}/" \
    | awk '{print $NF}' | tr -d '/' | sort | tail -1)
  if [[ -z "${stamp}" ]]; then
    echo "ERROR: no checkpoints found under s3://${bucket}/${prefix}/"
    exit 1
  fi
  echo "Latest checkpoint: ${stamp}"
fi

s3_src="s3://${bucket}/${prefix}/${stamp}/"
local_dir="${root}/checkpoints/${stamp}"
mkdir -p "${local_dir}"

echo "Fetching: ${s3_src} -> ${local_dir}"
aws s3 sync "${s3_src}" "${local_dir}"
echo "Done: ${local_dir}"
