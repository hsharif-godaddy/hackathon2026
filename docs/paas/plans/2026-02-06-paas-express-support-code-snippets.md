# PaaS Express Support - Code Snippets

> **Reference:** This file contains implementation code snippets for the plan at [2026-02-06-paas-express-support.md](2026-02-06-paas-express-support.md)

---

## Component 1: Build Tool Detection

**File:** `agents/src/server/middleware/git-import-validation.ts`

### Add NODEJS_BUILD_TOOL config

```typescript
// Add after VITE_BUILD_TOOL definition (around line 465)

export const NODEJS_BUILD_TOOL: BuildToolConfig = {
  name: "Node.js",
  configFiles: [], // No standard config file for Express/Node.js
  packageNames: ["express", "fastify", "koa", "@hapi/hapi"],
} as const;

export const SUPPORTED_BUILD_TOOLS: readonly BuildToolConfig[] = [
  VITE_BUILD_TOOL,
  NODEJS_BUILD_TOOL, // Add this
] as const;
```

---

## Component 2A: ZIP Upload API

**File:** `agents/src/server/routes/zip-import.ts`

### Add command parameters to request schema

```typescript
// Add to the request body schema/interface

interface ZipUploadRequest {
  // Existing fields...

  // New command parameters
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  entryFile?: string; // Required for Node.js projects
}

// In the route handler, extract new params
const { installCommand, buildCommand, startCommand, entryFile } = req.body;

// Pass to import service
await projectImportService.startImport({
  appId,
  zipFile,
  commands: {
    install: installCommand,
    build: buildCommand,
    start: startCommand,
  },
  entryFile,
});
```

---

## Component 2B: Git Pull API

**File:** `agents/src/server/routes/git-remote.ts`

### Add command parameters to git/pull endpoint

```typescript
// Update GitPullRequest interface (or inline validation)

interface GitPullRequest {
  // Existing fields
  remoteName?: string;
  branch?: string;
  token?: string;
  repoUrl?: string;
  modifyViteConfig?: boolean;

  // New command parameters
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  entryFile?: string;  // Required for Node.js projects
}

// In the POST /apps/:id/git/pull handler
router.post('/apps/:id/git/pull', /* middlewares */, async (req, res) => {
  const {
    remoteName,
    branch,
    token,
    repoUrl,
    modifyViteConfig,
    // New params
    installCommand,
    buildCommand,
    startCommand,
    entryFile,
  } = req.body;

  const result = await gitOpsService.startPull({
    appId,
    appPath,
    remoteName,
    branch,
    token,
    repoUrl,
    modifyViteConfig,
    // Pass new params
    installCommand,
    buildCommand,
    startCommand,
    entryFile,
  });

  // ... rest of handler
});
```

---

## Component 3: ExpressPortInjector

**File:** `agents/src/services/ExpressPortInjector.ts` (NEW FILE)

```typescript
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import { DevSupervisorClient } from "./DevSupervisorClient";
import { logger } from "../utils/logger";

export interface PortInjectionResult {
  modified: boolean;
  skipped: boolean;
  reason?: string;
  error?: string;
}

/**
 * Injects process.env.PORT handling into Express server entry files
 */
export async function injectPortHandling(
  devSupervisor: DevSupervisorClient,
  projectRoot: string,
  entryFile: string,
): Promise<PortInjectionResult> {
  const filePath = `${projectRoot}/${entryFile}`;

  // Step 1: Read the entry file
  const readResult = await devSupervisor.exec({
    command: `cat "${filePath}"`,
    working_dir: projectRoot,
  });

  if (readResult.exitCode !== 0) {
    return {
      modified: false,
      skipped: false,
      error: `Entry file not found: ${entryFile}`,
    };
  }

  const sourceCode = readResult.stdout;

  // Step 2: Check if already uses process.env.PORT
  if (sourceCode.includes("process.env.PORT")) {
    logger.info("express-port-injector.skip", {
      entryFile,
      reason: "Already uses process.env.PORT",
    });
    return {
      modified: false,
      skipped: true,
      reason: "Already uses process.env.PORT",
    };
  }

  // Step 3: Parse and transform
  try {
    const modifiedCode = transformPortHandling(sourceCode, entryFile);

    if (modifiedCode === sourceCode) {
      return {
        modified: false,
        skipped: false,
        error: "Could not find listen() pattern to modify",
      };
    }

    // Step 4: Write modified file back
    const writeResult = await devSupervisor.exec({
      command: `cat > "${filePath}" << 'PAAS_EOF'
