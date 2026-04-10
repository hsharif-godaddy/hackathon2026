# Working with Git Worktrees

Git worktrees let you check out multiple branches simultaneously in separate directories. This is useful for:

- Running AI agents on different branches in parallel
- Reviewing PRs while your main work stays untouched
- Running the app from one branch while developing on another

## Claude Code (automatic)

A `WorktreeCreate` hook in `.claude/settings.json` replaces the default worktree creation with a project-aware version. When Claude Code creates a worktree (via `EnterWorktree` or `--worktree`), the hook at `.claude/hooks/worktree-create.sh` automatically:

1. Creates the git worktree
2. Symlinks `.env` files from the main tree
3. Runs `pnpm install`

Build is skipped to keep creation fast (~45s). Turbo handles builds on-demand when you run `pnpm run dev`, `pnpm typecheck`, or `pnpm build`.

## Manual worktrees

For worktrees created outside Claude Code (`git worktree add`):

```bash
# Create worktree
git worktree add .worktrees/my-feature -b my-feature
cd .worktrees/my-feature

# Trust direnv (skip if using whitelist - see below)
direnv allow

# Symlink env files
ln -s ../../.env .env
ln -s ../../agents/.env agents/.env
ln -s ../../agents/.env.local.dev agents/.env.local.dev
ln -s ../../app/.env app/.env
ln -s ../../app/.env.local.dev app/.env.local.dev

# Install and build
pnpm install
pnpm build
```

## Auto-trust direnv (one-time)

Each worktree gets its own copy of `.envrc`. To avoid running `direnv allow` in each one, add a whitelist to `~/.config/direnv/direnv.toml`:

```toml
[whitelist]
prefix = [
  "/path/to/airo-app-builder"
]
```

This trusts `.envrc` in the main repo and all worktrees under it.

## Environment files

`.env` files are gitignored, so new worktrees don't have them. The hook (and manual steps above) symlink them from the main tree:

- `agents/.env`, `agents/.env.local.*`
- `app/.env`, `app/.env.local.*`
- Root `.env`

Symlinks mean changes in one place apply everywhere. If you need worktree-specific env overrides, create a real `.env` file - symlinks won't overwrite existing files.

## Running multiple instances

Each worktree can run its own dev server, but you'll need different ports:

```bash
# In worktree A (default ports)
pnpm run dev

# In worktree B (custom ports)
PORT=4001 pnpm run dev:agents    # agents on 4001
# Note: the app (Next.js) port is configured in app/gasket.config.ts
```

## Cleanup

```bash
# Remove a worktree
git worktree remove .worktrees/my-feature

# List all worktrees
git worktree list

# Prune stale worktree references
git worktree prune
```
