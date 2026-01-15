# GitHub Sync Feature Design

**Created:** 2025-01-07
**Architecture:** 1 Container = 1 App = 1 Git Repository
**Related:** [github-sync-class-diagram.md](./github-sync-class-diagram.md) - Component architecture and class relationships

---

## Executive Summary

### Current State

- ✅ **One-way import**: GitHub → local container (via `GitCloneService`)
- ❌ **Two-way sync**: Local ↔ GitHub (not implemented)

**Gap:** Apps run isolated git repositories with no remote configured. Push/pull operations are stubbed in `git-tool.ts:618-623`.

### Proposed Solution

Enable bidirectional sync between customer app containers and GitHub.com:

- **Token Management**: User stores `GITHUB_TOKEN` in preview secrets via existing secrets API
- **Push**: Upload local commits to GitHub (reads token from container secrets)
- **Pull**: Download remote commits to local container (reads token from container secrets)

---

## End-to-End Workflow

### Setup: Configure GitHub Integration

```
┌─────────┐              ┌──────────────┐              ┌────────────────┐              ┌──────────────┐
│  User   │              │  App Service │              │ Control Plane  │              │  Container   │
│  (UI)   │              │  (Next.js)   │              │  (mgmt-airo)   │              │  (Preview)   │
└────┬────┘              └──────┬───────┘              └───────┬────────┘              └──────┬───────┘
     │                          │                               │                              │
     │ 1. Add GITHUB_TOKEN      │                               │                              │
     │    to secrets            │                               │                              │
     ├─────────────────────────>│                               │                              │
     │ POST /api/secrets/       │                               │                              │
     │   {appId}/variants/      │                               │                              │
     │   preview                │                               │                              │
     │                          │                               │                              │
     │                          │ 2. Update secrets             │                              │
     │                          ├──────────────────────────────>│                              │
     │                          │                               │                              │
     │                          │                               │ 3. Write to                  │
     │                          │                               │    /alloc/config.json        │
     │                          │                               ├─────────────────────────────>│
     │                          │                               │                              │
     │                          │ 4. Success                    │                              │
     │                          │<──────────────────────────────┤                              │
     │ 5. Token stored          │                               │                              │
     │<─────────────────────────┤                               │                              │
     │                          │                               │                              │
     │ 6. Configure git remote  │                               │                              │
     │    (repo URL, branch)    │                               │                              │
     ├───────────────────────────────────────────────────────────────────────────────────────>│
     │ POST /apps/{appId}/      │                               │                              │
     │   git/remote/configure   │                               │                              │
     │                          │                               │                              │
     │                          │                               │ 7. git remote add origin     │
     │                          │                               │    {repoUrl}                 │
     │                          │                               │                              │
     │ 8. Remote configured     │                               │                              │
     │<───────────────────────────────────────────────────────────────────────────────────────┤
```

### Push: Local → GitHub

```
┌─────────┐              ┌──────────────┐              ┌──────────────┐              ┌──────────┐
│  User   │              │    Agents    │              │  Container   │              │ GitHub   │
│  (UI)   │              │   Service    │              │  (Preview)   │              │   .com   │
└────┬────┘              └──────┬───────┘              └──────┬───────┘              └────┬─────┘
     │                          │                              │                           │
     │ 1. Push to GitHub        │                              │                           │
     ├─────────────────────────>│                              │                           │
     │ POST /apps/{appId}/      │                              │                           │
     │   git/push               │                              │                           │
     │                          │                              │                           │
     │                          │ 2. Execute bash script       │                           │
     │                          ├─────────────────────────────>│                           │
     │                          │  (via dev-supervisor)        │                           │
     │                          │                              │                           │
     │                          │                              │ 3. Read token from        │
     │                          │                              │    /alloc/config.json     │
     │                          │                              │                           │
     │                          │                              │ 4. Write /tmp/            │
     │                          │                              │    .git-credentials       │
     │                          │                              │                           │
     │                          │                              │ 5. git config             │
     │                          │                              │    credential.helper      │
     │                          │                              │                           │
     │                          │                              │ 6. git push origin main   │
     │                          │                              ├──────────────────────────>│
     │                          │                              │                           │
     │                          │                              │ 7. Push accepted          │
     │                          │                              │<──────────────────────────┤
     │                          │                              │                           │
     │                          │                              │ 8. Delete /tmp/           │
     │                          │                              │    .git-credentials       │
     │                          │                              │                           │
     │                          │ 9. Success                   │                           │
     │                          │<─────────────────────────────┤                           │
     │ 10. Push complete        │                              │                           │
     │<─────────────────────────┤                              │                           │
```

### Pull: GitHub → Local

```
┌─────────┐              ┌──────────────┐              ┌──────────────┐              ┌──────────┐
│  User   │              │    Agents    │              │  Container   │              │ GitHub   │
│  (UI)   │              │   Service    │              │  (Preview)   │              │   .com   │
└────┬────┘              └──────┬───────┘              └──────┬───────┘              └────┬─────┘
     │                          │                              │                           │
     │ 1. Pull from GitHub      │                              │                           │
     ├─────────────────────────>│                              │                           │
     │ POST /apps/{appId}/      │                              │                           │
     │   git/pull               │                              │                           │
     │                          │                              │                           │
     │                          │ 2. Execute bash script       │                           │
     │                          ├─────────────────────────────>│                           │
     │                          │  (via dev-supervisor)        │                           │
     │                          │                              │                           │
     │                          │                              │ 3. Read token, configure  │
     │                          │                              │    credentials (same as   │
     │                          │                              │    push steps 3-5)        │
     │                          │                              │                           │
     │                          │                              │ 6. git pull origin main   │
     │                          │                              ├──────────────────────────>│
     │                          │                              │                           │
     │                          │                              │ 7. Send commits           │
     │                          │                              │<──────────────────────────┤
     │                          │                              │                           │
     │                          │                              │ 8. Delete credentials     │
     │                          │                              │                           │
     │                          │ 9. Success                   │                           │
     │                          │<─────────────────────────────┤                           │
     │ 10. Pull complete        │                              │                           │
     │<─────────────────────────┤                              │                           │
```