${modifiedCode}
PAAS_EOF`,
      working_dir: projectRoot,
    });

    if (writeResult.exitCode !== 0) {
      return {
        modified: false,
        skipped: false,
        error: `Failed to write modified file: ${writeResult.stderr}`,
      };
    }

    logger.info("express-port-injector.success", { entryFile });
    return { modified: true, skipped: false };
  } catch (error) {
    return {
      modified: false,
      skipped: false,
      error: `AST transformation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Transform source code to use process.env.PORT
 */
function transformPortHandling(sourceCode: string, entryFile: string): string {
  const isTypeScript = entryFile.endsWith(".ts") || entryFile.endsWith(".tsx");

  const ast = parse(sourceCode, {
    sourceType: "module",
    plugins: isTypeScript ? ["typescript"] : [],
  });

  let modified = false;

  traverse(ast, {
    // Pattern 1: app.listen(3000) or app.listen(PORT)
    CallExpression(path) {
      const { callee, arguments: args } = path.node;

      // Check if it's a .listen() call
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.property, { name: "listen" }) &&
        args.length > 0
      ) {
        const firstArg = args[0];

        // Case: app.listen(3000) → app.listen(process.env.PORT || 3000, '0.0.0.0')
        if (t.isNumericLiteral(firstArg)) {
          const portFallback = t.logicalExpression(
            "||",
            t.memberExpression(
              t.memberExpression(t.identifier("process"), t.identifier("env")),
              t.identifier("PORT"),
            ),
            t.numericLiteral(firstArg.value),
          );

          args[0] = portFallback;
          ensureHostBinding(args);
          modified = true;
        }

        // Case: app.listen(PORT) where PORT is a variable
        if (
          t.isIdentifier(firstArg) &&
          firstArg.name.toUpperCase() === "PORT"
        ) {
          ensureHostBinding(args);
          // Mark that we need to modify the PORT variable declaration
          modified = true;
        }

        // Replace localhost/127.0.0.1 with 0.0.0.0
        replaceLocalhostBinding(args);
      }
    },

    // Pattern 2: const PORT = 3000 → const PORT = process.env.PORT || 3000
    VariableDeclarator(path) {
      if (
        t.isIdentifier(path.node.id, { name: "PORT" }) &&
        t.isNumericLiteral(path.node.init)
      ) {
        const originalPort = path.node.init.value;
        path.node.init = t.logicalExpression(
          "||",
          t.memberExpression(
            t.memberExpression(t.identifier("process"), t.identifier("env")),
            t.identifier("PORT"),
          ),
          t.numericLiteral(originalPort),
        );
        modified = true;
      }
    },
  });

  if (!modified) {
    return sourceCode;
  }

  const { code } = generate(ast, { retainLines: true });
  return code;
}

/**
 * Ensure host binding is 0.0.0.0 for container access
 */
function ensureHostBinding(args: t.Expression[]): void {
  // If no host argument, add '0.0.0.0'
  if (args.length === 1) {
    args.push(t.stringLiteral("0.0.0.0"));
  }
}

/**
 * Replace localhost/127.0.0.1 with 0.0.0.0
 */
