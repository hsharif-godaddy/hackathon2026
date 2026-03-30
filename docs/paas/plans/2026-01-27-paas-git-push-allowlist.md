---
status: not-implemented
---

# Git Push Allowlist Filter

## Problem Statement

When pushing to remote repositories, we need to ensure:

1. **Remote security**: Sensitive files (`.env`, secrets, `.airo`) must NEVER reach remote
2. **Consistency**: Same files included in git push as zip download
3. **Simplicity**: No complex history tracking needed for PaaS use case
4. **Local persistence**: Files MUST be committed locally (container is ephemeral, git repo is on persistent storage)
5. **Bidirectional sync**: Both push AND pull must work in any order when implementing this (though no change in pull for now)

## Solution: Allowlist-Based Filtered Push

Use the same allowlist as zip download to filter which files are pushed to remote:

- **Allowed directories**: `src/`, `public/`
- **Allowed config files**: `package.json`, `tsconfig.json`, `vite.config.ts`, etc.

Everything else is excluded from remote push.

---

## Push Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     FILTERED PUSH FLOW                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. git rm -r --cached .         (clear index completely)   │
│                           ↓                                  │
│  2. git add --ignore-errors src/ public/  (allowed dirs)    │
│                           ↓                                  │
│  3. git add --ignore-errors package.json tsconfig.json ...  │
│     (allowed config files)                                   │
│                           ↓                                  │
│  4. TREE = git write-tree        (create tree from index)   │
│                           ↓                                  │
│  5. COMMIT = git commit-tree $TREE -m "Sync: filtered"      │
│     (orphan commit - no parent)                              │
│                           ↓                                  │
│  6. git push --force origin $COMMIT:main                    │
│                           ↓                                  │
│  7. git reset --hard            (restore local state)       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**

1. **Orphan commits**: Each push creates a standalone commit with no parent chain
2. **Force push**: Always force push since orphan commits don't share history with remote
3. **Index restoration**: Uses `git reset --hard` instead of `git reset && git add -A` for simplicity - single command reliably resets both index and working directory to HEAD

---

## Token/RepoUrl Resolution

Priority-based resolution (options first, then fallback):

| Parameter | Priority 1 (Options) | Priority 2 (Fallback)                            |
| --------- | -------------------- | ------------------------------------------------ |
| `repoUrl` | `options.repoUrl`    | Database (`git_remote_config` table)             |
| `token`   | `options.token`      | `/alloc/config.json` via `getNomadAllocConfig()` |

```typescript
// Resolution logic in handlePush:
if (options.repoUrl) {
  repoUrl = options.repoUrl; // Use from options
} else {
  const config = gitRemoteConfigRepo.findByAppAndRemote(appId, remoteName);
  repoUrl = config.repoUrl; // Fall back to database
}

// Token resolution happens in GitRemoteTokenManager:
// 1. options.token (if provided)
// 2. getNomadAllocConfig()?.GITHUB_TOKEN?.VALUE (fallback)
```

---

## Allowlist Configuration

Defined in `agents/src/config/app-download.ts`:

```typescript
export const ALLOWED_DIRECTORIES = [
  "src", // User source code
  "public", // User assets
] as const;

export const ALLOWED_CONFIG_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "tsconfig.json",
  "tsconfig.node.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "tailwind.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
  "postcss.config.mjs",
  "postcss.config.cjs",
  "components.json",
  "index.html",
  ".eslintrc.json",
  ".eslintrc.js",
  ".prettierrc",
  ".prettierrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
] as const;
```

**Note**: This is the same allowlist used by zip download, ensuring consistency.

---

## Files Modified

| File                                           | Changes                                              |
| ---------------------------------------------- | ---------------------------------------------------- |
| `agents/src/tools/git-tool.ts`                 | Added `handleFilteredPush()` with allowlist approach |
| `agents/src/config/app-download.ts`            | Shared allowlist (unchanged, reused)                 |
| `agents/src/services/GitRemoteTokenManager.ts` | Token resolution from options or config.json         |

---

## Error Handling

| Error Type    | Detection                                               | User Message                                                                                         |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Auth failure  | `stderr` contains `authentication failed`, `403`, `401` | "GitHub authentication failed. Token may be expired or invalid."                                     |
| Network error | `stderr` contains `could not resolve host`, `network`   | "Network error: Unable to connect to remote repository."                                             |
| No config     | Database returns null and no `repoUrl` in options       | "Remote 'origin' not configured. Please run configure-remote first or provide 'repoUrl' in request." |

---

## Security

**Files that will NEVER be pushed to remote:**