---

### Key Constraints (Verified from Codebase)

1. **Container Isolation**: 1 app per container, isolated `/tmp` and `/app` directories
2. **Execution Model**: All git commands run inside container via dev-supervisor
3. **Security**: Reuse existing AES-256-GCM encryption (`OAuthTokenRepository`, `token-crypto.ts`)
4. **Working Directory**: Always `/app` inside container

---

## Architecture

### High-Level Flow

```
┌──────────┐         ┌──────────────┐         ┌────────────┐         ┌──────────┐
│   User   │ HTTPS   │  Agents API  │ Socket  │ Container  │ HTTPS   │ GitHub   │
│   (UI)   ├────────>│  (Express)   ├────────>│   /app     ├────────>│   .com   │
└──────────┘         └──────┬───────┘         └────────────┘         └──────────┘
                            │
                            │ Encrypt/Decrypt
                            ▼
                     ┌───────────────────┐
                     │     SQLite DB     │
                     │ git_remote_config │
                     └───────────────────┘
```

### Component Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ API Routes (git-remote.ts)                                      │
│ - POST   /apps/:id/git/remote/configure                         │
│ - POST   /apps/:id/git/push                                     │
│ - POST   /apps/:id/git/pull                                     │
│ - GET    /apps/:id/git/remote/status                            │
│ - DELETE /apps/:id/git/remote                                   │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ GitTool (git-tool.ts)                                           │
│ - handlePush()                                                   │
│ - handlePull()                                                   │
│ - handleConfigureRemote()                                        │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ GitRemoteTokenManager (NEW)                                      │
│ - configureGitCredentials()                                      │
│ - cleanupGitCredentials()                                        │
│ - validateToken()                                                │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ GitUtils (git.ts) - EXTEND EXISTING                             │
│ - addRemote()                                                    │
│ - push()                                                         │
│ - pull()                                                         │
│ - getRemoteUrl()                                                 │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Existing Infrastructure (REUSE)                                  │
│ - GitRemoteConfigRepository (NEW - token storage)                │
│ - token-crypto.ts (AES-256-GCM encryption)                       │
│ - DevSupervisorClient (container command execution)              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Token Management

### Storage Strategy: Secrets API (Security-Approved Pattern)

**Why use Secrets API instead of database storage?**

- ✅ **Security-approved pattern**: Same pattern used for e-commerce integration
- ✅ **No CEPH exposure**: Token never stored in agents database (CEPH)
- ✅ **Per-variant isolation**: Token stored in preview secrets only
- ✅ **Container-native**: Token lives in `/alloc/config.json` inside container
- ✅ **Control plane managed**: Uses mgmt-airo (V2) or local JSON (legacy)

**Token Storage:**

- Secret name: `GITHUB_TOKEN`
- Variant: `preview` only (publish doesn't need git access)
- Managed via: Existing secrets API (`POST /api/secrets/{appId}/variants/preview`)

**Non-Sensitive Metadata Storage:**

For repo URL, branch, and sync metadata, we use a simplified `git_remote_config` table:

```sql
CREATE TABLE IF NOT EXISTS git_remote_config (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,

  -- Remote identification
  remote_name TEXT NOT NULL DEFAULT 'origin',  -- 'origin', 'upstream', 'backup'

  -- Provider info (extensible for GitLab, Bitbucket)
  provider TEXT NOT NULL DEFAULT 'github',     -- 'github', 'gitlab', 'bitbucket'
  repo_url TEXT NOT NULL,                      -- NOT SENSITIVE: public repo URL
  default_branch TEXT DEFAULT 'main',

  -- Metadata (non-sensitive)
  last_sync_at INTEGER,                        -- Last push/pull timestamp
  sync_enabled BOOLEAN DEFAULT TRUE,           -- Can disable without deleting

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  UNIQUE(app_id, remote_name),                 -- One config per remote name per app
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_git_remote_app ON git_remote_config(app_id);
CREATE INDEX IF NOT EXISTS idx_git_remote_provider ON git_remote_config(provider);
```

### Example Records

**Database record (non-sensitive metadata):**

```typescript
{
  id: "gitcfg-uuid-123",
  appId: "app-123",
  remoteName: "origin",
  provider: "github",
  repoUrl: "https://github.com/user/my-app.git",  // Not sensitive
  defaultBranch: "main",
  lastSyncAt: 1735689600000,
  syncEnabled: true,
  createdAt: "2025-01-07T10:00:00Z",
  updatedAt: "2025-01-07T10:00:00Z"
}
```

**Secrets storage (via secrets API):**

```typescript
// Stored in /alloc/config.json inside preview container
{
  "GITHUB_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxx",  // Encrypted by control plane
  // ... other app secrets
}
```

### Multi-Repo Extensibility

**MVP (Single Remote):**

```
App A ──── origin (github.com/user/repo)
```

**Future (Multi-Remote):**

```
App A ──┬─ origin   (github.com/user/repo)
        ├─ upstream (github.com/org/repo)
        └─ backup   (gitlab.com/user/repo)
```

The `UNIQUE(app_id, remote_name)` constraint allows multiple remotes per app while preventing duplicates.

### Token Retrieval from Secrets

**How to access GITHUB_TOKEN:**

```typescript
// Read from container's secrets config
const execResult = await devSupervisor.exec({
  command: `node --experimental-strip-types -e "
    import('/app/airo-secrets/src/secrets-utils.ts').then(module => {
      const secrets = module.getSecrets();
      console.log(secrets.GITHUB_TOKEN || '');
    })
  "`,
  working_dir: "/app",
  timeout: 10,
  capture_output: true,
});

const token = execResult.stdout?.trim();
```

**Alternative: Direct config.json read (simpler):**

```typescript
const execResult = await devSupervisor.exec({
  command: `cat /alloc/config.json | jq -r '.GITHUB_TOKEN // ""'`,
  working_dir: "/app",
  timeout: 5,
  capture_output: true,
});

const token = execResult.stdout?.trim();
```

### Token Injection into Container

**Method: Ephemeral Git Credential Helper**

```bash
# Step 1: Read token from secrets (already in container)
TOKEN=$(cat /alloc/config.json | jq -r '.GITHUB_TOKEN')