function replaceLocalhostBinding(args: t.Expression[]): void {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      t.isStringLiteral(arg) &&
      (arg.value === "localhost" || arg.value === "127.0.0.1")
    ) {
      args[i] = t.stringLiteral("0.0.0.0");
    }
  }
}
```

---

## Component 4: AppRestartService Updates

**File:** `agents/src/services/AppRestartService.ts`

### Update performFullRestartCycle signature

```typescript
// Add new interface for restart options
export interface RestartCycleOptions {
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  buildToolType?: "vite" | "nodejs";
}

// Update DEFAULT commands
export const DEFAULT_DEV_COMMAND =
  "node_modules/.bin/vite --host 0.0.0.0 --port $PORT";
export const DEFAULT_NODEJS_DEV_COMMAND = "npm run dev";

// Update performFullRestartCycle
export async function performFullRestartCycle(
  appId: string,
  appPath: string,
  options: RestartCycleOptions = {},
): Promise<RestartCycleResult> {
  const devSupervisor = await DevSupervisorClientFactory.createForApp(appId);

  // Step 1: Stop dev server
  await stopDevServer(devSupervisor);

  // Step 2: Run install command
  const installCmd =
    options.installCommand ||
    (await detectInstallCommand(devSupervisor, appPath));
  await runCommand(devSupervisor, appPath, installCmd, "install");

  // Step 3: Run build command (if provided or exists)
  const buildCmd =
    options.buildCommand || (await detectBuildCommand(devSupervisor, appPath));
  if (buildCmd) {
    await runCommand(devSupervisor, appPath, buildCmd, "build");
  }

  // Step 4: Create PaaS config
  await createPaasConfig(appPath, options);

  // Step 5: Restart dev server with appropriate command
  const startCmd = resolveStartCommand(options);
  await restartDevServer(devSupervisor, startCmd);

  return { success: true };
}

function resolveStartCommand(options: RestartCycleOptions): string {
  // User-provided command takes priority
  if (options.startCommand) {
    return options.startCommand;
  }

  // Default based on build tool type
  if (options.buildToolType === "nodejs") {
    return DEFAULT_NODEJS_DEV_COMMAND;
  }

  return DEFAULT_DEV_COMMAND;
}

async function detectInstallCommand(
  devSupervisor: DevSupervisorClient,
  appPath: string,
): Promise<string> {
  // Check for lock files to determine package manager
  const pnpmLock = await fileExists(devSupervisor, appPath, "pnpm-lock.yaml");
  if (pnpmLock) return "pnpm install";

  const yarnLock = await fileExists(devSupervisor, appPath, "yarn.lock");
  if (yarnLock) return "yarn install";

  return "npm install";
}

async function detectBuildCommand(
  devSupervisor: DevSupervisorClient,
  appPath: string,
): Promise<string | null> {
  // Read package.json and check for build script
  const packageJson = await readPackageJson(devSupervisor, appPath);
  if (packageJson?.scripts?.build) {
    return "npm run build";
  }
  return null;
}
```

---

## Component 5: Updated PaaS Config

**File:** `agents/src/services/AppRestartService.ts` - `createPaasConfig()`

```typescript
interface PaasConfig {
  buildTool: "vite" | "nodejs";
  runtime: {
    install: { command: string };
    build: { command: string | null };
    dev: { command: string };
    serve: { command: string };
  };
}

