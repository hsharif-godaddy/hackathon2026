# GitHub Sync Feature - Class Diagram

**Created:** 2026-01-12
**Related:**

- [github-sync-design.md](./github-sync-design.md) - Complete feature design and architecture documentation
- `github-sync-implementation-plan.md` - Step-by-step implementation plan

---

## System Architecture

```mermaid
classDiagram
    %% API Layer
    class GitRemoteRouter {
        +POST /apps/:id/git/remote/configure
        +POST /apps/:id/git/push
        +POST /apps/:id/git/pull
        +GET /apps/:id/git/remote/status
        -requireGitRemoteSync() middleware
    }

    %% Tool Layer
    class GitTool {
        -devSupervisor: DevSupervisorClient
        -db: Database
        -gitUtils: GitUtils
        +executeGitOperation(path, options) GitToolResult
        -handleConfigureRemote(path, options) GitToolResult
        -handlePush(path, options) GitToolResult
        -handlePull(path, options) GitToolResult
    }

    class GitToolOptions {
        +operation: string
        +repoUrl?: string
        +branch?: string
        +remote?: string
        +forcePush?: boolean
    }

    class GitToolResult {
        +success: boolean
        +operation: string
        +output?: string
        +error?: string
    }

    %% Service Layer
    class GitRemoteTokenManager {
        -devSupervisor: DevSupervisorClient
        -logger: Logger
        -gitProviderFactory: GitProviderFactory
        +configureGitCredentials(appId, repoUrl) Promise~void~
        +cleanupGitCredentials(appId) Promise~void~
        -getProviderCredentialScript(provider, hostname) string
    }

    class GitProviderFactory {
        +getProvider(repoUrl) IGitProvider
        +detectProvider(repoUrl) ProviderType
    }

    class IGitProvider {
        <<interface>>
        +name: ProviderType
        +formatCredentialUrl(hostname, token) string
        +validateToken(token) Promise~boolean~
        +getApiBaseUrl() string
        +getHostname(repoUrl) string
    }

    class GitHubProvider {
        +name: ProviderType.GITHUB
        +formatCredentialUrl(hostname, token) string
        +validateToken(token) Promise~boolean~
        +getApiBaseUrl() string
        +getHostname(repoUrl) string
    }

    class GitLabProvider {
        <<future>>
        +name: ProviderType.GITLAB
        +formatCredentialUrl(hostname, token) string
        +validateToken(token) Promise~boolean~
        +getApiBaseUrl() string
        +getHostname(repoUrl) string
    }

    class BitbucketProvider {
        <<future>>
        +name: ProviderType.BITBUCKET
        +formatCredentialUrl(hostname, token) string
        +validateToken(token) Promise~boolean~
        +getApiBaseUrl() string
        +getHostname(repoUrl) string
    }

    class ProviderType {
        <<enum>>
        GITHUB
        GITLAB
        BITBUCKET
    }

    class GitUtils {
        -devSupervisor: DevSupervisorClient
        +addRemote(path, name, url) GitCommandResult
        +setRemoteUrl(path, name, url) GitCommandResult
        +getRemoteUrl(path, name) string | null
        +push(path, remote, branch, options) GitCommandResult
        +pull(path, remote, branch) GitCommandResult
        +fetch(path, remote) GitCommandResult
        +hasRemote(path, name) boolean
        +getCurrentBranch(path) string
        +executeGitCommand(args, path, options) GitCommandResult
    }

    class GitCommandResult {
        +success: boolean
        +stdout: string
        +stderr: string
        +exit_code: number
    }

    %% Repository Layer
    class GitRemoteConfigRepository {
        -db: Database
        +findByAppAndRemote(appId, remoteName) GitRemoteConfig | null
        +findByAppId(appId) GitRemoteConfig[]
        +upsert(params) GitRemoteConfig
        +update(id, params) GitRemoteConfig
        +delete(id) boolean
        +deleteByAppId(appId) number
    }

    class GitRemoteConfig {
        +id: string
        +appId: string
        +remoteName: string
        +provider: string
        +repoUrl: string
        +defaultBranch: string
        +lastSyncAt: number | null
        +syncEnabled: boolean
        +createdAt: string
        +updatedAt: string
    }

    class CreateGitRemoteConfigParams {
        +appId: string
        +remoteName: string
        +provider: string
        +repoUrl: string
        +defaultBranch: string
        +syncEnabled?: boolean
    }

    %% Infrastructure
    class DevSupervisorClient {
        +exec(command, options) ExecResult
        +isAvailable() boolean
    }

    class Database {
        +prepare(sql) Statement
    }

    class Logger {
        +info(event, data) void
        +error(event, data) void
        +warn(event, data) void
    }

    %% Existing Classes (Referenced)
    class AppRepository {
        +findById(id) App | null
    }

    class App {
        +id: string
        +path: string
        +name: string
    }

    %% Relationships

    %% API → Tool
    GitRemoteRouter --> GitTool : uses
    GitRemoteRouter --> AppRepository : uses
    GitRemoteRouter --> GitRemoteConfigRepository : uses

    %% Tool → Service/Repository
    GitTool --> GitRemoteTokenManager : creates & uses
    GitTool --> GitUtils : uses
    GitTool --> GitRemoteConfigRepository : uses
    GitTool --> DevSupervisorClient : uses
    GitTool ..> GitToolOptions : accepts (request)
    GitTool ..> GitToolResult : returns (response)

    %% Service → Infrastructure
    GitRemoteTokenManager --> DevSupervisorClient : uses
    GitRemoteTokenManager --> Logger : uses
    GitRemoteTokenManager --> GitProviderFactory : uses

    %% Provider Pattern
    GitProviderFactory --> IGitProvider : creates
    GitProviderFactory ..> ProviderType : uses
    IGitProvider <|.. GitHubProvider : implements
    IGitProvider <|.. GitLabProvider : implements (future)
    IGitProvider <|.. BitbucketProvider : implements (future)

    GitUtils --> DevSupervisorClient : uses
    GitUtils ..> GitCommandResult : returns (response)

    %% Repository → Database/Models
    GitRemoteConfigRepository --> Database : uses
    GitRemoteConfigRepository ..> GitRemoteConfig : returns (response)
    GitRemoteConfigRepository ..> CreateGitRemoteConfigParams : accepts (request)

    %% Existing Infrastructure
    AppRepository --> Database : uses
    AppRepository ..> App : returns (response)
```

