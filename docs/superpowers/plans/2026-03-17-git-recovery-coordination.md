---
status: implemented
---

# Git Recovery Coordination Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `nomad_setup.sh` the single owner of filesystem/git recovery after Nomad reschedule, with agent coordinating via setup status API.

**Architecture:** Three sequential PRs: (1) harden `nomad_setup.sh` restart path with `reset --hard`, lock cleanup, and always-run semantics; (2) add setup coordination gate to `handleMessageStart` that triggers setup and skips git ops until complete; (3) delete `performRecovery` and replace with lightweight branch safety check.

**Tech Stack:** Bash (shell script), TypeScript/Vitest (agents service)

**Spec:** `docs/superpowers/specs/2026-03-17-git-recovery-coordination-design.md`

---

## Chunk 1: Harden `nomad_setup.sh`

### Task 1: Restructure restart path to always run when `.git/config` exists

**Files:**

- Modify: `container-scripts/preview/nomad_setup.sh:54-116`

**Context:** The current restart path only runs when `.git/config` exists AND `package.json` is missing. This misses cases where `package.json` exists but other files are missing (e.g., partial ephemeral disk state). The fix: always run `reset --hard` + switch to main when `.git/config` exists, then conditionally run `npm install` only when `node_modules` is missing.

- [ ] **Step 1: Replace restart path condition and git operations**

Replace the entire restart path block (lines 54-116) with:

```bash
if [ -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    # RESTART PATH: Always restore working tree and ensure main branch
    # Runs on every restart regardless of file state — reset --hard is idempotent
    # and handles: wiped ephemeral disk, partial state, dirty index, interrupted merges
    log_step "=== RESTART PATH detected ==="

    cd "$CUSTOMER_APP_DIR"

    # Clean stale lock files from crash/reschedule before any git operation
    log_step "Cleaning stale git lock files..."
    rm -f .git/index.lock .git/refs/heads/*.lock

    # Restore working tree from HEAD
    # reset --hard clears index + working tree, handling more states than checkout .
    # Not a regression for uncommitted work: git checkout . also discards uncommitted
    # changes, and handleToolCallComplete commits after every tool call.
    log_step "Restoring working tree from HEAD..."
    git reset --hard
    log_step "Working tree restored"

    # Switch to main branch if not already there
    # No || true — if main doesn't exist something is fundamentally broken
    # and set -e should abort
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    log_step "Current branch: $CURRENT_BRANCH"
    if [ "$CURRENT_BRANCH" != "main" ]; then
        log_step "Switching to main branch..."
        git checkout main
        log_step "Switched to main branch"
    fi

    if [ ! -d "$CUSTOMER_APP_DIR/node_modules" ]; then
        # Dependencies missing (ephemeral disk wiped node_modules)
        log_step "node_modules missing, running full dependency restore..."

        # Sync package.json from base app template to get latest dependencies
        log_step "Syncing package.json from base template..."
        /management-scripts/sync-package-additions.js "$BASE_APP_DIR/package.json" "package.json"
        log_step "package.json synced"

        # Restore dependencies
        log_step "Installing dependencies with npm install (this may take a few minutes)..."
        CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit
        log_step "Dependencies installed successfully"

        # Commit synced package.json and package-lock.json
        log_step "Committing package.json changes..."
        git add package.json package-lock.json && git commit -m "Sync upstream package.json $(date +%s)" || true
        log_step "Package.json changes committed"
    fi

    # Sync upstream dev-tools and airo-secrets from base app template
    log_step "Syncing dev-tools and airo-secrets with rsync..."
    rsync -a --delete "$BASE_APP_DIR/dev-tools/" "$CUSTOMER_APP_DIR/dev-tools/"
    rsync -a --delete "$BASE_APP_DIR/airo-secrets/" "$CUSTOMER_APP_DIR/airo-secrets/"
    git add dev-tools airo-secrets && git commit -m "Sync upstream dev tools and airo-secrets $(date +%s)" || true
    log_step "dev-tools and airo-secrets synced"

    # Sync .npmrc from base app template
    log_step "Syncing .npmrc..."
    cp "$BASE_APP_DIR/.npmrc" "$CUSTOMER_APP_DIR/.npmrc"
    git add .npmrc && git commit -m "Sync upstream .npmrc $(date +%s)" || true
    log_step ".npmrc synced"

    # Sync template files that are safe to update (only replaces unmodified files)
    log_step "Syncing template files (unmodified files only)..."
    /management-scripts/sync-template-files.js "$BASE_APP_DIR" "$CUSTOMER_APP_DIR"
    git add . && git commit -m "Sync upstream template files $(date +%s)" || true
    log_step "Template files synced"

    log_step "=== RESTART SETUP COMPLETE ==="
fi
```