export async function createPaasConfig(
  appPath: string,
  options: RestartCycleOptions,
): Promise<void> {
  const buildTool = options.buildToolType || "vite";

  const config: PaasConfig =
    buildTool === "nodejs"
      ? {
          buildTool: "nodejs",
          runtime: {
            install: { command: options.installCommand || "npm install" },
            build: { command: options.buildCommand || null },
            dev: { command: options.startCommand || "npm run dev" },
            serve: { command: "npm start" },
          },
        }
      : {
          buildTool: "vite",
          runtime: {
            install: { command: options.installCommand || "npm install" },
            build: {
              command:
                options.buildCommand ||
                "node_modules/.bin/vite build --outDir dist",
            },
            dev: {
              command: "node_modules/.bin/vite --host 0.0.0.0 --port $PORT",
            },
            serve: { command: "serve dist -l tcp://0.0.0.0:$PORT" },
          },
        };

  const configPath = `${appPath}/.airo/config.json`;

  // Ensure .airo directory exists
  await devSupervisor.exec({
    command: `mkdir -p "${appPath}/.airo"`,
    working_dir: appPath,
  });

  // Write config
  await devSupervisor.exec({
    command: `cat > "${configPath}" << 'EOF'
${JSON.stringify(config, null, 2)}
EOF`,
    working_dir: appPath,
  });
}
```

---

## Component 6: ProjectImportService Updates

**File:** `agents/src/services/ProjectImportService.ts`

### Update import flow for Express support

```typescript
import { injectPortHandling } from "./ExpressPortInjector";
import { modifyViteConfig } from "./ViteConfigModifier";
import {
  isSupportedProjectInContainer,
  NODEJS_BUILD_TOOL,
  VITE_BUILD_TOOL,
} from "../server/middleware/git-import-validation";

interface StartImportParams {
  appId: string;
  zipFile: Buffer;
  commands?: {
    install?: string;
    build?: string;
    start?: string;
  };
  entryFile?: string;
}

async function validateProjectInContainer(
  devSupervisor: DevSupervisorClient,
  projectRoot: string,
  packageJson: PackageJson,
  entryFile?: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  // Check for supported build tool
  const buildToolCheck = await isSupportedProjectInContainer(
    devSupervisor,
    projectRoot,
    packageJson,
  );

  if (!buildToolCheck.supported) {
    errors.push({
      key: ValidationErrorKey.UNSUPPORTED_PROJECT_TYPE,
      message: "Project type not supported. Must be Vite or Node.js/Express",
    });
    return { valid: false, errors };
  }

  // If Node.js project, require entryFile
  if (buildToolCheck.matchedTool === "Node.js" && !entryFile) {
    errors.push({
      key: ValidationErrorKey.MISSING_ENTRY_FILE,
      message: "entryFile parameter required for Node.js projects",
    });
    return { valid: false, errors };
  }

  // Verify entryFile exists
  if (entryFile) {
    const entryExists = await fileExists(devSupervisor, projectRoot, entryFile);
    if (!entryExists) {
      errors.push({
        key: ValidationErrorKey.ENTRY_FILE_NOT_FOUND,
        message: `Specified entry file not found: ${entryFile}`,
      });
      return { valid: false, errors };
    }
  }

  return {
    valid: true,
    errors: [],
    buildToolType: buildToolCheck.matchedTool === "Node.js" ? "nodejs" : "vite",
  };
}

async function processImport(
  jobId: string,
  params: StartImportParams,
): Promise<void> {
  const { appId, commands, entryFile } = params;

  // ... existing extraction logic ...

  // Detect build tool
  const validation = await validateProjectInContainer(
    devSupervisor,
    projectRoot,
    packageJson,
    entryFile,
  );

  if (!validation.valid) {
    await markJobFailed(jobId, validation.errors);
    return;
  }

  const buildToolType = validation.buildToolType;

  // Apply config modifier based on build tool
  if (buildToolType === "nodejs" && entryFile) {
    // Inject PORT handling for Express
    const portResult = await injectPortHandling(
      devSupervisor,
      projectRoot,
      entryFile,
    );

    if (!portResult.modified && !portResult.skipped) {
      await markJobFailed(jobId, [
        {
          key: ValidationErrorKey.PORT_INJECTION_FAILED,
          message: `Failed to inject PORT handling into ${entryFile}. ${portResult.error}`,
        },
      ]);
      return;
    }
  } else if (buildToolType === "vite") {
    // Modify Vite config (existing logic)
    await modifyViteConfig(devSupervisor, projectRoot);
  }

  // Run restart cycle with custom commands
  await appRestartService.performFullRestartCycle(appId, appPath, {
    installCommand: commands?.install,
    buildCommand: commands?.build,
    startCommand: commands?.start,
    buildToolType,
  });

  // ... rest of import logic (git commit, etc.) ...
}
```

---

## Component 7: GitOpsService Updates

**File:** `agents/src/services/GitOpsService.ts`

### Update executePullInBackground for Express support

```typescript
import { injectPortHandling } from "./ExpressPortInjector";
import {
  isSupportedProjectOnHost,
  NODEJS_BUILD_TOOL,
} from "../server/middleware/git-import-validation";

