# PaaS Express/Node.js Project Support - Implementation Plan

> **Implementation note:** Use this document as a step-by-step plan for implementing PaaS Express/Node.js project support.

**Goal:** Enable PaaS to import and run Express/Node.js backend projects (like `gpa-subscriptions-backend`) via both ZIP upload and git/pull

**Architecture:** Extend build tool detection to recognize Express projects, allow custom install/build/start commands via API params with sensible defaults, inject PORT handling into Express entry files. Works for both ZIP upload and git/pull flows.

**Tech Stack:** TypeScript, Express detection, AST manipulation for PORT injection, existing DevSupervisor infrastructure

> **Code Snippets:** See [2026-02-06-paas-express-support-code-snippets.md](2026-02-06-paas-express-support-code-snippets.md) for implementation code

---

## High-Level Design

### Current State - Two Entry Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PaaS Code Import (Current)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Entry Point 1: ZIP Upload              Entry Point 2: Git Pull             │
│  POST /apps/:id/zip/upload              POST /apps/:id/git/pull             │
│           │                                      │                          │
│           ▼                                      ▼                          │
│  ProjectImportService                   GitOpsService                       │
│  - Extract ZIP                          - git pull from remote              │
│  - Validate build tool                  - Validate build tool               │
│  - ViteConfigModifier                   - ViteConfigModifier (optional)     │
│           │                                      │                          │
│           └──────────────┬───────────────────────┘                          │
│                          ▼                                                   │
│                 AppRestartService.performFullRestartCycle()                 │
│                 - npm install                                                │
│                 - npm run build                                              │
│                 - Start: node_modules/.bin/vite --port $PORT                │
│                                                                              │
│                          │                                                   │
│                          ▼                                                   │
│                   ┌─────────────┐                                           │
│                   │ Vite Only   │  ← Current Limitation                     │
│                   │ Supported   │                                           │
│                   └─────────────┘                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Target State - Unified Flow for Both Entry Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PaaS Code Import (Target)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Entry Point 1: ZIP Upload              Entry Point 2: Git Pull             │
│  POST /apps/:id/zip/upload              POST /apps/:id/git/pull             │
│                                                                              │
│  API Params (both endpoints):                                               │
│  • installCommand (default: auto-detect npm/pnpm/yarn)                      │
│  • buildCommand (default: npm run build if script exists)                   │
│  • startCommand (default: npm run dev or npm start)                         │
│  • entryFile (required for Node.js - e.g., src/server.ts)                  │
│           │                                      │                          │
│           ▼                                      ▼                          │
│  ProjectImportService                   GitOpsService                       │
│  - Extract ZIP                          - git pull from remote              │
│           │                                      │                          │
│           └──────────────┬───────────────────────┘                          │
│                          ▼                                                   │
│                   Detect Build Tool                                          │
│                          │                                                   │
│              ┌───────────┴───────────┐                                      │
│              ▼                       ▼                                      │
│        ┌──────────┐           ┌──────────────┐                              │
│        │   Vite   │           │ Express/Node │                              │
│        └──────────┘           └──────────────┘                              │
│              │                       │                                      │
│              ▼                       ▼                                      │
│     ViteConfigModifier       ExpressPortInjector                            │
│     (allowedHosts)           (process.env.PORT + 0.0.0.0)                   │
│              │                       │                                      │
│              └───────────┬───────────┘                                      │
│                          ▼                                                   │
│            AppRestartService.performFullRestartCycle()                      │
│            - Run installCommand                                              │
│            - Run buildCommand (if configured)                                │
│            - Run startCommand                                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Sequence Diagram: ZIP Upload Flow