# Step 2: Write credential file inside container (ephemeral)
echo "https://${TOKEN}@github.com" > /tmp/.git-credentials
chmod 600 /tmp/.git-credentials

# Step 3: Configure git to use it
git config --local credential.helper "store --file /tmp/.git-credentials"

# Step 4: Execute git command
git push -u origin main  # Git reads token from /tmp/.git-credentials

# Step 5: Cleanup (CRITICAL - always in finally block)
rm -f /tmp/.git-credentials
```

**Security Properties:**

- ✅ Token stored in secrets API (approved pattern, not in CEPH database)
- ✅ Token never in process arguments (`ps aux` won't show it)
- ✅ Token never in `.git/config` permanently
- ✅ Ephemeral credential file auto-deleted after operation
- ✅ File permissions `600` (owner read/write only)
- ✅ Container isolated (no cross-app leakage)
- ✅ Preview-only access (publish variant cannot access git token)

---

## Implementation Details

### 1. GitRemoteTokenManager Service (NEW)

**File:** `agents/src/services/GitRemoteTokenManager.ts`

```typescript
export interface GitRemoteConfig {
  appId: string;
  repoUrl: string; // e.g., "https://github.com/user/repo.git"
  provider: string; // "github", "gitlab", "bitbucket"
}

export class GitRemoteTokenManager {
  private devSupervisor: DevSupervisorClient;
  private logger = Logger.create({ service: "git-remote-token" });

  /**
   * Configure git credentials inside container
   *
   * Reads GITHUB_TOKEN from /alloc/config.json and sets up git credential helper.
   * All operations execute INSIDE CONTAINER via dev-supervisor.
   * Token never leaves the container - read, use, cleanup all happens inside.
   *
   * Prerequisites:
   * - User must have stored GITHUB_TOKEN in preview secrets via:
   *   POST /api/secrets/{appId}/variants/preview
   *   Body: { operations: { additions: [{ name: 'GITHUB_TOKEN', value: 'ghp_xxx' }] }}
   *
   * @param appId - Application ID (for logging only)
   * @param repoUrl - GitHub repository URL (used to extract hostname)
   * @throws Error if GITHUB_TOKEN not found in /alloc/config.json
   */
  async configureGitCredentials(appId: string, repoUrl: string): Promise<void> {
    this.logger.info("git-credentials.configure.begin", { appId });

    const url = new URL(repoUrl);
    const hostname = url.hostname;

    // Execute bash script INSIDE CONTAINER
    // Token is read, used, and stays within container
    const script = `
      # Read token from secrets (inside container)
      TOKEN=$(cat /alloc/config.json | jq -r '.GITHUB_TOKEN.VALUE // ""')

      # Validate token exists
      if [ -z "$TOKEN" ]; then
        echo "Error: GITHUB_TOKEN not found in preview secrets" >&2
        echo "Add via: POST /api/secrets/{appId}/variants/preview" >&2
        exit 1
      fi

      # Create ephemeral credential file
      echo "https://$TOKEN@${hostname}" > /tmp/.git-credentials
      chmod 600 /tmp/.git-credentials

      # Configure git to use credential file
      git config --local credential.helper "store --file /tmp/.git-credentials"

      echo "Git credentials configured"
    `;

    const execResult = await this.devSupervisor.exec({
      command: script,
      working_dir: "/app",
      timeout: 10,
      capture_output: true,
    });

    if (!execResult.success) {
      this.logger.error("git-credentials.configure.failure", {
        appId,
        stderr: execResult.stderr,
      });
      throw new Error(
        execResult.stderr || "Failed to configure git credentials",
      );
    }

    this.logger.info("git-credentials.configure.success", { appId });
  }

  /**
   * Cleanup credentials INSIDE CONTAINER
   * CRITICAL: Always call in finally block after git operations
   */
  async cleanupGitCredentials(appId: string): Promise<void> {
    await this.devSupervisor.exec({
      command: "rm -f /tmp/.git-credentials",
      working_dir: "/app",
      timeout: 5,
    });
    this.logger.info("git-credentials.cleanup.success", { appId });
  }
}
```

### 2. GitUtils Extensions (EXTEND EXISTING)

**File:** `agents/src/utils/git.ts`

```typescript
export class GitUtils {
  // ... existing methods ...

  /**
   * Add git remote
   * Execution: INSIDE CONTAINER
   */
  async addRemote(
    repoPath: string,
    remoteName: string,
    remoteUrl: string,
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(
      ["remote", "add", remoteName, remoteUrl],
      repoPath,
    );
  }

  /**
   * Get remote URL
   * Execution: INSIDE CONTAINER
   */
  async getRemoteUrl(
    repoPath: string,
    remoteName: string = "origin",
  ): Promise<string | null> {
    const result = await this.executeGitCommand(
      ["remote", "get-url", remoteName],
      repoPath,
    );
    return result.success ? result.stdout.trim() : null;
  }

  /**
   * Push to remote
   * Execution: INSIDE CONTAINER
   * Requires credentials configured via GitRemoteTokenManager
   */
  async push(
    repoPath: string,
    remoteName: string = "origin",
    branch: string = "main",
    options: { force?: boolean; setUpstream?: boolean } = {},
  ): Promise<GitCommandResult> {
    const args = ["push"];

    if (options.setUpstream) {
      args.push("-u");
    }
    if (options.force) {
      args.push("--force");
    }

    args.push(remoteName, branch);

    return this.executeGitCommand(args, repoPath, { timeout: 120000 }); // 2 min timeout
  }

  /**
   * Pull from remote
   * Execution: INSIDE CONTAINER
   * Requires credentials configured via GitRemoteTokenManager
   */
  async pull(
    repoPath: string,
    remoteName: string = "origin",
    branch: string = "main",
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(["pull", remoteName, branch], repoPath, {
      timeout: 120000,
    });
  }

  /**
   * Fetch from remote
   * Execution: INSIDE CONTAINER
   */
  async fetch(
    repoPath: string,
    remoteName: string = "origin",
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(["fetch", remoteName], repoPath);
  }