- [ ] **Step 2: Fix `log_step` quoting**

On line 17, change:

```bash
log_step() {
    echo $1
}
```

to:

```bash
log_step() {
    echo "$1"
}
```

- [ ] **Step 3: Update header comment**

Replace lines 1-10:

```bash
#!/bin/bash

# Unified setup script for both first-start and restart scenarios.
# This script runs setup logic only - process start is handled by dev-supervisor.
#
# Detection relationship with dev-supervisor:
# - dev-supervisor (detectStartupMode) checks .git/config to decide WHEN to run this script:
#   immediate for first-start, deferred to first HTTP request for restart.
# - This script checks .git/config + package.json to decide WHAT work to do:
#   first-start init, corrupted restart recovery, or clean restart (no-op).
```

with:

```bash
#!/bin/bash

# Unified setup script for both first-start and restart scenarios.
# This script runs setup logic only - process start is handled by dev-supervisor.
#
# Detection relationship with dev-supervisor:
# - dev-supervisor (detectStartupMode) checks .git/config to decide WHEN to run this script:
#   immediate for first-start, deferred to first HTTP request for restart.
# - This script checks .git/config to decide WHAT work to do:
#   first-start (no .git/config) or restart (.git/config exists).
#
# Restart path always runs reset --hard + switch to main, then conditionally
# restores dependencies if node_modules is missing. This is idempotent —
# running on an already-clean workspace is a fast no-op.
```

- [ ] **Step 4: Verify script syntax**

Run: `bash -n container-scripts/preview/nomad_setup.sh`
Expected: No output (clean syntax check)

- [ ] **Step 5: Commit**

```bash
git add container-scripts/preview/nomad_setup.sh
git commit -m "fix: harden nomad_setup.sh restart path with reset --hard and always-run semantics"
```

---

## Chunk 2: Setup coordination in `handleMessageStart`

### Task 2: Add setup coordination gate to `handleMessageStart`

**Files:**

- Modify: `agents/src/services/git-hook-service.ts:1-4` (imports)
- Modify: `agents/src/services/git-hook-service.ts:115-141` (handleMessageStart, after devSupervisor check, before isGitRepository)
- Test: `agents/src/services/__tests__/git-hook-service.test.ts`

**Context:** The agent can receive WebSocket messages before deferred setup runs in the preview container. Both do git operations via `/exec`. The fix: check setup status and trigger setup if needed, then skip git ops for this message. Subsequent messages will find setup complete and proceed normally.

`DevSupervisorClientFactory.createForApp()` returns `DevSupervisorClient | null` (see `agents/src/utils/dev-supervisor-client-factory.ts:29`). The client has `getSetupStatus(): Promise<SetupStatus>` and `executeSetup(): Promise<SetupExecuteResponse>` (see `agents/src/services/DevSupervisorClient.ts:767,788`). The `SetupStatus` interface has fields: `setup_configured`, `setup_deferred`, `setup_executed`, `setup_running`, `setup_error` (see `agents/src/services/DevSupervisorClient.ts:292-303`).

- [ ] **Step 1: Update default `beforeEach` mock to include `getSetupStatus`**

The default `beforeEach` at line 69 returns `{} as never` for `DevSupervisorClientFactory.createForApp`. After adding the `getSetupStatus()` call to `handleMessageStart`, this empty mock would cause `getSetupStatus` to throw `TypeError` on every existing test. The inner try/catch would catch it and fall through, so tests technically pass, but this is fragile and misleading.

Update the `beforeEach` mock (line 69) from:

```typescript
vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue({} as never);
```

to:

```typescript
// Default: setup already complete (most tests don't care about setup coordination)
vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue({
  getSetupStatus: vi.fn().mockResolvedValue({
    setup_configured: true,
    setup_deferred: false,
    setup_executed: true,
    setup_running: false,
    setup_error: null,
  }),
  executeSetup: vi.fn().mockResolvedValue({ status: "already_executed" }),
} as never);
```

This ensures existing `performRecovery` tests pass through the setup gate cleanly.

- [ ] **Step 2: Write tests for setup coordination**

Add a new `describe('setup coordination')` block to `agents/src/services/__tests__/git-hook-service.test.ts`.

Add these tests after the existing `performRecovery` describe block (after line 207):

```typescript
describe("setup coordination", () => {
  function createDevSupervisorMock(setupStatus: {
    setup_configured?: boolean;
    setup_deferred?: boolean;
    setup_executed?: boolean;
    setup_running?: boolean;
    setup_error?: string | null;
  }) {
    const mock = {
      getSetupStatus: vi.fn().mockResolvedValue({
        setup_configured: setupStatus.setup_configured ?? true,
        setup_deferred: setupStatus.setup_deferred ?? false,
        setup_executed: setupStatus.setup_executed ?? true,
        setup_running: setupStatus.setup_running ?? false,
        setup_error: setupStatus.setup_error ?? null,
      }),
      executeSetup: vi.fn().mockResolvedValue({ status: "executed" }),
    };
    vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(
      mock as never,
    );
    return mock;
  }

  function createGitMock(currentBranch = "main") {
    const mockImpl = {
      isGitRepository: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue(currentBranch),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      reset: vi.fn().mockResolvedValue(undefined),
      addFiles: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      switchBranch: vi.fn().mockResolvedValue(undefined),
      squashMerge: vi.fn().mockResolvedValue(undefined),
      getCurrentCommit: vi.fn().mockResolvedValue("mock-commit-hash"),
      getTreeHash: vi.fn().mockResolvedValue("tree-hash"),
      resolveCommitHash: vi.fn().mockResolvedValue("commit-hash"),
      commitTree: vi
        .fn()
        .mockResolvedValue({ success: true, stdout: "hash\n", stderr: "" }),
      updateRef: vi.fn().mockResolvedValue(undefined),
      getCommitHistory: vi.fn().mockResolvedValue([]),
      cleanupOldBranches: vi
        .fn()
        .mockResolvedValue({
          needed: false,
          deleted: 0,
          failed: [],
          gcPerformed: false,
        }),
    };
    vi.mocked(GitUtils).mockImplementation(
      () => mockImpl as unknown as GitUtils,
    );
    return mockImpl;
  }

  it("triggers setup and skips git ops when setup is deferred and not executed", async () => {
    const dsMock = createDevSupervisorMock({
      setup_deferred: true,
      setup_executed: false,
    });
    const gitMock = createGitMock();

    await service.handleMessageStart(TEST_APP_ID);

    expect(dsMock.getSetupStatus).toHaveBeenCalled();
    expect(dsMock.executeSetup).toHaveBeenCalled();
    // Git ops should be skipped
    expect(gitMock.isGitRepository).not.toHaveBeenCalled();
    expect(gitMock.createBranch).not.toHaveBeenCalled();
  });

  it("skips triggering setup when setup is already running", async () => {
    const dsMock = createDevSupervisorMock({
      setup_deferred: true,
      setup_executed: false,
      setup_running: true,
    });
    const gitMock = createGitMock();

    await service.handleMessageStart(TEST_APP_ID);

    expect(dsMock.getSetupStatus).toHaveBeenCalled();
    expect(dsMock.executeSetup).not.toHaveBeenCalled();
    // Git ops should still be skipped
    expect(gitMock.isGitRepository).not.toHaveBeenCalled();
  });

  it("does not retry setup when setup_error is set", async () => {
    const dsMock = createDevSupervisorMock({
      setup_deferred: true,
      setup_executed: false,
      setup_error: "npm install failed",
    });
    const gitMock = createGitMock();

    await service.handleMessageStart(TEST_APP_ID);

    expect(dsMock.getSetupStatus).toHaveBeenCalled();
    expect(dsMock.executeSetup).not.toHaveBeenCalled();
    // Git ops should still be skipped
    expect(gitMock.isGitRepository).not.toHaveBeenCalled();
  });

  it("proceeds with git ops when setup is executed", async () => {
    createDevSupervisorMock({
      setup_deferred: false,
      setup_executed: true,
    });
    const gitMock = createGitMock();

    await service.handleMessageStart(TEST_APP_ID);

    expect(gitMock.isGitRepository).toHaveBeenCalled();
    expect(gitMock.createBranch).toHaveBeenCalled();
  });

  it("proceeds with git ops when setup is not configured", async () => {
    createDevSupervisorMock({
      setup_configured: false,
      setup_deferred: false,
      setup_executed: false,
    });
    const gitMock = createGitMock();

    await service.handleMessageStart(TEST_APP_ID);

    expect(gitMock.isGitRepository).toHaveBeenCalled();
    expect(gitMock.createBranch).toHaveBeenCalled();
  });

  it("falls through to git ops if getSetupStatus throws", async () => {
    const mock = {
      getSetupStatus: vi
        .fn()
        .mockRejectedValue(new Error("connection refused")),
      executeSetup: vi.fn(),
    };
    vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(
      mock as never,
    );
    const gitMock = createGitMock();

    await service.handleMessageStart(TEST_APP_ID);

    // Inner try/catch around getSetupStatus catches the error and falls through.
    // Git ops should proceed normally.
    expect(mock.executeSetup).not.toHaveBeenCalled();
    expect(gitMock.isGitRepository).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
/Users/deverton/work/gdcorp-partners/airo-app-builder/node_modules/.pnpm/node_modules/.bin/vitest run agents/src/services/__tests__/git-hook-service.test.ts --config agents/vitest.config.ts
```