---

## Component Breakdown

### 1. API Layer (Express Routes)

**GitRemoteRouter** (`agents/src/server/routes/git-remote.ts`)

```
📍 Entry point for all git remote operations
📍 Middleware: Feature flag check, app ownership validation
📍 Orchestrates: GitTool, AppRepository, GitRemoteConfigRepository
```

**Endpoints:**

- `POST /apps/:id/git/remote/configure` → Configure remote
- `POST /apps/:id/git/push` → Push to GitHub
- `POST /apps/:id/git/pull` → Pull from GitHub
- `GET /apps/:id/git/remote/status` → Get remote status

---

### 2. Tool Layer

**GitTool** (`agents/src/tools/git-tool.ts`)

```
📍 Main orchestrator for git operations
📍 NEW: Handles configure-remote, push, pull
📍 Existing: Handles status, add, commit, diff, log, etc.
```

**New Methods:**

- `handleConfigureRemote()` → Set up remote + store metadata
- `handlePush()` → Configure credentials → push → cleanup
- `handlePull()` → Configure credentials → pull → cleanup

**Flow for Push/Pull:**

```
1. Validate remote exists
2. Get current branch
3. Configure credentials (GitRemoteTokenManager)
4. Execute git operation (GitUtils)
5. Update metadata (GitRemoteConfigRepository)
6. Cleanup credentials (ALWAYS in finally block)
```

---

### 3. Service Layer

**GitRemoteTokenManager** (`agents/src/services/GitRemoteTokenManager.ts`)

```
📍 NEW service for credential management
📍 Token NEVER read by agents service
📍 All operations happen INSIDE container
📍 Uses GitProviderFactory to handle provider-specific logic
```

**Key Methods:**

`configureGitCredentials(appId, repoUrl)`

```typescript
// 1. Detect provider via GitProviderFactory (GitHub/GitLab/Bitbucket)
// 2. Get provider-specific credential format
// 3. Execute bash script INSIDE container via dev-supervisor:
//    - Read token from /alloc/config.json
//    - Create /tmp/.git-credentials with provider-specific format
//    - Configure git credential helper
// Token stays in container - never in agents service
```

`cleanupGitCredentials(appId)`