  /**
   * Check if remote exists
   * Execution: INSIDE CONTAINER
   */
  async hasRemote(
    repoPath: string,
    remoteName: string = "origin",
  ): Promise<boolean> {
    const result = await this.executeGitCommand(
      ["remote", "get-url", remoteName],
      repoPath,
    );
    return result.success;
  }
}
```

### 3. GitTool Updates (UPDATE EXISTING)

**File:** `agents/src/tools/git-tool.ts`

Replace stubbed implementations (lines 618-623) with:

```typescript
export interface GitToolOptions {
  operation:
    | "status"
    | "add"
    | "commit"
    | "diff"
    | "log"
    | "branch"
    | "checkout"
    | "push" // NEW
    | "pull" // NEW
    | "configure-remote" // NEW
    | "merge"
    | "stash"
    | "reset"
    | "revert"
    | "restore"
    | "clean";

  // NEW: Remote operation options
  remote?: string; // Remote name (default: 'origin')
  repoUrl?: string; // For configure-remote (repository URL)
  branch?: string; // For configure-remote (default branch name)
  forcePush?: boolean; // For push operation (use with caution)
}

export class GitTool {
  // ... existing methods ...

  /**
   * Handle configure-remote operation
   *
   * Configures git remote with repository URL and stores metadata.
   * User must separately add GITHUB_TOKEN via secrets API.
   */
  private async handleConfigureRemote(
    appPath: string,
    options: GitToolOptions,
  ): Promise<GitToolResult> {
    if (!options.repoUrl) {
      return {
        success: false,
        operation: "configure-remote",
        error: "repoUrl is required",
      };
    }

    const appId = this.extractAppIdFromPath(appPath);
    const remoteName = options.remote || "origin";

    try {
      // 1. Store non-sensitive metadata in database
      const gitRemoteRepo = new GitRemoteConfigRepository();
      await gitRemoteRepo.upsert({
        appId,
        remoteName,
        provider: "github",
        repoUrl: options.repoUrl,
        defaultBranch: options.branch || "main",
        syncEnabled: true,
      });

      // 2. Add git remote
      const remoteResult = await this.gitUtils.addRemote(
        appPath,
        remoteName,
        options.repoUrl,
      );

      if (
        !remoteResult.success &&
        !remoteResult.stderr.includes("already exists")
      ) {
        return {
          success: false,
          operation: "configure-remote",
          error: remoteResult.stderr,
        };
      }

      return {
        success: true,
        operation: "configure-remote",
        output: `Remote '${remoteName}' configured successfully.\n\nNext step: Add GITHUB_TOKEN to preview secrets via:\nPOST /api/secrets/${appId}/variants/preview\nBody: { operations: { additions: [{ name: 'GITHUB_TOKEN', value: 'ghp_xxx...' }] }}`,
      };
    } catch (error) {
      return {
        success: false,
        operation: "configure-remote",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle push operation
   */
  private async handlePush(
    appPath: string,
    options: GitToolOptions,
  ): Promise<GitToolResult> {
    const appId = this.extractAppIdFromPath(appPath);
    const tokenManager = new GitRemoteTokenManager(this.devSupervisor!);
    const remoteName = options.remote || "origin";

    try {
      // 1. Get remote URL
      const remoteUrl = await this.gitUtils.getRemoteUrl(appPath, remoteName);
      if (!remoteUrl) {
        return {
          success: false,
          operation: "push",
          error: `Remote '${remoteName}' not configured. Run configure-remote first.`,
        };
      }

      // 2. Get current branch
      const branch = await this.gitUtils.getCurrentBranch(appPath);

      // 3. Configure credentials
      await tokenManager.configureGitCredentials(appId, remoteUrl);

      try {
        // 4. Execute push
        const pushResult = await this.gitUtils.push(
          appPath,
          remoteName,
          branch,
          {
            force: options.forcePush || false,
            setUpstream: true,
          },
        );

        if (!pushResult.success) {
          return {
            success: false,
            operation: "push",
            error: pushResult.stderr,
            output: pushResult.stdout,
          };
        }

        return {
          success: true,
          operation: "push",
          output: `Successfully pushed to ${remoteName}/${branch}`,
        };
      } finally {
        // 5. ALWAYS cleanup credentials
        await tokenManager.cleanupGitCredentials(appId);
      }
    } catch (error) {
      return {
        success: false,
        operation: "push",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle pull operation
   */
  private async handlePull(
    appPath: string,
    options: GitToolOptions,
  ): Promise<GitToolResult> {
    const appId = this.extractAppIdFromPath(appPath);
    const tokenManager = new GitRemoteTokenManager(this.devSupervisor!);
    const remoteName = options.remote || "origin";

    try {
      // 1. Get remote URL
      const remoteUrl = await this.gitUtils.getRemoteUrl(appPath, remoteName);
      if (!remoteUrl) {
        return {
          success: false,
          operation: "pull",
          error: `Remote '${remoteName}' not configured`,
        };
      }

      // 2. Get current branch
      const branch = await this.gitUtils.getCurrentBranch(appPath);

      // 3. Configure credentials
      await tokenManager.configureGitCredentials(appId, remoteUrl);

      try {
        // 4. Execute pull
        const pullResult = await this.gitUtils.pull(
          appPath,
          remoteName,
          branch,
        );

        if (!pullResult.success) {
          // Check if merge conflict
          if (
            pullResult.stderr.includes("CONFLICT") ||
            pullResult.stderr.includes("conflict")
          ) {
            return {
              success: false,
              operation: "pull",
              error: "Merge conflicts detected. Manual resolution required.",
              warning: "Run git status to see conflicting files",
            };
          }

          return {
            success: false,
            operation: "pull",
            error: pullResult.stderr,
            output: pullResult.stdout,
          };
        }

        return {
          success: true,
          operation: "pull",
          output: `Successfully pulled from ${remoteName}/${branch}`,
        };
      } finally {
        // 5. ALWAYS cleanup credentials
        await tokenManager.cleanupGitCredentials(appId);
      }
    } catch (error) {
      return {
        success: false,
        operation: "pull",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Update main handler to route new operations
  private async executeGitOperationInternal(
    appPath: string,
    options: GitToolOptions,
  ): Promise<GitToolResult> {
    // ... existing code ...

    switch (options.operation) {
      // ... existing cases ...
      case "configure-remote":
        result = await this.handleConfigureRemote(appPath, options);
        break;
      case "push":
        result = await this.handlePush(appPath, options);
        break;
      case "pull":
        result = await this.handlePull(appPath, options);
        break;
      // ... existing cases ...
    }

    return result;
  }
}
```

### 4. API Routes (NEW)

**File:** `agents/src/server/routes/git-remote.ts`

```typescript
import { Router } from "express";
import { validateAppOwnership } from "../middleware/app-ownership.js";
import { AppRepository } from "../../database/repositories/AppRepository.js";
import { GitTool } from "../../tools/git-tool.js";
import { DevSupervisorClientFactory } from "../../utils/dev-supervisor-client-factory.js";
import { logger } from "../../logging/index.js";

const router = Router();
const appRepository = new AppRepository();

/**
 * Feature flag middleware
 */
function requireGitRemoteSync(req: any, res: any, next: any) {
  if (process.env.ENABLE_GIT_REMOTE_SYNC !== "true") {
    return res.status(403).json({
      success: false,
      error: "Git remote sync feature is not enabled",
    });
  }
  next();
}

/**
 * POST /apps/:id/git/remote/configure
 * Configure GitHub remote for an app
 *
 * Sets up git remote with repository URL and stores metadata.
 * User must separately add GITHUB_TOKEN to preview secrets.
 *
 * Body: { repoUrl: string, branch?: string }
 */
router.post(
  "/apps/:id/git/remote/configure",
  requireGitRemoteSync,
  validateAppOwnership,
  async (req, res) => {
    try {
      const { id: appId } = req.params;
      const { repoUrl, branch } = req.body;

      if (!repoUrl) {
        return res.status(400).json({
          success: false,
          error: "repoUrl is required",
        });
      }

      const app = appRepository.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          error: "App not found",
        });
      }

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);

      const result = await gitTool.executeGitOperation(app.path, {
        operation: "configure-remote",
        repoUrl,
        branch: branch || "main",
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
        });
      }

      return res.json({
        success: true,
        message: result.output,
        repoUrl,
      });
    } catch (error) {
      logger.error("route.git.remote.configure.error", {
        appId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: "Failed to configure remote",
      });
    }
  },
);

/**
 * POST /apps/:id/git/push
 * Push local commits to GitHub
 */
router.post(
  "/apps/:id/git/push",
  requireGitRemoteSync,
  validateAppOwnership,
  async (req, res) => {
    try {
      const { id: appId } = req.params;
      const { force = false } = req.body;

      const app = appRepository.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          error: "App not found",
        });
      }

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);

      const result = await gitTool.executeGitOperation(app.path, {
        operation: "push",
        forcePush: force,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          output: result.output,
        });
      }

      return res.json({
        success: true,
        message: result.output,
      });
    } catch (error) {
      logger.error("route.git.push.error", {
        appId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: "Failed to push to remote",
      });
    }
  },
);