```
┌──────┐     ┌─────────┐     ┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│Client│     │V2 API   │     │ProjectImport  │     │BuildTool     │     │DevSupervisor │
│      │     │Routes   │     │Service        │     │Detection     │     │              │
└──┬───┘     └────┬────┘     └───────┬───────┘     └──────┬───────┘     └──────┬───────┘
   │              │                  │                    │                    │
   │ POST /apps/:appId/zip/upload    │                    │                    │
   │ {installCmd, buildCmd, startCmd,│                    │                    │
   │  entryFile}                     │                    │                    │
   │─────────────►│                  │                    │                    │
   │              │                  │                    │                    │
   │              │ startImport()    │                    │                    │
   │              │─────────────────►│                    │                    │
   │              │                  │                    │                    │
   │              │                  │ Extract ZIP        │                    │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
   │              │                  │ detectBuildTool()  │                    │
   │              │                  │───────────────────►│                    │
   │              │                  │                    │                    │
   │              │                  │    {type: 'nodejs',│                    │
   │              │                  │     framework: 'express'}               │
   │              │                  │◄───────────────────│                    │
   │              │                  │                    │                    │
   │              │                  │ [If Express]       │                    │
   │              │                  │ injectPortHandling(entryFile)           │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
   │              │                  │ exec(installCmd)   │                    │
   │              │                  │─────────────────────────────────────────►
   │              │                  │                    │                    │
   │              │                  │ exec(buildCmd)     │                    │
   │              │                  │─────────────────────────────────────────►
   │              │                  │                    │                    │
   │              │                  │ startProcess(startCmd)                  │
   │              │                  │─────────────────────────────────────────►
   │              │                  │                    │                    │
   │ 202 {jobId, status: 'pending'} │                    │                    │
   │◄─────────────│                  │                    │                    │
   │              │                  │                    │                    │
```

---

## Sequence Diagram: Git Pull Flow

```
┌──────┐     ┌─────────┐     ┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│Client│     │Git API  │     │GitOpsService  │     │AppRestart    │     │DevSupervisor │
│      │     │Routes   │     │               │     │Service       │     │              │
└──┬───┘     └────┬────┘     └───────┬───────┘     └──────┬───────┘     └──────┬───────┘
   │              │                  │                    │                    │
   │ POST /apps/:id/git/pull         │                    │                    │
   │ {remoteName, branch, token,     │                    │                    │
   │  repoUrl, installCmd, buildCmd, │                    │                    │
   │  startCmd, entryFile}           │                    │                    │
   │─────────────►│                  │                    │                    │
   │              │                  │                    │                    │
   │              │ startPull()      │                    │                    │
   │              │─────────────────►│                    │                    │
   │              │                  │                    │                    │
   │ 202 {jobId}  │                  │                    │                    │
   │◄─────────────│                  │                    │                    │
   │              │                  │                    │                    │
   │              │                  │ [Background]       │                    │
   │              │                  │ git pull           │                    │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
   │              │                  │ detectBuildTool()  │                    │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
   │              │                  │ [If unsupported]   │                    │
   │              │                  │ git reset --hard   │                    │
   │              │                  │ ORIG_HEAD (rollback)                    │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
   │              │                  │ [If Vite]          │                    │
   │              │                  │ ViteConfigModifier │                    │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
   │              │                  │ [If Express]       │                    │
   │              │                  │ ExpressPortInjector│                    │
   │              │                  │ (entryFile)        │                    │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
   │              │                  │ performFullRestart │                    │
   │              │                  │ Cycle(commands)    │                    │
   │              │                  │───────────────────►│                    │
   │              │                  │                    │                    │
   │              │                  │                    │ exec(installCmd)   │
   │              │                  │                    │───────────────────►│
   │              │                  │                    │                    │
   │              │                  │                    │ exec(buildCmd)     │
   │              │                  │                    │───────────────────►│
   │              │                  │                    │                    │
   │              │                  │                    │ startProcess       │
   │              │                  │                    │ (startCmd)         │
   │              │                  │                    │───────────────────►│
   │              │                  │                    │                    │
   │              │                  │ git commit         │                    │
   │              │                  │ (post-pull changes)│                    │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
   │              │                  │ markJobComplete()  │                    │
   │              │                  │────────────────────┤                    │
   │              │                  │                    │                    │
```

---

## Low-Level Design

### Component 1: Extended Build Tool Detection

**File:** `agents/src/server/middleware/git-import-validation.ts`

**Current:**