```typescript
// Executes INSIDE container:
// Delete /tmp/.git-credentials
// MUST be called in finally block
```

---

**GitProviderFactory** (`agents/src/services/git-providers/GitProviderFactory.ts`)

```
📍 NEW factory for provider detection and instantiation
📍 Interface-based design for extensibility
📍 Currently implements GitHub, extensible for GitLab/Bitbucket
```

**Key Methods:**

`getProvider(repoUrl): IGitProvider`

```typescript
// Detects provider from URL and returns appropriate implementation
// Currently: GitHubProvider
// Future: GitLabProvider, BitbucketProvider
```

`detectProvider(repoUrl): ProviderType`

```typescript
// Returns enum: GITHUB | GITLAB | BITBUCKET
// Parses URL hostname to determine provider
```

---

**IGitProvider Interface** (`agents/src/services/git-providers/IGitProvider.ts`)

```
📍 Interface for all git providers
📍 Ensures consistent behavior across providers
📍 Easy to extend for new providers
```

**Interface Contract:**

```typescript
interface IGitProvider {
  name: ProviderType;
  formatCredentialUrl(hostname: string, token: string): string;
  validateToken(token: string): Promise<boolean>;
  getApiBaseUrl(): string;
  getHostname(repoUrl: string): string;
}
```

---

**GitHubProvider** (`agents/src/services/git-providers/GitHubProvider.ts`)

```
📍 GitHub-specific implementation
📍 Credential format: https://TOKEN@github.com
📍 API: api.github.com
```

**Implementation Details:**

- Token format: Personal Access Token (ghp_xxxxx)
- Auth URL: `https://{token}@github.com/user/repo.git`
- Validation: GET api.github.com/user

---

**GitLabProvider** (`agents/src/services/git-providers/GitLabProvider.ts`) - FUTURE

```
📍 GitLab-specific implementation (not yet implemented)
📍 Credential format: https://oauth2:TOKEN@gitlab.com
📍 API: gitlab.com/api/v4
```

---

**BitbucketProvider** (`agents/src/services/git-providers/BitbucketProvider.ts`) - FUTURE

```
📍 Bitbucket-specific implementation (not yet implemented)
📍 Credential format: https://USERNAME:APP_PASSWORD@bitbucket.org
📍 API: api.bitbucket.org/2.0
```

---

**GitUtils** (`agents/src/utils/git.ts`)

```
📍 EXTEND existing class
📍 Add remote operations
📍 All commands execute inside container via dev-supervisor
```

**New Methods:**

- `addRemote()` → `git remote add origin {url}`
- `setRemoteUrl()` → `git remote set-url origin {url}`
- `getRemoteUrl()` → `git remote get-url origin`
- `push()` → `git push origin main [--force]`
- `pull()` → `git pull origin main`
- `fetch()` → `git fetch origin`
- `hasRemote()` → Check if remote exists

---

### 4. Repository Layer

**GitRemoteConfigRepository** (`agents/src/database/repositories/GitRemoteConfigRepository.ts`)

```
📍 NEW repository for git remote metadata
📍 Stores ONLY non-sensitive data (no tokens)
📍 Uses better-sqlite3
```

**Data Stored:**

- Repository URL (public, not sensitive)
- Remote name (origin, upstream, etc.)
- Default branch (main, master, etc.)
- Provider (github, gitlab, bitbucket)
- Last sync timestamp
- Enabled/disabled flag

**Data NOT Stored:**

- ❌ GitHub tokens (stored in secrets API)
- ❌ Credentials (ephemeral only)

---

### 5. Domain Models

**GitRemoteConfig**

```typescript
{
  id: "gitcfg-abc123",
  appId: "app-123",
  remoteName: "origin",
  provider: "github",
  repoUrl: "https://github.com/user/repo.git",
  defaultBranch: "main",
  lastSyncAt: 1673524800000,
  syncEnabled: true,
  createdAt: "2025-01-07T10:00:00Z",
  updatedAt: "2025-01-07T10:00:00Z"
}
```

---

## Sequence Diagrams

### Configure Remote Flow