/**
 * POST /apps/:id/git/pull
 * Pull changes from GitHub
 */
router.post(
  "/apps/:id/git/pull",
  requireGitRemoteSync,
  validateAppOwnership,
  async (req, res) => {
    try {
      const { id: appId } = req.params;

      const app = appRepository.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          error: "App not found",
        });
      }

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);

      const result = await gitTool.executeGitOperation(app.path, {
        operation: "pull",
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          warning: result.warning,
          output: result.output,
        });
      }

      return res.json({
        success: true,
        message: result.output,
      });
    } catch (error) {
      logger.error("route.git.pull.error", {
        appId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: "Failed to pull from remote",
      });
    }
  },
);

/**
 * GET /apps/:id/git/remote/status
 * Get remote sync status
 */
router.get(
  "/apps/:id/git/remote/status",
  requireGitRemoteSync,
  validateAppOwnership,
  async (req, res) => {
    try {
      const { id: appId } = req.params;

      const app = appRepository.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          error: "App not found",
        });
      }

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);

      // Get git status (includes ahead/behind)
      const statusResult = await gitTool.executeGitOperation(app.path, {
        operation: "status",
      });

      if (!statusResult.success) {
        return res.status(400).json({
          success: false,
          error: statusResult.error,
        });
      }

      return res.json({
        success: true,
        configured: true, // If this route succeeds, remote is configured
        branch: statusResult.status?.branch,
        ahead: statusResult.status?.ahead || 0,
        behind: statusResult.status?.behind || 0,
        isClean: statusResult.status?.isClean,
      });
    } catch (error) {
      logger.error("route.git.remote.status.error", {
        appId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: "Failed to get remote status",
      });
    }
  },
);

export default router;
```

**Register routes in main app:**

```typescript
// File: agents/src/server/routes/index.ts
import gitRemoteRoutes from "./git-remote.js";

// ... existing imports ...

export function registerRoutes(app: Express) {
  // ... existing routes ...
  app.use("/api", gitRemoteRoutes); // NEW
}
```

---

## Feature Flags & Safety

### Environment Variables

```bash
# agents/.env

# Global feature flag
ENABLE_GIT_REMOTE_SYNC=true           # Default: false (disabled)

# Product-specific enablement
GIT_REMOTE_SYNC_PRODUCTS=aab,paas     # Comma-separated list: 'aab', 'paas', or 'aab,paas'

# Product identifier (set per deployment)
PRODUCT_TYPE=aab                       # 'aab' (Airo App Builder) or 'paas' (Platform as a Service)
```

### Feature Flag Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                    Feature Flag Evaluation                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Check ENABLE_GIT_REMOTE_SYNC                               │
│      └── false? → Feature DISABLED                              │
│                                                                 │
│   2. Check PRODUCT_TYPE matches GIT_REMOTE_SYNC_PRODUCTS        │
│      └── PRODUCT_TYPE=aab, GIT_REMOTE_SYNC_PRODUCTS=aab,paas    │
│      └── 'aab' in ['aab', 'paas']? → YES → Feature ENABLED      │
│                                                                 │
│   3. Optional: Check experiment ID (future)                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Feature Service Integration

```typescript
// File: agents/src/services/features.ts

