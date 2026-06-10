#!/usr/bin/env bash
#
# CI wrapper for i18n translation key validation.
# Validates app/src files changed since the PR/merge/push base.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

resolve_base() {
  if [ -n "${I18N_VALIDATION_BASE_SHA:-}" ]; then
    echo "$I18N_VALIDATION_BASE_SHA"
    return
  fi

  if [ -n "${GITHUB_EVENT_PULL_REQUEST_BASE_SHA:-}" ]; then
    echo "$GITHUB_EVENT_PULL_REQUEST_BASE_SHA"
    return
  fi

  if [ -n "${GITHUB_EVENT_MERGE_GROUP_BASE_SHA:-}" ]; then
    echo "$GITHUB_EVENT_MERGE_GROUP_BASE_SHA"
    return
  fi

  if [ -n "${GITHUB_EVENT_BEFORE:-}" ] && [ "$GITHUB_EVENT_BEFORE" != "0000000000000000000000000000000000000000" ]; then
    echo "$GITHUB_EVENT_BEFORE"
    return
  fi

  echo "HEAD~1"
}

BASE=$(resolve_base)
HEAD="${I18N_VALIDATION_HEAD_SHA:-HEAD}"

mapfile -t FILES < <(git diff --name-only --diff-filter=ACMR "$BASE" "$HEAD" | grep -E '^app/src/.*\.(ts|tsx)$' || true)

if [ ${#FILES[@]} -eq 0 ]; then
  echo "✓ No translation files to validate"
  exit 0
fi

node scripts/validate-i18n.mjs --strict "${FILES[@]}"