```mermaid
sequenceDiagram
    participant UI as User/UI
    participant API as GitRemoteRouter
    participant Tool as GitTool
    participant Repo as GitRemoteConfigRepository
    participant Utils as GitUtils
    participant DS as DevSupervisor
    participant Container as Preview Container

    UI->>API: POST /apps/:id/git/remote/configure<br/>{repoUrl, branch}
    API->>Tool: executeGitOperation("configure-remote")

    Tool->>Repo: upsert({appId, repoUrl, ...})
    Repo-->>Tool: GitRemoteConfig

    Tool->>Utils: addRemote(path, "origin", repoUrl)
    Utils->>DS: exec("git remote add origin ...")
    DS->>Container: Execute command
    Container-->>DS: Success
    DS-->>Utils: GitCommandResult
    Utils-->>Tool: Success

    Tool-->>API: {success: true, output: "..."}
    API-->>UI: 200 OK
```

---

### Push Flow

```mermaid
sequenceDiagram
    participant UI as User/UI
    participant API as GitRemoteRouter
    participant Tool as GitTool
    participant TM as GitRemoteTokenManager
    participant Utils as GitUtils
    participant DS as DevSupervisor
    participant Container as Preview Container
    participant GH as GitHub

    UI->>API: POST /apps/:id/git/push
    API->>Tool: executeGitOperation("push")

    Tool->>Utils: getRemoteUrl(path)
    Utils-->>Tool: "https://github.com/user/repo.git"

    Tool->>Utils: getCurrentBranch(path)
    Utils-->>Tool: "main"

    Tool->>TM: configureGitCredentials(appId, repoUrl)
    TM->>DS: exec(bash script)
    Note over DS,Container: Script runs INSIDE container:<br/>1. TOKEN=$(cat /alloc/config.json | jq -r .GITHUB_TOKEN.VALUE)<br/>2. echo "https://$TOKEN@github.com" > /tmp/.git-credentials<br/>3. chmod 600 /tmp/.git-credentials<br/>4. git config credential.helper "store --file /tmp/.git-credentials"
    DS->>Container: Execute bash script
    Container-->>DS: Credentials configured
    TM-->>Tool: Success

    Tool->>Utils: push(path, "origin", "main")
    Utils->>DS: exec("git push origin main")
    DS->>Container: Execute push
    Container->>GH: git push (with credentials)
    GH-->>Container: Push accepted
    Container-->>DS: Success
    DS-->>Utils: GitCommandResult
    Utils-->>Tool: Success

    Note over Tool: Finally block (ALWAYS executed)
    Tool->>TM: cleanupGitCredentials(appId)
    TM->>DS: exec("rm -f /tmp/.git-credentials")
    DS->>Container: Delete credentials
    Container-->>DS: Deleted
    TM-->>Tool: Cleaned up

    Tool-->>API: {success: true, output: "..."}
    API-->>UI: 200 OK
```

---

### Pull Flow

```mermaid
sequenceDiagram
    participant UI as User/UI
    participant Tool as GitTool
    participant TM as GitRemoteTokenManager
    participant Utils as GitUtils
    participant Container as Preview Container
    participant GH as GitHub

    UI->>Tool: executeGitOperation("pull")

    Tool->>TM: configureGitCredentials(appId, repoUrl)
    Note over TM,Container: Token read/used INSIDE container
    TM-->>Tool: Configured

    Tool->>Utils: pull(path, "origin", "main")
    Utils->>Container: git pull origin main
    Container->>GH: git pull (with credentials)
    GH-->>Container: Send commits
    Container-->>Utils: Success
    Utils-->>Tool: GitCommandResult

    Note over Tool: Finally block
    Tool->>TM: cleanupGitCredentials(appId)
    TM-->>Tool: Cleaned up

    Tool-->>UI: {success: true}
```

---

## Data Flow

### Token Never Leaves Container