export type ProductType = "aab" | "paas";

export interface FeatureFlags {
  // ... existing flags ...
  ENABLE_GIT_REMOTE_SYNC: boolean; // NEW
}

export function getProductType(): ProductType {
  const product = process.env.PRODUCT_TYPE?.toLowerCase();
  if (product === "paas") return "paas";
  return "aab"; // Default to AAB
}

export function isGitRemoteSyncEnabled(): boolean {
  // 1. Check global flag
  if (process.env.ENABLE_GIT_REMOTE_SYNC !== "true") {
    return false;
  }

  // 2. Check product-specific enablement
  const enabledProducts = (process.env.GIT_REMOTE_SYNC_PRODUCTS || "")
    .toLowerCase()
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  // If no products specified, feature is disabled
  if (enabledProducts.length === 0) {
    return false;
  }

  const currentProduct = getProductType();
  return enabledProducts.includes(currentProduct);
}

export function getFeatureFlags(): FeatureFlags {
  return {
    // ... existing flags ...
    ENABLE_GIT_REMOTE_SYNC: isGitRemoteSyncEnabled(),
  };
}
```

### Middleware Implementation

```typescript
// File: agents/src/server/routes/git-remote.ts

import {
  isGitRemoteSyncEnabled,
  getProductType,
} from "../../services/features.js";

/**
 * Feature flag middleware
 * Checks both global flag and product-specific enablement
 */
function requireGitRemoteSync(req: any, res: any, next: any) {
  if (!isGitRemoteSyncEnabled()) {
    const product = getProductType();
    return res.status(403).json({
      success: false,
      error: `Git remote sync feature is not enabled for ${product.toUpperCase()}`,
    });
  }
  next();
}
```

### Rollout Strategy

**Phase 1: AAB Only (Initial Rollout)**

- Enable for Airo App Builder (AAB) first
- Gather feedback from AAB users
- Monitor for issues and iterate

**Phase 2: PaaS (Based on Feedback)**

- After successful AAB rollout, evaluate for PaaS
- May require adjustments based on PaaS-specific requirements

### Deployment Configuration

**Phase 1 - AAB Only (RECOMMENDED FOR INITIAL LAUNCH):**

```bash
ENABLE_GIT_REMOTE_SYNC=true
GIT_REMOTE_SYNC_PRODUCTS=aab
PRODUCT_TYPE=aab
```

**Phase 2 - Extend to PaaS (Future):**

```bash
ENABLE_GIT_REMOTE_SYNC=true
GIT_REMOTE_SYNC_PRODUCTS=aab,paas
PRODUCT_TYPE=paas  # Set per deployment
```

**Feature Disabled:**

```bash
ENABLE_GIT_REMOTE_SYNC=false
# Other vars don't matter when global flag is false
```

### Experiment ID Support (Future)

```typescript
// File: agents/src/middleware/feature-flag.ts (NEW)

export interface ExperimentContext {
  userId?: string;
  appId?: string;
  customerId?: string;
  productType?: ProductType;
}

export function isFeatureEnabled(
  featureName: string,
  context: ExperimentContext,
): boolean {
  // 1. Check global env variable
  const envFlag = process.env[`ENABLE_${featureName.toUpperCase()}`];
  if (envFlag === "false") return false;

  // 2. Check product-specific enablement
  const enabledProducts = (
    process.env[`${featureName.toUpperCase()}_PRODUCTS`] || ""
  )
    .toLowerCase()
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (enabledProducts.length > 0) {
    const currentProduct = context.productType || getProductType();
    if (!enabledProducts.includes(currentProduct)) {
      return false;
    }
  }

  // 3. Check experiment ID (future implementation)
  // Could integrate with: LaunchDarkly, Optimizely, or custom service
  // const experimentService = getExperimentService();
  // return experimentService.isEnabled(featureName, context);

  return envFlag === "true";
}

