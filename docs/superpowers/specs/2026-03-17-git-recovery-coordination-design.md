# Git Recovery Coordination Design

## Problem

After a Nomad reschedule, the ephemeral disk is wiped but `.git` survives on a bind mount. Two independent systems compete to restore the container's filesystem and git state:

1. **`nomad_setup.sh`** — runs in the preview container (immediate on first-start, deferred to first HTTP request on restart)
2. **`performRecovery` in `GitHookService`** — runs in the agent when `handleMessageStart` detects a non-main branch

This creates a TOCTOU race: the agent can receive WebSocket messages and start git operations via `/exec` before `nomad_setup.sh` runs. Both modify the same `.git` and working tree simultaneously.

PR #1794 fixed the immediate dataloss bug (`performRecovery` committing an empty working tree to main). This spec covers the follow-up work: making `nomad_setup.sh` the single owner of filesystem/git recovery, and having the agent coordinate with it.

## Architecture

Three PRs that progressively move recovery ownership from the agent to `nomad_setup.sh`:

| PR | Scope | Risk | Depends on |
|---|---|---|---|
| 1. Harden `nomad_setup.sh` | Shell: `reset --hard`, lock cleanup, always-run restart path | Low | Nothing |
| 2. Setup coordination | Agent: fire-and-forget `executeSetup()`, skip git ops if setup pending | Medium | #2085 (merged) |
| 3. Delete `performRecovery` | Agent: remove recovery, keep branch safety check | Low | PRs 1 and 2 |

After all three land, `nomad_setup.sh` is the single owner of filesystem restoration. The agent only manages branch lifecycle (create feature branch, squash merge on completion).

## PR 1: Harden `nomad_setup.sh`

### Changes to restart path

The current restart path (lines 54-116) only runs when `.git/config` exists AND `package.json` is missing. This misses cases where `package.json` exists but other files are missing.

**New structure:** Always run `reset --hard` + switch to main when `.git/config` exists. Use `node_modules` presence to decide whether the expensive `npm install` is needed.

```bash
if [ -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    # RESTART PATH: Always restore working tree and ensure main branch
    log_step "=== RESTART PATH detected ==="

    cd "$CUSTOMER_APP_DIR"

    # Clean stale lock files from crash/reschedule
    log_step "Cleaning stale lock files..."
    rm -f .git/index.lock .git/refs/heads/*.lock

    # Restore working tree from HEAD (handles wiped ephemeral disk,
    # partial state, dirty index, interrupted merges)
    log_step "Restoring working tree from HEAD..."
    git reset --hard

    # Switch to main branch if not already there
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    log_step "Current branch: $CURRENT_BRANCH"
    if [ "$CURRENT_BRANCH" != "main" ]; then
        log_step "Switching to main branch..."
        git checkout main
    fi

    if [ ! -f "$CUSTOMER_APP_DIR/package.json" ]; then
        # Corrupted workspace — package.json missing even after reset --hard
        # This means it was never committed. Sync from template.
        log_step "package.json missing after reset, syncing from template..."
        /management-scripts/sync-package-additions.js "$BASE_APP_DIR/package.json" "package.json"
        git add package.json && git commit -m "Sync upstream package.json $(date +%s)" || true
    fi

    if [ ! -d "$CUSTOMER_APP_DIR/node_modules" ]; then
        # Dependencies missing (ephemeral disk wiped node_modules)
        log_step "Installing dependencies..."
        # Sync package.json updates from template before install
        /management-scripts/sync-package-additions.js "$BASE_APP_DIR/package.json" "package.json"
        CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit
        git add package.json package-lock.json && git commit -m "Sync upstream package.json $(date +%s)" || true
    fi

    # Sync upstream dev-tools, airo-secrets, .npmrc, template files
    # (these are fast — rsync and MD5-based selective sync)
    rsync -a --delete "$BASE_APP_DIR/dev-tools/" "$CUSTOMER_APP_DIR/dev-tools/"
    rsync -a --delete "$BASE_APP_DIR/airo-secrets/" "$CUSTOMER_APP_DIR/airo-secrets/"
    git add dev-tools airo-secrets && git commit -m "Sync upstream dev tools and airo-secrets $(date +%s)" || true

    cp "$BASE_APP_DIR/.npmrc" "$CUSTOMER_APP_DIR/.npmrc"
    git add .npmrc && git commit -m "Sync upstream .npmrc $(date +%s)" || true

    /management-scripts/sync-template-files.js "$BASE_APP_DIR" "$CUSTOMER_APP_DIR"
    git add . && git commit -m "Sync upstream template files $(date +%s)" || true

    log_step "=== RESTART SETUP COMPLETE ==="
fi
```