interface GitPullParams {
  // Existing params
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

async function executePullInBackground(
  jobId: string,
  appId: string,
  appPath: string,
  options: GitPullParams,
): Promise<void> {
  // Step 1: Update status
  await this.importJobRepo.updateStatus(jobId, ImportJobStatus.PULLING);

  // Step 2: Execute git pull
  const pullResult = await gitTool.executeGitOperation(appPath, {
    operation: "pull",
    remoteName: options.remoteName,
    branch: options.branch,
    token: options.token,
    repoUrl: options.repoUrl,
  });

  if (!pullResult.success) {
    await markJobFailed(jobId, pullResult.error);
    return;
  }

  // Step 3: Detect build tool
  const buildToolResult = detectBuildToolOnHost(appPath);

  if (!buildToolResult.supported) {
    // Rollback
    await gitTool.executeGitOperation(appPath, {
      operation: "reset",
      options: { mode: "hard", hash: "ORIG_HEAD" },
    });
    await markJobFailed(jobId, "Unsupported project type");
    return;
  }

  const buildToolType =
    buildToolResult.matchedTool === "Node.js" ? "nodejs" : "vite";

  // Step 4: Validate entryFile for Node.js projects
  if (buildToolType === "nodejs" && !options.entryFile) {
    await gitTool.executeGitOperation(appPath, {
      operation: "reset",
      options: { mode: "hard", hash: "ORIG_HEAD" },
    });
    await markJobFailed(
      jobId,
      "entryFile parameter required for Node.js projects",
    );
    return;
  }

  // Step 5: Apply config modifier based on build tool
  const devSupervisor = await DevSupervisorClientFactory.createForApp(appId);

  if (buildToolType === "nodejs" && options.entryFile) {
    // Inject PORT handling for Express
    const portResult = await injectPortHandling(
      devSupervisor,
      "/app",
      options.entryFile,
    );

    if (!portResult.modified && !portResult.skipped) {
      await gitTool.executeGitOperation(appPath, {
        operation: "reset",
        options: { mode: "hard", hash: "ORIG_HEAD" },
      });
      await markJobFailed(jobId, `PORT injection failed: ${portResult.error}`);
      return;
    }
  } else if (buildToolType === "vite" && options.modifyViteConfig) {
    // Existing Vite config modification
    await modifyViteConfig(devSupervisor, "/app");
  }

  // Step 6: Run restart cycle with custom commands
  await appRestartService.performFullRestartCycle(appId, appPath, {
    installCommand: options.installCommand,
    buildCommand: options.buildCommand,
    startCommand: options.startCommand,
    buildToolType,
  });

  // Step 7: Commit post-pull changes
  await this.commitPostPulledChanges(gitTool, appPath, appId, jobId);

  // Step 8: Mark complete
  await this.importJobRepo.markCompleted(jobId);
}
```

---

## Component 8: Error Keys

**File:** `agents/src/types/import.ts`

### Add new validation error keys

```typescript
export enum ValidationErrorKey {
  // Existing keys
  MISSING_PACKAGE_JSON = "missing_package_json",
  NOT_VITE_PROJECT = "not_vite_project", // Keep for backward compatibility

