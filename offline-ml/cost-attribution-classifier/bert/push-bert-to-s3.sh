#!/usr/bin/env bash
# Push a local BERT checkpoint directory to the offline-ML S3 bucket.
#
# Usage:
#   bash push-bert-to-s3.sh [stamp]
#
#   stamp: subdirectory under ./checkpoints/ to push (default: best-checkpoint)
#
# Environment (optional overrides):
#   AWS_PROFILE          default: airobuild-prod-sso
#   OFFLINE_ML_S3_BUCKET default: airo-offline-ml-data-prod
#   OFFLINE_ML_S3_PREFIX default: cost-attribution-classifier/bert/checkpoints
#
# After uploading, also push the training report from ./weights/ if present.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stamp="${1:-best-checkpoint}"
profile="${AWS_PROFILE:-airobuild-prod-sso}"
bucket="${OFFLINE_ML_S3_BUCKET:-airo-offline-ml-data-prod}"
prefix="${OFFLINE_ML_S3_PREFIX:-cost-attribution-classifier/bert/checkpoints}"

local_ckpt="${root}/checkpoints/${stamp}"
s3_dst="s3://${bucket}/${prefix}/${stamp}/"

if [[ ! -d "${local_ckpt}" ]]; then
  echo "ERROR: checkpoint dir not found: ${local_ckpt}"
  exit 1
fi

export AWS_PROFILE="${profile}"

echo "Pushing checkpoint: ${local_ckpt} -> ${s3_dst}"
aws s3 sync "${local_ckpt}" "${s3_dst}"
echo "Checkpoint uploaded."

# Upload training report alongside the checkpoint if one exists
weights_dir="${root}/weights"
if [[ -d "${weights_dir}" ]]; then
  reports=("${weights_dir}"/bert-training-report-*.json)
  if [[ ${#reports[@]} -gt 0 && -f "${reports[0]}" ]]; then
    latest_report=$(ls -t "${weights_dir}"/bert-training-report-*.json 2>/dev/null | head -1)
    if [[ -n "${latest_report}" ]]; then
      report_dst="s3://${bucket}/${prefix}/${stamp}/$(basename "${latest_report}")"
      echo "Pushing report: ${latest_report} -> ${report_dst}"
      aws s3 cp "${latest_report}" "${report_dst}"
    fi
  fi
fi

echo "Done. s3_path: ${s3_dst}"