### Key changes from current script

| Current | New | Why |
|---|---|---|
| `git checkout .` | `git reset --hard` | Clears index, partial merges, dirty state — not just tracked file diffs. Not a regression for uncommitted work: `git checkout .` also discards uncommitted changes, and `handleToolCallComplete` commits after every tool call so committed state has all completed work. |
| No lock cleanup | `rm -f .git/index.lock .git/refs/heads/*.lock` | Stale locks from crash block all git commands |
| `git checkout main \|\| true` | `git checkout main` (no `\|\| true`) | Real failures should abort via `set -e`; swallowing errors caused the original bug |
| Only runs if `package.json` missing | Always runs when `.git/config` exists | Handles all corruption states, not just the common case |
| `npm install` always | `npm install` only if `node_modules` missing | Idempotent — clean restart becomes a fast no-op |

### First-start path

Unchanged. First-start always runs immediately (not deferred) and initializes a fresh repo.

## PR 2: Wire setup coordination into `handleMessageStart`

### Problem

The agent can receive WebSocket messages before deferred setup runs. Both do git operations in the same container via `/exec` through the dev-supervisor socket.

### Solution

Fire-and-forget: trigger setup if needed, skip git ops for this message, let subsequent messages benefit.

```typescript
// In handleMessageStart, after getting devSupervisor client:

const setupStatus = await devSupervisor.getSetupStatus();
if (setupStatus.setup_deferred && !setupStatus.setup_executed) {
  if (setupStatus.setup_error) {
    // Setup failed permanently — don't retry, let user diagnose
    logger.warn('git_hook.setup.permanent_failure', {
      appId, error: setupStatus.setup_error
    });
  } else if (!setupStatus.setup_running) {
    // Trigger setup but don't block — npm install can take minutes
    devSupervisor.executeSetup().catch(err =>
      logger.warn('git_hook.setup.trigger_failed', { appId, error: err })
    );
  }
  logger.info('git_hook.message_start.setup_pending', { appId });
  return; // Skip git ops — agent still processes the message normally
}
```

Note: `executeSetup()` is synchronous on the Go side (blocks until script completes or 5-minute mutex timeout). The fire-and-forget `.catch()` detaches the promise from `handleMessageStart`, so the HTTP request to the dev-supervisor socket stays open in the background. This is acceptable: the Go-side mutex timeout bounds the request duration, and Node's event loop handles the dangling promise without blocking.

### Why fire-and-forget instead of blocking

- `npm install` inside `nomad_setup.sh` can take 1-3 minutes
- Any fixed timeout is either too short (kills valid installs) or too long (blocks the user)
- `handleMessageStart` is a non-blocking hook — if it returns early, the agent still processes the message, LLM still runs, tool calls still work via `/exec`
- The only thing skipped is git branch creation — changes from this message won't be on a feature branch
- In practice, the preview container isn't serving until setup finishes, so the user isn't sending meaningful code-change prompts during this window

### Behavior by message

| Message | Setup state | Agent behavior |
|---|---|---|
| 1st after reschedule | `deferred && !executed && !running` | Triggers setup, skips git ops, agent works normally |
| 2nd (setup still running) | `deferred && !executed && running` | Skips git ops, agent works normally |
| 3rd (setup done) | `executed` | Normal git ops resume (branch creation, etc.) |
| Any (setup failed) | `deferred && !executed && setup_error` | Logs permanent failure, skips git ops, does not retry. User can ask agent to diagnose via tool calls. |