// Usage in routes
router.post("/apps/:id/git/push", validateAppOwnership, async (req, res) => {
  if (!isFeatureEnabled("GIT_REMOTE_SYNC", { appId: req.params.id })) {
    return res
      .status(403)
      .json({ error: "Feature not enabled for this product" });
  }
  // ... rest of handler ...
});
```

---

## Security Considerations

### 1. Token Storage ✅ **UPDATED: Using Secrets API**

- **Pattern**: Security-approved secrets pattern (same as e-commerce integration)
- **Storage Location**: `/alloc/config.json` inside preview container (NOT in CEPH database)
- **Encryption**: Managed by control plane adapter (mgmt-airo V2 or legacy JSON)
- **Isolation**: Per-app, per-variant (preview only)
- **Key Management**: Delegated to control plane (not stored in agents service)

**Why This Is Secure:**

- ✅ Token never in agents database (CEPH) - no exposure if storage compromised
- ✅ Container-isolated - each app has its own secrets
- ✅ Preview-only - publish variant cannot access token
- ✅ Control plane managed - encryption/decryption handled by mgmt-airo
- ✅ Industry standard pattern - same as other sensitive credentials

### 2. Token Injection ✅

- **Method**: Git credential helper with ephemeral file
- **File Location**: `/tmp/.git-credentials` (container-isolated)
- **Permissions**: `chmod 600` (owner read/write only)
- **Lifetime**: Created before operation, deleted immediately after
- **Process Safety**: Never appears in command-line arguments

### 3. Token Validation ✅

- **Pre-flight Check**: Validate token against GitHub API before storing
- **Scope Verification**: Ensure token has `repo` scope
- **Permission Check**: Verify read AND write access to repository
- **Reuse Logic**: Leverage existing `GitCloneService.validateToken()`

### 4. Repository Access Control ✅

- **User Isolation**: `validateAppOwnership` middleware ensures user owns app
- **Provider Validation**: Only allow GitHub, GitLab, Bitbucket (validated URLs)
- **HTTPS Only**: All git operations use HTTPS (no SSH)

### 5. Merge Conflict Handling ⚠️

- **Strategy**: Detect and block (no auto-merge in MVP)
- **Detection**: Check stderr for "CONFLICT" keyword
- **User Action**: Return error, require manual resolution
- **Future**: AI agent assistance for conflict resolution

### 6. Secrets Exposure Prevention 🔴 **CRITICAL**

**Risk:** Users accidentally commit `.env`, `/alloc/config.json`, or API keys to GitHub.

**Phase 1 Mitigation (MVP):**

- Document best practices in UI/docs
- Provide `.gitignore` template with critical paths

**Phase 2 Mitigation (Future):**

- Pre-push hook with secret scanning (gitleaks, trufflehog)
- Block push if secrets detected
- UI warning before push operation

---

## Implementation Tasks

### Phase 1: MVP

**Database:**

- [ ] Create simplified `git_remote_config` table (new migration in schema.ts)
  - Only non-sensitive metadata (NO token fields)
  - Fields: `app_id`, `remote_name`, `provider`, `repo_url`, `default_branch`, `last_sync_at`, `sync_enabled`
- [ ] Create `GitRemoteConfig` TypeScript interface
- [ ] Create `GitRemoteConfigRepository` class

**Services:**

- [ ] Create `GitRemoteTokenManager` service
  - `configureGitCredentials()`: Read token from `/alloc/config.json` and set up `/tmp/.git-credentials` (all inside container)
  - `cleanupGitCredentials()`: Remove ephemeral credential file
  - Token never leaves container - read, use, cleanup all happens inside
- [ ] Extend `GitUtils` with remote operations (`addRemote`, `setRemoteUrl`, `push`, `pull`, `getRemoteUrl`)
- [ ] Update `GitTool` with `handleConfigureRemote`, `handlePush`, `handlePull`
  - Configure remote only stores repo URL (no token handling)

**API Routes:**

- [ ] Create API routes in `git-remote.ts`
  - `/configure`: Accepts repoUrl and branch (no token)
  - `/push`: Reads token from container secrets
  - `/pull`: Reads token from container secrets
- [ ] Register routes in main app
- [ ] Add feature flag middleware: `requireGitRemoteSync`

**Pre-Validations:**

- [ ] Container availability check (`devSupervisor.isAvailable()`)
- [ ] Remote URL validation (valid GitHub URL format)
- [ ] Check GITHUB_TOKEN exists in preview secrets before git operations

**Security:**

- [ ] Verify token NEVER read by agents service (only inside container via bash)
- [ ] Credential cleanup verification (try/finally blocks in push/pull handlers)
- [ ] Security audit: verify token never in logs/process list/agents memory
- [ ] Confirm token only accessible in preview variant
- [ ] User manages tokens via existing secrets API (POST /api/secrets)

**Testing:**

- [ ] Integration tests for configure/push/pull workflow
- [ ] Error handling: missing token, invalid token, network failures
- [ ] Test token isolation (preview vs publish)
- [ ] Test credential cleanup (verify /tmp/.git-credentials deleted)

**Documentation:**

- [ ] API documentation
  - Configure endpoint (repoUrl, branch)
  - Push/pull endpoints
  - User must add GITHUB_TOKEN via secrets API separately
- [ ] User guide (step-by-step: add token to secrets → configure remote → push/pull)
- [ ] Security documentation (why token never in agents service)

### Phase 2: Enhancements (Future)

- [ ] Pre-push secret scanning
- [ ] Multiple git providers (GitLab, Bitbucket)
- [ ] Experiment ID-based feature flags
- [ ] GitHub webhook integration for remote changes
- [ ] Advanced conflict resolution UI

---

## Product Decisions

### **D1: Token Expiration** ✅ DECIDED

**Decision:** Option A - Manual reconfiguration when token expires

**Implementation:**

- Token stored in preview secrets (via secrets API)
- No expiration tracking in MVP (GitHub PATs can be created without expiration)
- When git operations fail with 401/403, return clear error: "GitHub authentication failed. Token may be expired or revoked. Please reconfigure."
- User must manually reconfigure via UI to update token
- Token stored in secrets API only (NOT in `.git/config` or agents database)

---

### **D2: Git Provider Support** ✅ DECIDED

**Decision:** GitHub only for MVP, design for extensibility

**Implementation:**

```typescript
// Extensible provider interface
interface GitProvider {
  name: "github" | "gitlab" | "bitbucket";
  validateToken(repoUrl: string, token: string): Promise<boolean>;
  getApiUrl(repoUrl: string): string;
}

// Easy to add new providers
const providers: Record<string, GitProvider> = {
  github: new GitHubProvider(),
  // gitlab: new GitLabProvider(),  // Future
  // bitbucket: new BitbucketProvider(),  // Future
};
```

**Why extensible:**

- Abstract provider logic into interface
- Separate validation per provider
- Easy to add GitLab/Bitbucket later without refactoring

---

### **D3: Merge Conflict Resolution** ✅ DECIDED

**Problem:** Users cannot SSH into containers to manually resolve conflicts.

**Decision:** Automatic strategy based on sync direction (no user choice needed)

| Operation | Direction          | Strategy | Behavior           |
| --------- | ------------------ | -------- | ------------------ |
| **PULL**  | GitHub → Container | `theirs` | Remote changes win |
| **PUSH**  | Container → GitHub | `ours`   | Local changes win  |

**Note:** All git commands run INSIDE the container.

**Implementation:**

```typescript
// PULL: Always use "theirs" (accept remote changes)
async pull(
  repoPath: string,
  remoteName: string = 'origin',
  branch: string = 'main'
): Promise<GitCommandResult> {
  return this.executeGitCommand(
    ['pull', '-X', 'theirs', remoteName, branch],
    repoPath,
    { timeout: 120000 }
  );
}

