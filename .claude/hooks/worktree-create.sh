#!/usr/bin/env bash
#
# Claude Code WorktreeCreate hook
#
# Replaces default git worktree creation with project-specific setup:
#   1. Creates git worktree
#   2. Symlinks .env files from main tree
#   3. Installs dependencies (pnpm install)
#
# Build is skipped - Turbo handles it on-demand when you run dev/typecheck/build.
#
# Contract:
#   stdin:  JSON { session_id, transcript_path, cwd, hook_event_name }
#   stdout: worktree path (only line printed to stdout)
#   exit 0: success, non-zero: fails worktree creation
#
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required by worktree-create.sh to parse hook input JSON." >&2
  exit 1
fi

input=$(cat)
cwd=$(echo "$input" | jq -r '.cwd')
[[ -n "$cwd" && "$cwd" != "null" ]] || { echo "Error: missing or null cwd in hook input" >&2; exit 1; }

if ! REPO_ROOT=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null); then
  echo "Error: cwd is not inside a git repository: $cwd" >&2
  exit 1
fi

# --- Create worktree ---
name="wt-$(date +%Y%m%d-%H%M%S)-$$"
wt_dir="$REPO_ROOT/.claude/worktrees/$name"
branch="$name"

mkdir -p "$REPO_ROOT/.claude/worktrees"
git -C "$REPO_ROOT" worktree add "$wt_dir" -b "$branch" >&2

# Clean up worktree and branch on failure
cleanup() {
  echo "Worktree setup failed, cleaning up..." >&2
  git -C "$REPO_ROOT" worktree remove --force "$wt_dir" 2>/dev/null || true
  git -C "$REPO_ROOT" branch -D "$branch" 2>/dev/null || true
}
trap cleanup ERR

# --- Symlink .env files ---
symlink_env() {
  local subdir="$1"
  local src_dir="$REPO_ROOT/$subdir"
  local dst_dir="$wt_dir/$subdir"

  [ -d "$dst_dir" ] || return 0

  for envfile in "$src_dir"/.env "$src_dir"/.env.*; do
    [ -f "$envfile" ] || continue
    local base="$(basename "$envfile")"
    local target="$dst_dir/$base"

    if [ -L "$target" ] || [ -f "$target" ]; then
      continue
    fi
    ln -s "$envfile" "$target"
    echo "  Linked: $subdir/$base" >&2
  done
}

echo "Symlinking .env files..." >&2
symlink_env "agents"
symlink_env "app"
for envfile in "$REPO_ROOT"/.env "$REPO_ROOT"/.env.*; do
  [ -f "$envfile" ] || continue
  base="$(basename "$envfile")"
  target="$wt_dir/$base"
  if [ -L "$target" ] || [ -f "$target" ]; then
    continue
  fi
  ln -s "$envfile" "$target"
  echo "  Linked: $base" >&2
done

# --- Install dependencies ---
echo "Installing dependencies..." >&2
cd "$wt_dir"

# Override WORKSPACE_ROOT so the .envrc pnpm wrapper allows install here.
# Set REAL_PNPM to override pnpm binary if direnv wrapping causes issues.
export WORKSPACE_ROOT="$wt_dir"
PNPM="${REAL_PNPM:-pnpm}"

if command -v corepack &>/dev/null; then
  corepack enable 2>/dev/null || true
fi
"$PNPM" install --frozen-lockfile >&2 || { echo "Warning: frozen-lockfile failed, retrying without..." >&2; "$PNPM" install >&2; }

trap - ERR
echo "Worktree ready: $wt_dir" >&2

# Return the worktree path (required by WorktreeCreate contract)
echo "$wt_dir"