- `.env` and environment files
- `.airo/` directory (infrastructure)
- `node_modules/` (dependencies)
- Deploy scripts and CI configs
- Any file not in `src/`, `public/`, or the allowed config file list

**This is enforced by the allowlist approach** - only explicitly allowed files can be included.

---

## Alternative: git filter-repo (For History Preservation)

If history preservation becomes a requirement in the future, `git filter-repo` provides a more sophisticated approach:

```bash
# Install git-filter-repo (one-time)
pip install git-filter-repo

# Filter to only allowed paths while preserving history
git filter-repo \
  --path src/ \
  --path public/ \
  --path package.json \
  --path tsconfig.json \
  --path vite.config.ts \
  # ... other allowed config files
```

**Pros:**

- Preserves commit history for allowed files
- Clean history without sensitive files ever appearing
- Standard tool with good documentation

**Cons:**

- Requires additional dependency (`git-filter-repo`)
- More complex to configure and maintain
- Rewrites history (may cause issues with existing clones)
- Overkill for PaaS use case where history isn't needed

**When to consider:**

- If customers need to see commit history on their remote
- If compliance requires audit trail preservation
- If multiple developers collaborate on the same repo

For now, the orphan commit approach is preferred due to its simplicity and alignment with the PaaS use case requirements.

---

## Bug Fix: Index Not Properly Cleared Before Adding Allowlisted Files

**Goal:** Fix the git push allowlist to properly exclude non-allowlisted directories like `dev-tools`, `source-mapper`, `airo-secrets`, etc.

**Architecture:** Replace `git reset` with `git rm -r --cached .` to clear the index completely before adding only allowlisted files.

**Tech Stack:** Git, TypeScript, Vitest

---

### Bug Analysis

**Root Cause:** The current implementation uses `git reset` in Step 1 which does NOT clear the index - it resets the index to match HEAD. Since HEAD contains all committed files (including `dev-tools`, `source-mapper`, `airo-secrets`, etc.), those files remain in the index and get included in `git write-tree`.

**Current Broken Flow:**

```
1. git reset              → Index = HEAD (contains ALL files: dev-tools, src, public, etc.)
2. git add src            → Index still contains dev-tools (just updates src)
3. git add public         → Index still contains dev-tools
4. git write-tree         → Tree includes dev-tools! BUG!
```

**Fixed Flow:**

```
1. git rm -r --cached .   → Index = EMPTY (removes all tracked files from index)
2. git add src            → Index = only src
3. git add public         → Index = src + public
4. git write-tree         → Tree includes ONLY allowlisted files
```

**Why `git rm -r --cached .`?**

- `-r` = recursive (all subdirectories)
- `--cached` = only remove from index, NOT from working directory
- `.` = all files
- This clears the entire index while preserving the working directory

---

### Task 1: Write Failing Test for Non-Allowlisted Directory Exclusion

**Files:**

- Modify: `agents/src/tools/__tests__/git-tool.filtered-push.test.ts`

**Step 1: Write the failing test**

Add a new test that verifies non-allowlisted directories are NOT included in the git commands:

```typescript
it("should NOT include non-allowlisted directories in the push", async () => {
  // Track all commands executed
  const executedCommands: string[] = [];

  mockDevSupervisor.exec.mockImplementation(async (options: any) => {
    executedCommands.push(options.command);

    // Return appropriate responses based on command
    if (options.command.includes("write-tree")) {
      return { success: true, stdout: "abc123tree", stderr: "" };
    }
    if (options.command.includes("commit-tree")) {
      return { success: true, stdout: "def456commit", stderr: "" };
    }
    return { success: true, stdout: "", stderr: "" };
  });

  await gitTool.executeGitOperation("/tmp/apps/test-app/app", {
    operation: "push",
    remoteName: "origin",
    branch: "main",
    repoUrl: "https://github.com/user/repo.git",
    token: "ghp_test_token",
  });

  // Verify NO command adds dev-tools, source-mapper, or airo-secrets
  const addCommands = executedCommands.filter((cmd) => cmd.includes("'add'"));
  for (const cmd of addCommands) {
    expect(cmd).not.toContain("dev-tools");
    expect(cmd).not.toContain("source-mapper");
    expect(cmd).not.toContain("airo-secrets");
  }

  // Verify index is cleared with git rm -r --cached
  const rmCommand = executedCommands.find(
    (cmd) => cmd.includes("'rm'") && cmd.includes("--cached"),
  );
  expect(rmCommand).toBeDefined();
  expect(rmCommand).toContain("-r");
});
```

**Step 2: Run test to verify it fails**