- `SUPPORTED_BUILD_TOOLS` array contains only `VITE_BUILD_TOOL`
- Detection via config files + package dependencies

**Changes:**

- Add `NODEJS_BUILD_TOOL` configuration
- Detection strategy: Check for `express`, `fastify`, `koa`, `@hapi/hapi` in dependencies
- No config files required (unlike Vite)

**Detection Priority:**

1. Vite (check first - if vite.config.\* exists, it's a Vite project)
2. Node.js/Express (fallback - if Express dependency found)

---

### Component 2: Custom Commands via API (Both Endpoints)

#### 2A: ZIP Upload API

**File:** `agents/src/server/routes/zip-import.ts`

**Current:**

- No custom command parameters in API

**Changes:**

- Add optional parameters to ZIP upload endpoint:
  - `installCommand?: string` - Override install (default: auto-detect npm/pnpm/yarn)
  - `buildCommand?: string` - Override build (default: `npm run build` if script exists)
  - `startCommand?: string` - Override start (default: `npm run dev` or `npm start`)
  - `entryFile?: string` - **Required for Node.js projects** - Server entry file path (e.g., `src/server.ts`)

---

#### 2B: Git Pull API

**File:** `agents/src/server/routes/git-remote.ts`

**Current Parameters:**

- `remoteName?: string` - Remote name (default: 'origin')
- `branch?: string` - Branch to pull
- `token?: string` - GitHub token (PaaS)
- `repoUrl?: string` - Repository URL (PaaS)
- `modifyViteConfig?: boolean` - Modify vite config for proxy

**New Parameters to Add:**

- `installCommand?: string` - Override install command
- `buildCommand?: string` - Override build command
- `startCommand?: string` - Override start command
- `entryFile?: string` - **Required for Node.js projects** - Server entry file path

**Defaults Logic:**

```
installCommand:
  - If pnpm-lock.yaml exists → "pnpm install"
  - If yarn.lock exists → "yarn install"
  - Default → "npm install"

buildCommand:
  - If package.json has "build" script → "npm run build"
  - Else → skip build step

startCommand:
  - If package.json has "dev" script → "npm run dev"
  - Elif package.json has "start" script → "npm start"
  - Else → error: no start command
```

---

### Component 3: PORT Injection for Express

**New File:** `agents/src/services/ExpressPortInjector.ts`

**Purpose:** Modify Express server entry file to use `process.env.PORT`

**Entry File:** User must specify via `entryFile` API parameter (e.g., `src/server.ts`)

**Logic:**

1. Read specified entry file
2. **Check if already uses `process.env.PORT`** → Skip injection if found
3. Detect current port configuration (hardcoded port)
4. Inject/modify to use `process.env.PORT`
5. **If injection fails** → Fail the import with clear error

**Injection Patterns:**

| Current Pattern                              | After Injection                                     |
| -------------------------------------------- | --------------------------------------------------- |
| `app.listen(3000)`                           | `app.listen(process.env.PORT \|\| 3000, '0.0.0.0')` |
| `app.listen(PORT)` where `const PORT = 3000` | `const PORT = process.env.PORT \|\| 3000`           |
| `server.listen(port, 'localhost')`           | `server.listen(port, '0.0.0.0')`                    |

**Host Binding:**

- Always change `localhost` / `127.0.0.1` to `0.0.0.0` for container access

---

### Component 4: Updated Restart Service

**File:** `agents/src/services/AppRestartService.ts`

**Current:**

- `DEFAULT_DEV_COMMAND` hardcoded to Vite
- `performFullRestartCycle()` uses fixed command
- No parameters for custom commands

**Changes:**

- Update `performFullRestartCycle()` signature to accept commands:
  ```
  performFullRestartCycle(appId, appPath, options: {
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    buildToolType?: 'vite' | 'nodejs';
  })
  ```
- Use provided commands or fall back to defaults based on build tool type:
  - Vite: `node_modules/.bin/vite --host 0.0.0.0 --port $PORT`
  - Node.js: Use provided `startCommand` or `npm run dev` / `npm start`
- Update `runNpmInstall()` to accept custom install command
- Update `runNpmBuild()` to accept custom build command
- Update `restartDevServer()` to accept custom start command

---

### Component 5: Updated PaaS Config

**File:** `agents/src/services/AppRestartService.ts` - `createPaasConfig()`

**Current Config Structure:**

```json
{
  "runtime": {
    "dev": { "command": "vite --host 0.0.0.0 --port $PORT" },
    "build": { "command": "vite build" },
    "serve": { "command": "serve dist" }
  }
}
```

**New Config Structure:**

```json
{
  "buildTool": "vite" | "nodejs",
  "runtime": {
    "install": { "command": "npm install" },
    "build": { "command": "npm run build" | null },
    "dev": { "command": "npm run dev" },
    "serve": { "command": "npm start" }
  }
}
```

---

### Component 6: ZIP Import Flow Integration

**File:** `agents/src/services/ProjectImportService.ts`

**Updated Flow:**

1. Extract ZIP to container
2. Read package.json
3. Detect build tool (Vite or Node.js)
4. **Validate entryFile provided** (if Node.js)
5. Determine commands (API params → defaults)
6. **If Node.js:** Run `ExpressPortInjector(entryFile)`
7. **If Vite:** Run `ViteConfigModifier`
8. Run install command
9. Run build command (if configured)
10. Create PaaS config
11. Git commit
12. Start dev server with start command

---

### Component 7: Git Pull Flow Integration

**File:** `agents/src/services/GitOpsService.ts`

**Current `executePullInBackground()` Flow:**

1. Update job status to PULLING
2. Execute git pull
3. Validate build tool (Vite only) → rollback if unsupported
4. Optionally modify Vite config
5. Call `appRestartService.performFullRestartCycle()`
6. Commit post-pull changes
7. Mark job complete

**Updated Flow:**

1. Update job status to PULLING
2. Execute git pull
3. Detect build tool (Vite or Node.js)
4. **Validate:** If Node.js and no `entryFile` → fail with error
5. **If unsupported:** Rollback with `git reset --hard ORIG_HEAD`
6. **If Vite:** Run `ViteConfigModifier` (existing)
7. **If Node.js:** Run `ExpressPortInjector(entryFile)`
8. Call `appRestartService.performFullRestartCycle()` with custom commands
9. Commit post-pull changes
10. Mark job complete

**Interface Update for `GitPullParams`:**

```
interface GitPullParams {
  // Existing params...
  remoteName?: string;
  branch?: string;
  token?: string;
  repoUrl?: string;
  modifyViteConfig?: boolean;

  // New params
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  entryFile?: string;
}
```

---

## Data Flow Diagram (Both Entry Points)

```
┌────────────────────────────────────────────────────────────────────────┐
│                      API Request (Either Endpoint)                      │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ZIP Upload:                        Git Pull:                          │
│  POST /apps/:id/zip/upload          POST /apps/:id/git/pull            │
│                                                                         │
│  Common Parameters (both endpoints):                                   │
│    - installCommand?: string                                           │
│    - buildCommand?: string                                             │
│    - startCommand?: string                                             │
│    - entryFile?: string  (required for Node.js)                       │
│                                                                         │
│  ZIP-specific:                      Git-specific:                      │
│    - file: <zip>                    - remoteName?: string              │
│                                     - branch?: string                   │
│                                     - token?: string                    │
│                                     - repoUrl?: string                  │
│                                                                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Shared Command Parameters Interface                   │
│                                                                         │
│  interface CommandParams {                                             │
│    installCommand?: string;  // User override                          │
│    buildCommand?: string;    // User override                          │
│    startCommand?: string;    // User override                          │
│    entryFile?: string;       // Required for Node.js                   │
│  }                                                                     │
│                                                                         │
│  Used by: ProjectImportService, GitOpsService                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Build Tool Detection                             │
│                                                                         │
│  interface DetectedBuildTool {                                         │
│    type: 'vite' | 'nodejs';                                           │
│    framework?: 'express' | 'fastify' | 'koa' | 'hapi';                │
│    packageManager: 'npm' | 'pnpm' | 'yarn';                           │
│    scripts: {                                                          │
│      dev?: string;                                                     │
│      start?: string;                                                   │
│      build?: string;                                                   │
│    };                                                                  │
│  }                                                                     │
│                                                                         │
│  Detection Priority:                                                   │
│  1. Vite (if vite.config.* exists or vite in dependencies)            │
│  2. Node.js (if express/fastify/koa/hapi in dependencies)             │
│  3. Unsupported → error or rollback                                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Resolved Commands                                │
│                                                                         │
│  interface ResolvedCommands {                                          │
│    install: string;   // "pnpm install" | "npm install" | custom       │
│    build: string | null; // null if no build script                    │
│    start: string;     // "npm run dev" | "npm start" | custom          │
│  }                                                                     │
│                                                                         │
│  Resolution Priority:                                                  │
│  1. User-provided via API params (highest)                             │
│  2. Auto-detected from package.json                                    │
│  3. Sensible defaults based on build tool type                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Error Handling

| Scenario                 | Error Key                  | HTTP Status | Message                                                                                                   |
| ------------------------ | -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| No package.json          | `MISSING_PACKAGE_JSON`     | 400         | "No package.json found in project root"                                                                   |
| Unsupported project      | `UNSUPPORTED_PROJECT_TYPE` | 400         | "Project type not supported. Must be Vite or Node.js/Express"                                             |
| No start script          | `MISSING_START_SCRIPT`     | 400         | "No dev or start script found in package.json and no startCommand provided"                               |
| Missing entry file param | `MISSING_ENTRY_FILE`       | 400         | "entryFile parameter required for Node.js projects"                                                       |
| Entry file not found     | `ENTRY_FILE_NOT_FOUND`     | 400         | "Specified entry file not found: {entryFile}"                                                             |
| PORT injection failed    | `PORT_INJECTION_FAILED`    | 400         | "Failed to inject PORT handling into {entryFile}. Please ensure the file uses standard listen() patterns" |

---

## Files to Modify

| File                                                    | Type       | Changes                                   |
| ------------------------------------------------------- | ---------- | ----------------------------------------- |
| `agents/src/server/middleware/git-import-validation.ts` | Modify     | Add `NODEJS_BUILD_TOOL` config            |
| `agents/src/server/routes/zip-import.ts`                | Modify     | Add command params to ZIP upload API      |
| `agents/src/server/routes/git-remote.ts`                | Modify     | Add command params to git/pull API        |
| `agents/src/services/ExpressPortInjector.ts`            | **Create** | PORT injection logic                      |
| `agents/src/services/AppRestartService.ts`              | Modify     | Accept custom commands, dynamic selection |
| `agents/src/services/ProjectImportService.ts`           | Modify     | Integrate new flow for ZIP upload         |
| `agents/src/services/GitOpsService.ts`                  | Modify     | Integrate new flow for git/pull           |
| `agents/src/types/import.ts`                            | Modify     | Add new error keys, update interfaces     |

---

## Testing Strategy

### Unit Tests

- Build tool detection: Express vs Vite vs unsupported
- Command resolution: API params override vs defaults
- PORT injection patterns: All common Express patterns
- Skip injection when `process.env.PORT` already present

### Integration Tests - ZIP Upload

- Import Express project via ZIP with custom commands
- Import Express project with default commands
- Verify PORT injection applied to entry file
- Verify dev server starts and responds on correct PORT
- Error case: Missing entryFile for Node.js project

### Integration Tests - Git Pull

- Pull Express project with custom commands
- Pull Express project with default commands
- Verify PORT injection applied after pull
- Verify rollback on unsupported project type
- Verify dev server restart with correct commands
- Error case: Missing entryFile for Node.js project

### Manual Verification

- **ZIP Upload:** Import `gpa-subscriptions-backend` via ZIP
- **Git Pull:** Pull `gpa-subscriptions-backend` from repo
- Check `/healthcheck` endpoint responds
- Verify logs show correct PORT (8080)
- Verify host binding is 0.0.0.0

---

## Phase 1 Scope (Current)

**In Scope:**

- Express and Vite project support
- Custom install/build/start commands via API
- PORT injection for Express
- Host binding fix (0.0.0.0)

**Out of Scope (Future Phases):**

- Database provisioning
- Additional frameworks (Fastify, Koa, NestJS)
- Project config file (.paasrc)
- TypeScript-specific handling

---

## ZIP Upload vs Git Pull: Unified Behavior

| Aspect                    | ZIP Upload                  | Git Pull                              |
| ------------------------- | --------------------------- | ------------------------------------- |
| **Endpoint**              | `POST /apps/:id/zip/upload` | `POST /apps/:id/git/pull`             |
| **Service**               | `ProjectImportService`      | `GitOpsService`                       |
| **Build tool validation** | During import               | After pull (rollback if fail)         |
| **Vite config modifier**  | Yes                         | Yes (if `modifyViteConfig: true`)     |
| **Express PORT injector** | Yes (new)                   | Yes (new)                             |
| **Custom commands**       | Yes (new)                   | Yes (new)                             |
| **Restart cycle**         | `AppRestartService`         | `AppRestartService`                   |
| **Failure handling**      | Fail import job             | Rollback `git reset --hard ORIG_HEAD` |

---

## Design Decisions (Confirmed)

| Decision                        | Choice                               | Rationale                                         |
| ------------------------------- | ------------------------------------ | ------------------------------------------------- |
| Entry file detection            | User specifies via `entryFile` param | Avoids guessing, explicit is better               |
| PORT injection failure          | Fail the import                      | User must fix code or provide working entry file  |
| Existing PORT handling          | Skip if correct                      | Don't modify working code unnecessarily           |
| Unified commands for both flows | Same params for ZIP and git/pull     | Consistent API, shared logic in AppRestartService |

---

## FAQ

### Why check specific framework packages instead of "any Node.js app"?

The PORT injection logic is specifically designed for **HTTP server applications** that use the `.listen()` pattern. A generic "any Node.js app" check would have low precision and high false-positive rates.

**What PORT Injection Does:**

```javascript
// Pattern 1: const PORT = 3000 → const PORT = process.env.PORT || 3000
// Pattern 2: app.listen(3000) → app.listen(process.env.PORT || 3000, '0.0.0.0')
// Pattern 3: .listen(3000, 'localhost') → .listen(process.env.PORT || 3000, '0.0.0.0')
```

These transformations **only make sense** for HTTP server applications.

**What "Any Node.js App" Would Match:**

| Type         | Example          | Has `package.json` | Needs PORT Injection? |
| ------------ | ---------------- | ------------------ | --------------------- |
| HTTP Server  | Express API      | Yes                | Yes                   |
| CLI Tool     | eslint, prettier | Yes                | No                    |
| Library      | lodash, axios    | Yes                | No                    |
| Build Tool   | webpack, rollup  | Yes                | No                    |
| Worker/Queue | bull, agenda     | Yes                | No                    |

**Why These 4 Frameworks?**

| Framework | Market Share | Notes                                  |
| --------- | ------------ | -------------------------------------- |
| Express   | ~60%         | Most popular Node.js backend framework |
| Fastify   | ~15%         | Fastest growing, performance-focused   |
| Koa       | ~10%         | Express team's next-gen framework      |
| Hapi      | ~5%          | Enterprise choice                      |

Together, these cover **~90%+ of real-world Node.js HTTP backend projects**.

- **NestJS**: Uses Express or Fastify under the hood → Will match via those dependencies
- **Next.js/Nuxt**: Typically detected as Vite/frontend projects → Different flow

**Precision vs Recall:**

| Approach                  | Precision | Recall | False Positives |
| ------------------------- | --------- | ------ | --------------- |
| Check specific frameworks | High      | ~90%   | Very Low        |
| "Any Node.js app"         | Very Low  | 100%   | Very High       |

The current design (check specific frameworks + require `entryFile`) provides high precision with good recall.
