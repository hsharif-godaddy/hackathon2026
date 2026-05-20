#!/usr/bin/env bash
#
# PostToolUse hook: runs linter on the edited file.
#
# Contract:
#   stdin: JSON { tool_name, tool_input, tool_result, session_id, transcript_path, cwd }
#   stdout: feedback shown to Claude (empty = silent success)
#   exit 0: success, non-zero: tool use is blocked
#
set -euo pipefail

input=$(cat)
read -r tool_name file_path < <(echo "$input" | jq -r '[.tool_name, (.tool_input.file_path // "")] | @tsv')

# Only act on Edit and Write
[[ "$tool_name" == "Edit" || "$tool_name" == "Write" ]] || exit 0
[[ -n "$file_path" && "$file_path" != "null" ]] || exit 0

# Canonicalize to absolute path
file_path=$(realpath "$file_path" 2>/dev/null || echo "$file_path")

# Skip files in node_modules, dist, .next
case "$file_path" in
  */node_modules/*|*/dist/*|*/.next/*) exit 0 ;;
esac

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
[[ -n "$REPO_ROOT" ]] || exit 0

case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    eslint_bin="$REPO_ROOT/node_modules/.bin/eslint"
    [[ -x "$eslint_bin" ]] || exit 0
    dir=$(dirname "$file_path")
    while [[ "$dir" != "$REPO_ROOT" && "$dir" != "/" ]]; do
      if [[ -f "$dir/package.json" ]] && jq -e '.scripts.lint' "$dir/package.json" >/dev/null 2>&1; then
        cd "$REPO_ROOT"
        "$eslint_bin" --no-warn-ignored --max-warnings=0 "$file_path" 2>&1 | head -30 || true
        exit 0
      fi
      dir=$(dirname "$dir")
    done
    ;;
  *.go)
    dir=$(dirname "$file_path")
    while [[ "$dir" != "$REPO_ROOT" && "$dir" != "/" ]]; do
      if [[ -f "$dir/go.mod" ]]; then
        cd "$dir"
        pkg_dir="${file_path%/*}"
        if [[ "$pkg_dir" == "$dir" ]]; then
          rel_pkg="."
        else
          rel_pkg="./${pkg_dir#$dir/}"
        fi
        go vet "$rel_pkg/..." 2>&1 | head -20 || true
        exit 0
      fi
      dir=$(dirname "$dir")
    done
    ;;
esac

exit 0