  // New keys
  UNSUPPORTED_PROJECT_TYPE = "unsupported_project_type",
  MISSING_START_SCRIPT = "missing_start_script",
  MISSING_ENTRY_FILE = "missing_entry_file",
  ENTRY_FILE_NOT_FOUND = "entry_file_not_found",
  PORT_INJECTION_FAILED = "port_injection_failed",
}
```

---

## Testing Examples

### Unit Test: Build Tool Detection

```typescript
// agents/src/server/middleware/__tests__/git-import-validation.test.ts

describe("Build Tool Detection", () => {
  describe("NODEJS_BUILD_TOOL", () => {
    it("should detect express in dependencies", () => {
      const packageJson = {
        dependencies: { express: "^4.18.2" },
      };

      const result = hasDependency(packageJson, NODEJS_BUILD_TOOL.packageNames);
      expect(result).toBe(true);
    });

    it("should detect fastify in devDependencies", () => {
      const packageJson = {
        devDependencies: { fastify: "^4.0.0" },
      };

      const result = hasDependency(packageJson, NODEJS_BUILD_TOOL.packageNames);
      expect(result).toBe(true);
    });

    it("should prioritize Vite over Node.js when both present", () => {
      const packageJson = {
        dependencies: { express: "^4.18.2", vite: "^5.0.0" },
      };

      // Vite should match first due to SUPPORTED_BUILD_TOOLS order
      const result = detectBuildTool(packageJson);
      expect(result.matchedTool).toBe("Vite");
    });
  });
});
```

### Unit Test: PORT Injection

```typescript
// agents/src/services/__tests__/ExpressPortInjector.test.ts

describe("ExpressPortInjector", () => {
  describe("transformPortHandling", () => {
    it("should inject process.env.PORT for hardcoded port", () => {
      const input = `app.listen(3000);`;
      const output = transformPortHandling(input, "server.js");

      expect(output).toContain("process.env.PORT || 3000");
      expect(output).toContain("'0.0.0.0'");
    });

    it("should modify const PORT declaration", () => {
      const input = `const PORT = 3001;\napp.listen(PORT);`;
      const output = transformPortHandling(input, "server.js");

      expect(output).toContain("process.env.PORT || 3001");
    });

    it("should replace localhost with 0.0.0.0", () => {
      const input = `app.listen(3000, 'localhost');`;
      const output = transformPortHandling(input, "server.js");

      expect(output).toContain("'0.0.0.0'");
      expect(output).not.toContain("'localhost'");
    });

    it("should skip if process.env.PORT already present", () => {
      const input = `const PORT = process.env.PORT || 3000;\napp.listen(PORT);`;
      const output = transformPortHandling(input, "server.js");

      // Should return unchanged
      expect(output).toBe(input);
    });

    it("should handle TypeScript files", () => {
      const input = `const PORT: number = 3000;\napp.listen(PORT);`;
      const output = transformPortHandling(input, "server.ts");

      expect(output).toContain("process.env.PORT");
    });
  });
});
```

---

## API Request Examples

### ZIP Upload with Custom Commands

```bash
curl -X POST "https://api.example.com/apps/app-123/zip/upload" \
  -H "Authorization: Bearer <jwt>" \
  -F "file=@project.zip" \
  -F "installCommand=pnpm install" \
  -F "buildCommand=pnpm run build" \
  -F "startCommand=pnpm run dev" \
  -F "entryFile=src/server.ts"
```

### Git Pull with Custom Commands

```bash
curl -X POST "https://api.example.com/apps/app-123/git/pull" \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "remoteName": "origin",
    "branch": "main",
    "token": "ghp_xxxx",
    "repoUrl": "https://github.com/org/repo.git",
    "installCommand": "pnpm install",
    "buildCommand": "pnpm run build",
    "startCommand": "pnpm run dev",
    "entryFile": "src/server.ts"
  }'
```

### Poll Import Status

```bash
curl -X GET "https://api.example.com/apps/app-123/zip/upload/status" \
  -H "Authorization: Bearer <jwt>"

# Response
{
  "success": true,
  "jobId": "job-456",
  "appId": "app-123",
  "status": "completed",
  "progress": 100
}
```