// PUSH: If rejected due to conflicts, use force (local wins)
// User must explicitly request force push via API
async push(
  repoPath: string,
  remoteName: string = 'origin',
  branch: string = 'main',
  options: { force?: boolean; setUpstream?: boolean } = {}
): Promise<GitCommandResult> {
  const args = ['push'];
  if (options.setUpstream) args.push('-u');
  if (options.force) args.push('--force');
  args.push(remoteName, branch);
  return this.executeGitCommand(args, repoPath, { timeout: 120000 });
}
```

**Rationale:**

- PULL: User wants latest from GitHub → remote should win
- PUSH: User wants to publish local work → local should win (if forced)

---

### **D4: Push Behavior** ✅ DECIDED

**Decision:** Manual push only (user clicks button in UI)

**Why:**

- ✅ User has full control
- ✅ Can review changes before pushing
- ✅ No accidental pushes
- ✅ Simpler implementation (no debouncing/batching)

---

### **D5: Secret Scanning** ✅ DECIDED

**Decision:** Phase 2 (not in MVP)

**MVP Mitigation:**

- Provide `.gitignore` template with critical paths
- Document best practices in UI
- Show warning before first push: "Review your code for secrets before pushing"

**Phase 2 Implementation:**

- Pre-push hook with `gitleaks` or `trufflehog`
- Block push if secrets detected
- List detected secret patterns in error message

---

## Success Metrics

### Phase 1 (MVP)

- [ ] Feature flag can be toggled on/off
- [ ] Users can configure GitHub remote
- [ ] Users can push local commits to GitHub
- [ ] Users can pull remote commits to local
- [ ] Zero token leakage incidents
- [ ] Push/pull operations complete in <30 seconds

### Phase 2 (Enhancements)

- [ ] <1% of pushes blocked by secret scanning
- [ ] 90% of merge conflicts auto-resolved (if implemented)
- [ ] Zero credential exposure in logs/process list

---

## Testing Strategy

### Unit Tests

- `GitRemoteTokenManager`: Token encryption, storage, retrieval, cleanup
- `GitUtils`: Remote operations (add, push, pull, fetch)
- `GitTool`: Operation handlers (configure, push, pull)

### Integration Tests

- End-to-end: Configure remote → Push → Pull
- Error scenarios: Invalid token, merge conflicts, network timeout
- Security: Credential cleanup, token validation

### Manual Testing Checklist

- [ ] Configure remote with valid token → Success
- [ ] Configure remote with invalid token → Error
- [ ] Push with no remote configured → Error message
- [ ] Push with local commits → Success
- [ ] Push with no local changes → No-op
- [ ] Pull with no remote changes → No-op
- [ ] Pull with remote changes → Success
- [ ] Pull with merge conflicts → Error with conflict files listed
- [ ] Verify `/tmp/.git-credentials` deleted after operation
- [ ] Verify token not in process list during operation
- [ ] Verify token not in logs

---

## Appendix: Command Execution Locations

All git commands execute **INSIDE CONTAINER** via dev-supervisor:

```typescript
// Host Machine (Agents Server)
const devSupervisor = DevSupervisorClientFactory.createForApp(appId);

// Execute inside container
await devSupervisor.exec({
  command: "git push -u origin main",
  working_dir: "/app", // ← INSIDE CONTAINER
  timeout: 60,
});
```

**File System Mapping:**

```
Host:      /tmp/apps/app-123/app/
              ↓ (mounted)
Container: /app/
```

**Socket Communication:**

```
Host:      /tmp/apps/app-123/dev-supervisor.sock
              ↓ (Unix socket)
Container: dev-supervisor process (PID 1)
```

---

## Happy Path Testing - Quick Commands

### Prerequisites

```bash
# In agents/.env
ENABLE_GIT_REMOTE_SYNC=true
GIT_REMOTE_SYNC_PRODUCTS=aab-v1
AUTH_TYPE=none
NODE_ENV=development
```

Restart services: `pnpm run dev`

---

### Step 1: Create App

```bash
curl -X POST http://localhost:3000/api/apps/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Git Sync App",
    "initialPrompt": "Create a simple Next.js homepage"
  }'
```

**Save the `appId` from response, then wait 30-60 seconds for status "running"**

---

### Step 2: Check App Status

```bash
curl http://localhost:4000/api/apps/{APP_ID}
```

Poll until `status: "running"`

---

### Step 3: Configure GitHub Token in Container

```bash
docker exec -it airo-{APP_ID} sh -c '
  mkdir -p /alloc
  echo "{\"GITHUB_TOKEN\":{\"VALUE\":\"ghp_YOUR_TOKEN_HERE\"}}" > /alloc/config.json
  chmod 600 /alloc/config.json
'
```

**Replace `ghp_YOUR_TOKEN_HERE` with your actual GitHub Personal Access Token**

---

### Step 4: Configure Git Remote

```bash
curl -X POST http://localhost:4000/apps/{APP_ID}/git/remote/configure \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/YOUR_USERNAME/test-repo.git",
    "remoteName": "origin",
    "branch": "main"
  }'
```

**Expected:** `{"success": true, "message": "Git remote configured successfully"}`

---

### Step 5: Get Remote Status

```bash
curl http://localhost:4000/apps/{APP_ID}/git/remote/status
```

**Expected:** Returns array of configured remotes with `syncEnabled: true`

---

### Step 6: Push to GitHub

```bash
curl -X POST http://localhost:4000/apps/{APP_ID}/git/push \
  -H "Content-Type: application/json" \
  -d '{
    "remoteName": "origin",
    "branch": "main",
    "forcePush": false
  }'
```

**Expected:** `{"success": true, "message": "Successfully pushed to git remote"}`

**Verify:** Check `https://github.com/YOUR_USERNAME/test-repo` to see app files

---

### Step 7: Pull from GitHub

**First, make a change in GitHub (edit a file via web UI), then:**

```bash
curl -X POST http://localhost:4000/apps/{APP_ID}/git/pull \
  -H "Content-Type: application/json" \
  -d '{
    "remoteName": "origin",
    "branch": "main"

  }'
```

**Expected:** `{"success": true, "message": "Successfully pulled from git remote"}`

---

### Quick Reference

- Replace `{APP_ID}` with your actual app ID in all commands
- Replace `YOUR_USERNAME` and `ghp_YOUR_TOKEN_HERE` with your actual values
- Test sequence: Create app → Wait for running → Configure token → Configure remote → Get status → Push → Pull
