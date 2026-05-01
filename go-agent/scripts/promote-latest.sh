#!/usr/bin/env bash
# Promote the newest result file in each test case directory to 1.json.
# Requires GNU coreutils (find -printf, stat -c). Linux only; not macOS-compatible.
# Usage: ./scripts/promote-latest.sh results/harness/v3.0
set -euo pipefail

dir="${1:?Usage: $0 <results-dir>  (e.g. results/harness/v3.0)}"

for case_dir in "$dir"/*/; do
  [ -d "$case_dir" ] || continue

  # Find the newest .json file by modification time.
  newest=$(find "$case_dir" -maxdepth 1 -name '*.json' -printf '%T@ %p\n' | sort -rn | head -1 | cut -d' ' -f2-)

  [ -z "$newest" ] && continue

  target="${case_dir%/}/1.json"

  if [ "$(realpath "$newest")" = "$(realpath "$target" 2>/dev/null)" ]; then
    continue
  fi

  # Move old 1.json out of the way, promote newest.
  if [ -f "$target" ]; then
    ts=$(stat -c '%Y' "$target")
    mv "$target" "${case_dir%/}/1_${ts}.json"
  fi
  mv "$newest" "$target"
  echo "$(basename "$case_dir"): $(basename "$newest") -> 1.json"
done