```bash
cd agents && pnpm test:unit -- --testPathPattern="git-tool.filtered-push" --testNamePattern="should NOT include non-allowlisted"
```

Expected: FAIL - test expects `git rm -r --cached` but current code uses `git reset`

**Step 3: Commit the failing test**

```bash
git add agents/src/tools/__tests__/git-tool.filtered-push.test.ts
git commit -m "test: add failing test for non-allowlisted directory exclusion in git push"
```

---

### Task 2: Fix the Index Clearing Logic

**Files:**

- Modify: `agents/src/tools/git-tool.ts:1606-1620`

**Step 1: Locate the bug**

In `handleFilteredPush` method, find Step 1 (around line 1606):

```typescript
// Step 1: Reset index (clear staging area)
const resetResult = await this.devSupervisor.exec({
  command: buildShellCommand(["git", "reset"]), // <-- BUG: doesn't clear index
  working_dir: "/app",
  timeout: 30,
  capture_output: true,
});
```

**Step 2: Replace with proper index clearing**

Replace the reset command with `git rm -r --cached .`:

```typescript
// Step 1: Clear index completely (remove all tracked files from index only)
// Using git rm -r --cached . to ensure index is empty before adding allowlisted files
// --cached: only affects index, not working directory
const clearIndexResult = await this.devSupervisor.exec({
  command: buildShellCommand(["git", "rm", "-r", "--cached", ".", "--quiet"]),
  working_dir: "/app",
  timeout: 30,
  capture_output: true,
});

// Note: git rm --cached may "fail" if index is already empty, which is fine
// We only care about fatal errors, not "nothing to remove" warnings
if (
  !clearIndexResult.success &&
  !clearIndexResult.stderr.includes("did not match")
) {
  // Only fail if it's a real error, not "pathspec did not match"
  const stderr = clearIndexResult.stderr.toLowerCase();
  if (stderr.includes("fatal") && !stderr.includes("pathspec")) {
    return {
      success: false,
      operation: "push",
      error: `Failed to clear index: ${clearIndexResult.stderr}`,
    };
  }
}
```

**Step 3: Update error variable name**

Change the error check from `resetResult` to `clearIndexResult`:

```typescript
// Remove the old error check that was checking resetResult
// The new code handles errors inline
```

**Step 4: Run the test to verify it passes**

```bash
cd agents && pnpm test:unit -- --testPathPattern="git-tool.filtered-push"
```

Expected: All tests PASS

**Step 5: Commit the fix**

```bash
git add agents/src/tools/git-tool.ts
git commit -m "fix: clear git index properly before adding allowlisted files

The previous implementation used 'git reset' which only resets the index
to match HEAD, leaving all committed files (including dev-tools,
source-mapper, airo-secrets) in the index.

Changed to 'git rm -r --cached .' which completely empties the index
while preserving the working directory. This ensures only explicitly
added allowlisted files are included in the push."
```

---

### Task 3: Update the Plan Documentation

**Files:**

- Modify: `docs/plans/2026-01-27-paas-git-push-blacklist.md`

**Step 1: Update the Push Flow diagram**

Change Step 1 from:

```
│  1. git rm -r --cached .         (clear index completely)   │
```

To:

```
│  1. git rm -r --cached .         (clear index completely)   │
```

**Step 2: Commit documentation update**

```bash
git add docs/plans/2026-01-27-paas-git-push-blacklist.md
git commit -m "docs: update push flow to reflect index clearing fix"
```

---

### Task 4: Run Full Test Suite

**Step 1: Run all git-tool tests**

```bash
cd agents && pnpm test:unit -- --testPathPattern="git-tool"
```

Expected: All tests PASS

**Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: No type errors

**Step 3: Run lint**

```bash
pnpm lint
```

Expected: No lint errors

---

### Task 5: Manual Integration Test (Optional)

**Step 1: Create a test app with dev-tools directory**

**Step 2: Configure git remote**

**Step 3: Execute git push**

**Step 4: Verify on GitHub that only src/, public/, and config files are present**

---

## Summary of Changes

| File                                                        | Change                                           |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `agents/src/tools/git-tool.ts:1606-1620`                    | Replace `git reset` with `git rm -r --cached .`  |
| `agents/src/tools/__tests__/git-tool.filtered-push.test.ts` | Add test for non-allowlisted directory exclusion |
| `docs/plans/2026-01-27-paas-git-push-blacklist.md`          | Update push flow diagram                         |

**Root Cause:** `git reset` resets index to HEAD (keeps all files), not empty index
**Fix:** `git rm -r --cached .` clears index completely before adding allowlisted files