Expected: New `setup coordination` tests fail (getSetupStatus not called because it's not implemented yet). Existing `performRecovery` tests still pass (default mock returns setup complete).

- [ ] **Step 4: Add setup coordination to `handleMessageStart`**

In `agents/src/services/git-hook-service.ts`, add the setup coordination gate inside `handleMessageStart`, after the `devSupervisor` null check (after line 132) and before `const gitUtils` (line 134):

```typescript
// Setup coordination: ensure nomad_setup.sh has run before git operations.
// After Nomad reschedule, deferred setup may not have run yet.
// Fire-and-forget: trigger setup but don't block (npm install can take minutes).
// Skip git ops for this message; subsequent messages will find setup complete.
try {
  const setupStatus = await devSupervisor.getSetupStatus();
  if (setupStatus.setup_deferred && !setupStatus.setup_executed) {
    if (setupStatus.setup_error) {
      // Setup failed permanently — don't retry, let user diagnose
      logger.warn("git_hook.setup.permanent_failure", {
        appId,
        error: setupStatus.setup_error,
      });
    } else if (!setupStatus.setup_running) {
      // Trigger setup but don't block — npm install can take minutes.
      // executeSetup() is synchronous on the Go side (blocks until script
      // completes or 5-min mutex timeout). The detached promise keeps the
      // HTTP request open in the background; Go-side timeout bounds it.
      devSupervisor.executeSetup().catch((err) =>
        logger.warn("git_hook.setup.trigger_failed", {
          appId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    logger.info("git_hook.message_start.setup_pending", { appId });
    return;
  }
} catch (setupError) {
  // getSetupStatus failed (e.g., dev-supervisor not reachable).
  // Log and continue — this is non-fatal. Without dev-supervisor,
  // git operations will also fail, but handleMessageStart's outer
  // try/catch handles that gracefully.
  this.logGitError(appId, "setupCoordination", setupError as Error);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
/Users/deverton/work/gdcorp-partners/airo-app-builder/node_modules/.pnpm/node_modules/.bin/vitest run agents/src/services/__tests__/git-hook-service.test.ts --config agents/vitest.config.ts
```

Expected: All tests pass (both old `performRecovery` tests and new `setup coordination` tests)

- [ ] **Step 6: Commit**

```bash
git add agents/src/services/git-hook-service.ts agents/src/services/__tests__/git-hook-service.test.ts
git commit -m "feat: add setup coordination gate to handleMessageStart

Checks dev-supervisor setup status before any git operations. If deferred
setup hasn't run yet (post-Nomad-reschedule), triggers it fire-and-forget
and skips git ops for this message. Prevents TOCTOU race between agent
and nomad_setup.sh."
```

---

## Chunk 3: Delete `performRecovery` and simplify `handleMessageStart`

### Task 3: Replace `performRecovery` with lightweight branch safety check

**Files:**

- Modify: `agents/src/services/git-hook-service.ts:101-298` (delete performRecovery, simplify handleMessageStart)
- Modify: `agents/src/services/__tests__/git-hook-service.test.ts` (replace recovery tests with branch safety tests)

**Context:** With `nomad_setup.sh` handling filesystem restoration and agent coordinating via setup status, `performRecovery` is dead code. Replace the recovery block with a simple branch check: if not on main after setup passed, warn and switch.

**Note:** Line numbers below reference the state after Chunk 2 has been applied. Chunk 2 inserts ~20 lines into `handleMessageStart`, so line numbers in `git-hook-service.ts` will be shifted from the original. Use the code patterns (comments, method names) to locate the right sections rather than relying on exact line numbers.

- [ ] **Step 1: Write new branch safety check tests**

Replace the `describe('performRecovery')` block (lines 128-207 in test file) with:

```typescript
describe("branch safety check", () => {
  function createDevSupervisorMock() {
    const mock = {
      getSetupStatus: vi.fn().mockResolvedValue({
        setup_configured: true,
        setup_deferred: false,
        setup_executed: true,
        setup_running: false,
        setup_error: null,
      }),
      executeSetup: vi.fn().mockResolvedValue({ status: "already_executed" }),
    };
    vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(
      mock as never,
    );
    return mock;
  }

  function createGitMock(currentBranch: string) {
    const mockImpl = {
      isGitRepository: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue(currentBranch),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      reset: vi.fn().mockResolvedValue(undefined),
      addFiles: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      switchBranch: vi.fn().mockResolvedValue(undefined),
      squashMerge: vi.fn().mockResolvedValue(undefined),
      getCurrentCommit: vi.fn().mockResolvedValue("mock-commit-hash"),
      getTreeHash: vi.fn().mockResolvedValue("tree-hash"),
      resolveCommitHash: vi.fn().mockResolvedValue("commit-hash"),
      commitTree: vi
        .fn()
        .mockResolvedValue({ success: true, stdout: "hash\n", stderr: "" }),
      updateRef: vi.fn().mockResolvedValue(undefined),
      getCommitHistory: vi.fn().mockResolvedValue([]),
      cleanupOldBranches: vi
        .fn()
        .mockResolvedValue({
          needed: false,
          deleted: 0,
          failed: [],
          gcPerformed: false,
        }),
    };
    vi.mocked(GitUtils).mockImplementation(
      () => mockImpl as unknown as GitUtils,
    );
    return mockImpl;
  }

  it("switches to main when on unexpected branch", async () => {
    createDevSupervisorMock();
    const gitMock = createGitMock("some-leftover-branch");

    await service.handleMessageStart(TEST_APP_ID);

    expect(gitMock.switchBranch).toHaveBeenCalledWith(TEST_APP_PATH, "main");
    // Should still create feature branch after switching
    expect(gitMock.createBranch).toHaveBeenCalled();
  });

  it("does not switch when already on main", async () => {
    createDevSupervisorMock();
    const gitMock = createGitMock("main");

    await service.handleMessageStart(TEST_APP_ID);

    // Should not switch branches — already on main
    expect(gitMock.switchBranch).not.toHaveBeenCalled();
    // Should create feature branch
    expect(gitMock.createBranch).toHaveBeenCalled();
  });

  it("continues on tracked feature branch without switching", async () => {
    createDevSupervisorMock();
    const gitMock = createGitMock("main");

    // First call: creates feature branch
    await service.handleMessageStart(TEST_APP_ID, "conv-1", "sock-1");

    // Get the branch name that was created
    const branchInfo = service.getAppBranch(TEST_APP_ID);
    expect(branchInfo).toBeDefined();

    // Mock getCurrentBranch to return the tracked branch
    gitMock.getCurrentBranch.mockResolvedValue(branchInfo!.branchName);

    // Second call: should continue on existing branch
    await service.handleMessageStart(
      TEST_APP_ID,
      "conv-1",
      "sock-1",
      "user prompt",
    );

    // Should not switch or create a new branch
    expect(gitMock.createBranch).toHaveBeenCalledTimes(1); // Only from first call
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run:

```bash
/Users/deverton/work/gdcorp-partners/airo-app-builder/node_modules/.pnpm/node_modules/.bin/vitest run agents/src/services/__tests__/git-hook-service.test.ts --config agents/vitest.config.ts
```

Expected: `branch safety check` tests that check switchBranch behavior may fail because `performRecovery` is still being called instead of the simple branch check.

- [ ] **Step 3: Delete `performRecovery` and simplify `handleMessageStart`**

In `agents/src/services/git-hook-service.ts`:

**Delete** the entire `performRecovery` method (lines 221-298).

**Replace** the recovery block in `handleMessageStart` (lines 154-187, from `// If not on main, perform recovery` through the closing `}`) with:

```typescript
// Branch safety check: if not on main and not our tracked branch, switch to main.
// With nomad_setup.sh handling filesystem recovery and setup coordination above,
// being on an unexpected branch is an edge case. Just switch — don't try to
// preserve work via squash merge.
if (currentBranch !== "main") {
  const isExpectedBranch =
    trackedBranch && currentBranch === trackedBranch.branchName;

  if (!isExpectedBranch) {
    logger.warn("git_hook.unexpected_branch", {
      appId,
      currentBranch,
      expectedBranch: trackedBranch?.branchName || "none",
    });
    await gitUtils.switchBranch(app.path, "main");
    this.appBranches.delete(appId);
  } else {
    // We're on our expected feature branch - continue
    logger.debug("git_hook.message_start.on_feature_branch", {
      appId,
      branchName: currentBranch,
    });

    if (userPrompt && trackedBranch && !trackedBranch.userPrompt) {
      trackedBranch.userPrompt = userPrompt;
      this.appBranches.set(appId, trackedBranch);
    }

    return; // Continue on existing branch
  }
}
```

**Update** the class JSDoc (lines 101-114) to reflect the new workflow:

```typescript
/**
 * Handle message start: check setup status, ensure correct branch, create feature branch.
 * Called at the start of EVERY message for an app.
 *
 * Workflow:
 * 1. Check setup status — if deferred setup pending, trigger and skip git ops
 * 2. Check current branch — if unexpected, warn and switch to main
 * 3. If on tracked feature branch, continue on it
 * 4. Create new feature branch for this message
 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
/Users/deverton/work/gdcorp-partners/airo-app-builder/node_modules/.pnpm/node_modules/.bin/vitest run agents/src/services/__tests__/git-hook-service.test.ts --config agents/vitest.config.ts
```

Expected: All tests pass

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd /Users/deverton/work/gdcorp-partners/airo-app-builder && pnpm --filter @airo/agents exec tsc --noEmit
```

Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add agents/src/services/git-hook-service.ts agents/src/services/__tests__/git-hook-service.test.ts
git commit -m "refactor: delete performRecovery, replace with branch safety check

nomad_setup.sh now handles filesystem recovery (reset --hard, switch to main).
handleMessageStart coordinates via setup status API. performRecovery's git
plumbing is no longer needed — replaced with a simple switchBranch if on
an unexpected branch."
```

---

## Post-Implementation

- [ ] **Verify all tests pass together**

Run:

```bash
/Users/deverton/work/gdcorp-partners/airo-app-builder/node_modules/.pnpm/node_modules/.bin/vitest run agents/src/services/__tests__/git-hook-service.test.ts --config agents/vitest.config.ts
```

- [ ] **Run lint**

Run:

```bash
cd /Users/deverton/work/gdcorp-partners/airo-app-builder && pnpm --filter @airo/agents lint
```

- [ ] **Decide PR strategy**

The spec calls for 3 separate PRs. Options:

1. Create 3 separate branches and PRs (cleanest review, independent rollback)
2. Create 1 PR with 3 commits (simpler, but ties rollback together)

Recommend option 1 per the spec. Each task above maps to one PR.