### Error handling

- `getSetupStatus()` failure: caught by `handleMessageStart`'s outer try/catch, logged, git ops skipped for safety
- `executeSetup()` failure (fire-and-forget): caught by `.catch()`, logged. The Go side sets `setup_error` atomically, so the next message's `getSetupStatus()` will see `setup_error` and stop retrying.
- Setup script permanent failure: `setup_error` is set on the Go side. Agent checks this field and does not re-trigger `executeSetup()`. Git ops remain disabled. User can ask the agent to diagnose and fix the container via tool calls — `/exec` works regardless of setup state.
- Non-production environments (no dev-supervisor): `getSetupStatus()` call fails, caught by outer try/catch. `handleMessageStart` falls through to git operations as before — no regression for local dev.

### What about `handleConnectionEnd`?

`handleConnectionEnd` (squash merge to main) only runs if there's a tracked branch. Since we skip branch creation when setup is pending, `handleConnectionEnd` will find no branch info and return early. No changes needed.

## PR 3: Delete `performRecovery`

### What gets deleted

- `performRecovery()` method (~60 lines of git plumbing)
- The `isExpectedBranch` / recovery logic block in `handleMessageStart`
- All recovery-specific tests

### What replaces it

A lightweight branch safety check after the setup coordination gate:

```typescript
// After setup coordination passes:
const currentBranch = await gitUtils.getCurrentBranch(app.path);
if (currentBranch !== 'main') {
  logger.warn('git_hook.unexpected_branch', { appId, currentBranch });
  await gitUtils.switchBranch(app.path, 'main');
}
// Create feature branch...
```

No squash merge, no plumbing, no `reset --hard`. If we're not on main after setup ran, something unexpected happened — just switch to main and move on. The feature branch is abandoned.

### What stays unchanged

- Setup coordination (from PR 2)
- Feature branch creation in `handleMessageStart`
- `handleConnectionEnd` (squash merge on normal completion)
- `handleToolCallComplete` (commit after each tool call)
- All `handleConnectionEnd` tests

### Simplified `handleMessageStart` flow

```
handleMessageStart(appId):
  1. Get app, devSupervisor, gitUtils
  2. Check setup status → if pending, trigger and return
  3. Check isGitRepository
  4. Get current branch → if not main, warn and switch
  5. Check tracked branch → if exists, update prompt and return
  6. Create new feature branch, track it
```

## Tradeoffs

### Strictly better

- No dataloss bug (PR #1794 + PR 1 hardening)
- No TOCTOU race (agent coordinates with setup)
- Lock file cleanup prevents stale locks after crashes
- `reset --hard` handles more corruption states than `git checkout .`
- Always-run restart path catches "both exist but files missing" edge case
- ~60 lines of complex plumbing code removed from agent

### Acceptable tradeoffs

- First message after reschedule has no git tracking. Agent still works (tool calls, file writes). Changes aren't on a branch until next message after setup completes. In practice, preview isn't serving yet so user isn't sending real code-change prompts.
- Unsquashed feature branches are abandoned on unexpected-branch (PR 3). Today `performRecovery` tries to preserve that work via squash merge. But this only triggers if `nomad_setup.sh` left us on a non-main branch, which shouldn't happen after PR 1. The simpler code is easier to reason about.

## Testing

### PR 1 (shell script)
- Manual testing in dev environment with simulated reschedule scenarios
- Verify: clean restart (fast no-op), corrupted restart (full recovery), detached HEAD, stale lock files

### PR 2 (setup coordination)
- Unit tests for `handleMessageStart` setup coordination path
- Mock `getSetupStatus()` returning various states
- Verify: triggers setup when pending, skips when running, proceeds when executed
- Verify: `handleConnectionEnd` returns early when no branch tracked

### PR 3 (delete performRecovery)
- Remove recovery tests, add branch-safety-check tests
- Verify: warns and switches branch when not on main
- Verify: simplified flow still creates branches and tracks them correctly