```
┌─────────────────────────────────────────────────────────────────┐
│                         Security Boundary                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User → App Service → Control Plane → /alloc/config.json       │
│        (Secrets API)   (mgmt-airo)     (Container)              │
│                                                                 │
│  ✅ Token stored in container                                   │
│  ✅ Token encrypted by control plane                            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                    When git push/pull happens                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Agents Service → DevSupervisor → Container                     │
│  (Sends bash      (Unix socket)    (Bash script runs)           │
│   script)                                                        │
│                                                                 │
│  Inside Container:                                              │
│  1. Read token: cat /alloc/config.json | jq -r .GITHUB_TOKEN   │
│  2. Use token: echo "https://$TOKEN@github.com" > /tmp/.git-... │
│  3. Git operation: git push origin main                         │
│  4. Cleanup: rm -f /tmp/.git-credentials                        │
│                                                                 │
│  ✅ Token NEVER sent to agents service                          │
│  ✅ Token NEVER in logs or process arguments                    │
│  ✅ Token ONLY in container memory during operation             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

```sql
-- New table for git remote metadata
CREATE TABLE IF NOT EXISTS git_remote_config (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,

  -- Remote identification
  remote_name TEXT NOT NULL DEFAULT 'origin',

  -- Provider info
  provider TEXT NOT NULL DEFAULT 'github',
  repo_url TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',

  -- Metadata (non-sensitive)
  last_sync_at INTEGER,
  sync_enabled BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  UNIQUE(app_id, remote_name),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_git_remote_app ON git_remote_config(app_id);
CREATE INDEX IF NOT EXISTS idx_git_remote_provider ON git_remote_config(provider);
```

**What's Stored:**

- ✅ Repository URL (public)
- ✅ Remote name (origin, upstream)
- ✅ Provider (github, gitlab)
- ✅ Branch name
- ✅ Sync metadata

**What's NOT Stored:**

- ❌ GitHub tokens (in secrets API)
- ❌ Credentials (ephemeral only)

---

## File Structure

```
agents/
├── src/
│   ├── database/
│   │   ├── schema.ts (ADD git_remote_config table)
│   │   └── repositories/
│   │       └── GitRemoteConfigRepository.ts (NEW)
│   │
│   ├── services/
│   │   ├── GitRemoteTokenManager.ts (NEW)
│   │   └── git-providers/
│   │       ├── IGitProvider.ts (NEW - Interface)
│   │       ├── GitProviderFactory.ts (NEW - Factory)
│   │       ├── GitHubProvider.ts (NEW - GitHub implementation)
│   │       ├── GitLabProvider.ts (FUTURE - GitLab implementation)
│   │       └── BitbucketProvider.ts (FUTURE - Bitbucket implementation)
│   │
│   ├── tools/
│   │   └── git-tool.ts (EXTEND - add push/pull/configure)
│   │
│   ├── utils/
│   │   └── git.ts (EXTEND - add remote operations)
│   │
│   ├── types/
│   │   ├── git-remote.ts (NEW)
│   │   └── git-provider.ts (NEW - ProviderType enum)
│   │
│   └── server/
│       └── routes/
│           └── git-remote.ts (NEW)
│
└── __tests__/
    ├── services/
    │   └── git-providers/
    │       ├── GitProviderFactory.test.ts
    │       └── GitHubProvider.test.ts
    └── ... (unit and integration tests)
```

---

## Key Design Decisions

### 1. Token Management

- **Decision:** Use secrets API (not database)
- **Why:** Security-approved pattern, no CEPH exposure
- **How:** Token stored in `/alloc/config.json` by control plane

### 2. Token Access

- **Decision:** Read token inside container via bash
- **Why:** Token never in agents service memory
- **How:** Bash script reads config.json, creates ephemeral credentials

### 3. Credential Cleanup

- **Decision:** Always cleanup in finally block
- **Why:** Ensure credentials deleted even on error
- **How:** `cleanupGitCredentials()` in try/finally

### 4. Metadata Storage

- **Decision:** Store repo URL in database
- **Why:** Need to persist configuration
- **How:** New `git_remote_config` table (no sensitive data)

### 5. Git Operations

- **Decision:** All commands execute inside container
- **Why:** Container has git repo and credentials
- **How:** DevSupervisorClient.exec()

### 6. Provider Pattern

- **Decision:** Interface-based design with factory pattern
- **Why:** GitHub, GitLab, and Bitbucket have different auth formats and APIs
- **How:** `IGitProvider` interface + `GitProviderFactory` for detection
- **Current:** GitHub implementation only
- **Future:** Easy extension for GitLab and Bitbucket

---

## Provider Pattern Design

### Interface-Based Architecture

The system uses a **Factory Pattern** with interface-based design for handling multiple git providers:

```typescript
// 1. Provider Type Enum
export enum ProviderType {
  GITHUB = "github",
  GITLAB = "gitlab",
  BITBUCKET = "bitbucket",
}

// 2. Provider Interface (Contract)
export interface IGitProvider {
  name: ProviderType;

  // Format credential URL for git credential helper
  formatCredentialUrl(hostname: string, token: string): string;

  // Validate token via provider API (optional, for future)
  validateToken(token: string): Promise<boolean>;

  // Get API base URL for provider
  getApiBaseUrl(): string;

  // Extract hostname from repo URL
  getHostname(repoUrl: string): string;
}

// 3. Factory (Provider Detection & Creation)
export class GitProviderFactory {
  static getProvider(repoUrl: string): IGitProvider {
    const provider = this.detectProvider(repoUrl);

    switch (provider) {
      case ProviderType.GITHUB:
        return new GitHubProvider();
      case ProviderType.GITLAB:
        throw new Error("GitLab support coming soon");
      case ProviderType.BITBUCKET:
        throw new Error("Bitbucket support coming soon");
      default:
        throw new Error(`Unsupported provider: ${repoUrl}`);
    }
  }

  static detectProvider(repoUrl: string): ProviderType {
    if (repoUrl.includes("github.com")) return ProviderType.GITHUB;
    if (repoUrl.includes("gitlab.com")) return ProviderType.GITLAB;
    if (repoUrl.includes("bitbucket.org")) return ProviderType.BITBUCKET;
    throw new Error(`Cannot detect provider from URL: ${repoUrl}`);
  }
}

// 4. GitHub Implementation (Phase 1)
export class GitHubProvider implements IGitProvider {
  name = ProviderType.GITHUB;

  formatCredentialUrl(hostname: string, token: string): string {
    // GitHub format: https://TOKEN@github.com
    return `https://${token}@${hostname}`;
  }

  async validateToken(token: string): Promise<boolean> {
    // Optional: Call GitHub API to validate token
    // GET https://api.github.com/user
    return true; // Placeholder for Phase 1
  }

  getApiBaseUrl(): string {
    return "https://api.github.com";
  }

  getHostname(repoUrl: string): string {
    return "github.com";
  }
}

// 5. GitLab Implementation (Future - Phase 2)
export class GitLabProvider implements IGitProvider {
  name = ProviderType.GITLAB;

  formatCredentialUrl(hostname: string, token: string): string {
    // GitLab format: https://oauth2:TOKEN@gitlab.com
    return `https://oauth2:${token}@${hostname}`;
  }

  async validateToken(token: string): Promise<boolean> {
    // Call GitLab API: GET https://gitlab.com/api/v4/user
    // with PRIVATE-TOKEN header
    return true;
  }

  getApiBaseUrl(): string {
    return "https://gitlab.com/api/v4";
  }

  getHostname(repoUrl: string): string {
    return "gitlab.com";
  }
}

// 6. Bitbucket Implementation (Future - Phase 3)
export class BitbucketProvider implements IGitProvider {
  name = ProviderType.BITBUCKET;

  formatCredentialUrl(hostname: string, token: string): string {
    // Bitbucket format: https://USERNAME:APP_PASSWORD@bitbucket.org
    // Token should be in format "username:app_password"
    return `https://${token}@${hostname}`;
  }

  async validateToken(token: string): Promise<boolean> {
    // Call Bitbucket API: GET https://api.bitbucket.org/2.0/user
    // with Basic Auth
    return true;
  }

  getApiBaseUrl(): string {
    return "https://api.bitbucket.org/2.0";
  }

  getHostname(repoUrl: string): string {
    return "bitbucket.org";
  }
}
```

### Usage in GitRemoteTokenManager

```typescript
export class GitRemoteTokenManager {
  private gitProviderFactory: GitProviderFactory;

  async configureGitCredentials(appId: string, repoUrl: string): Promise<void> {
    // 1. Detect provider and get implementation
    const provider = GitProviderFactory.getProvider(repoUrl);
    const hostname = provider.getHostname(repoUrl);

    // 2. Build provider-specific bash script
    const script = `
      # Read token from container secrets
      TOKEN=$(cat /alloc/config.json | jq -r '.GITHUB_TOKEN.VALUE // ""')

      if [ -z "$TOKEN" ]; then
        echo "Error: Token not found in secrets" >&2
        exit 1
      fi

      # Create credential file with provider-specific format
      echo "${provider.formatCredentialUrl(hostname, "$TOKEN")}" > /tmp/.git-credentials
      chmod 600 /tmp/.git-credentials

      # Configure git credential helper
      git config --local credential.helper "store --file /tmp/.git-credentials"
    `;

    // 3. Execute in container
    await this.devSupervisor.exec({
      command: script,
      working_dir: "/app",
      timeout: 10000,
    });
  }
}
```

### Benefits of This Pattern

1. **Extensibility**: Add new providers by implementing `IGitProvider`
2. **Type Safety**: TypeScript enforces interface contract
3. **Single Responsibility**: Each provider handles its own logic
4. **Open/Closed Principle**: Open for extension, closed for modification
5. **Testability**: Easy to mock providers for testing
6. **Maintainability**: Provider-specific logic isolated

---

## Extension Points

### Adding New Git Providers

To add support for a new git provider (e.g., Azure DevOps, Gitea):

1. **Create Provider Class** implementing `IGitProvider`:

   ```typescript
   export class AzureDevOpsProvider implements IGitProvider {
     name = ProviderType.AZURE_DEVOPS;
     formatCredentialUrl(hostname: string, token: string): string { ... }
     validateToken(token: string): Promise<boolean> { ... }
     getApiBaseUrl(): string { ... }
     getHostname(repoUrl: string): string { ... }
   }
   ```

2. **Update ProviderType Enum**:

   ```typescript
   export enum ProviderType {
     GITHUB = "github",
     GITLAB = "gitlab",
     BITBUCKET = "bitbucket",
     AZURE_DEVOPS = "azure_devops", // NEW
   }
   ```

3. **Update Factory**:

   ```typescript
   static detectProvider(repoUrl: string): ProviderType {
     if (repoUrl.includes('dev.azure.com')) return ProviderType.AZURE_DEVOPS;
     // ... existing checks
   }
   ```

4. **Add Tests**: Create test file for new provider

### Future: Multiple Remotes per App

Already supported by database schema - `UNIQUE(app_id, remote_name)` allows:

```typescript
App A ──┬─ origin   (github.com/user/repo)
        ├─ upstream (github.com/org/repo)
        └─ backup   (gitlab.com/user/repo)
```

### Future: Token Validation

The `IGitProvider.validateToken()` method is designed for future validation:

```typescript
// In GitRemoteRouter configure endpoint:
const provider = GitProviderFactory.getProvider(repoUrl);
const isValid = await provider.validateToken(token);

if (!isValid) {
  return res.status(401).json({ error: "Invalid token" });
}
```

---

## Testing Strategy

### Unit Tests

- ✅ GitRemoteConfigRepository CRUD operations
- ✅ GitRemoteTokenManager credential configuration
- ✅ GitUtils remote operations
- ✅ GitTool operation handlers

### Integration Tests

- ✅ E2E: Configure → Push → Pull workflow
- ✅ Error scenarios (missing token, conflicts)
- ✅ Credential cleanup verification

### Security Tests

- ✅ Token never in logs
- ✅ Token never in agents memory
- ✅ Token deleted after operation
- ✅ Token isolated to preview variant

---

## Summary

**New Components:**

1. `GitRemoteConfigRepository` - Database layer for metadata
2. `GitRemoteTokenManager` - Credential management (container-only)
3. `GitRemoteRouter` - API routes
4. `IGitProvider` - Interface for git providers
5. `GitProviderFactory` - Provider detection and instantiation
6. `GitHubProvider` - GitHub implementation (Phase 1)
7. `GitLabProvider` - GitLab implementation (Future)
8. `BitbucketProvider` - Bitbucket implementation (Future)

**Extended Components:**

1. `GitUtils` - Add remote operations
2. `GitTool` - Add push/pull/configure handlers

**Design Patterns:**

- **Factory Pattern**: `GitProviderFactory` for provider instantiation
- **Strategy Pattern**: `IGitProvider` interface with provider-specific implementations
- **Repository Pattern**: `GitRemoteConfigRepository` for data access

**Security Model:**

- Token in secrets API → `/alloc/config.json` → Container bash script
- Token NEVER in agents service
- Ephemeral credentials deleted after each operation
- Provider-specific credential formats handled securely

**Key Pattern:**

```typescript
try {
  await tokenManager.configureGitCredentials(appId, repoUrl);
  // Token now in /tmp/.git-credentials (inside container)

  await gitUtils.push(path, "origin", "main");
  // Git uses token from credential helper
} finally {
  await tokenManager.cleanupGitCredentials(appId);
  // Token deleted from /tmp/.git-credentials
}
```
