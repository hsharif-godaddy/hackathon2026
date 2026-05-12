# Workspace Client Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `WorkspaceClient` TypeScript surface (`agents/src/workspace/`) — all nine namespace interfaces, shared types, typed errors, `createForWorkspace(workspaceId, variant)` factory, and HTTP adapters. Adapters either map cleanly to today's dev-supervisor endpoints OR throw `WorkspaceNotImplementedError`; nothing silently drops options or encodes legacy contracts as the long-term API.

**Architecture:** Interface and type files live flat under `agents/src/workspace/`; HTTP adapters live under `agents/src/workspace/adapters/`. Adapters consume an existing `DevSupervisorClient` via constructor injection. The factory resolves app → supervisor target (preview socket vs publish socket), constructs the `DevSupervisorClient`, composes sub-adapters into a single `HttpWorkspaceClient`. No existing call sites change.

**Type convention:** These are client-domain TypeScript types used in-process. Timestamps are hydrated to `Date`; durations are numeric seconds/ms. The future remote HTTP/MCP wire DTOs may use ISO-8601 strings and Go-style duration strings — adapters translate at the boundary. Callers program against the client types, not the wire.

**Tech Stack:** TypeScript, Vitest, existing `DevSupervisorClient` (`agents/src/services/DevSupervisorClient.ts`), existing `DevSupervisorClientFactory` (`agents/src/utils/dev-supervisor-client-factory.ts`).

**Spec:** `docs/superpowers/specs/2026-05-08-agent-supervisor-interfaces-design.md`

**Compilation invariant:** Every committed snapshot compiles cleanly. Task ordering introduces `variant.ts` first (the only symbol other files need across the tree), then self-contained interface files, then the composite `client.ts` once every sub-interface exists.

**Out of scope (future plans, one per group):**

- Supervisor Go endpoints for `files`, async `tasks`, `artifacts`, `imports`, `deployments.prepare`, `deployments.activate` (artifact-backed), `version-control`, `config`, `summary`, `capabilities`, `diagnostics.errors`/`runtime-summary`, `runtime.check`, `runtime.start` (needs a proper command/config contract).
- Real adapter implementations for those namespaces.
- Migration of existing call sites off `DevSupervisorClient` / `FileSystemOperations`.
- Remote transport + auth.

**Live in this plan:**

- `runtime.status`, `runtime.stop`, `runtime.restart`, `runtime.configureHealth`
- `diagnostics.logs` (restricted to supported query fields)
- `tasks.runCommandSync` + `tasks.runCommand` (auto/sync mode, restricted to supported fields)
- `deployments.status`, `deployments.unpublish`
- `capabilities()` (variant-aware, static)
- Factory + composer

**Stubbed in this plan (throws `WorkspaceNotImplementedError`):**

- `runtime.start`, `runtime.check`
- `diagnostics.errors`, `diagnostics.runtimeSummary`
- `tasks.runCommandAsync`, `tasks.get`, `tasks.output`, `tasks.cancel`
- `deployments.prepare`, `deployments.activate`
- All of `files`, `artifacts`, `imports`, `version-control`, `config`
- `summary()`

---

## File Structure

New files (all under `agents/src/workspace/`):

**Interfaces + types:**

- `variant.ts` — `WorkspaceVariant` (self-contained; sole cross-namespace type)
- `errors.ts` — typed errors
- `summary.ts` — `WorkspaceSummary`, `WorkspaceCapabilities`
- `files.ts`
- `tasks.ts`
- `runtime.ts`
- `diagnostics.ts`
- `artifacts.ts`
- `imports.ts`
- `deployments.ts`
- `version-control.ts`
- `config.ts`
- `client.ts` — `WorkspaceClient` composite (depends on every sub-interface; lands last)
- `index.ts` — re-exports + `createForWorkspace`

**HTTP adapters (`adapters/`):**

- `http-runtime.ts` — live for status/stop/restart/configureHealth; stubs for start/check
- `http-diagnostics.ts` — live for logs (validated); stubs for errors/runtime-summary
- `http-tasks.ts` — live for sync run-command (validated); stubs for async/get/output/cancel
- `http-deployments.ts` — live for status/unpublish; stubs for prepare/activate
- `http-files.ts` — all stubs
- `http-artifacts.ts` — all stubs
- `http-imports.ts` — all stubs
- `http-version-control.ts` — all stubs
- `http-config.ts` — all stubs
- `http-workspace-client.ts` — composer; variant-aware `capabilities()`

**Tests:**

- `__tests__/errors.test.ts`
- `adapters/__tests__/http-runtime.test.ts`
- `adapters/__tests__/http-diagnostics.test.ts`
- `adapters/__tests__/http-tasks.test.ts`
- `adapters/__tests__/http-deployments.test.ts`
- `adapters/__tests__/http-workspace-client.test.ts`
- `__tests__/create-for-workspace.test.ts`

Total: 24 source files, 7 test files. No existing files are modified.

---

## Task 1: `variant.ts` — the single cross-namespace type

**Files:**

- Create: `agents/src/workspace/variant.ts`

- [ ] **Step 1: Write `agents/src/workspace/variant.ts`**

```typescript
export type WorkspaceVariant = "preview" | "publish";
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/variant.ts
git commit -m "feat(workspace): WorkspaceVariant type"
```

---

## Task 2: Typed errors — TDD

**Files:**

- Create: `agents/src/workspace/errors.ts`
- Test: `agents/src/workspace/__tests__/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/workspace/__tests__/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  WorkspaceUnavailableError,
  VariantNotApplicableError,
  WorkspaceNotImplementedError,
  WorkspaceTaskFailedError,
  WorkspaceValidationError,
} from "../errors.js";

describe("workspace errors", () => {
  it("WorkspaceUnavailableError carries workspaceId and variant", () => {
    const err = new WorkspaceUnavailableError(
      "wksp-1",
      "preview",
      "socket not found",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WorkspaceUnavailableError");
    expect(err.workspaceId).toBe("wksp-1");
    expect(err.variant).toBe("preview");
    expect(err.message).toContain("wksp-1");
    expect(err.message).toContain("preview");
    expect(err.message).toContain("socket not found");
  });

  it("VariantNotApplicableError names the method and variant", () => {
    const err = new VariantNotApplicableError("imports.start", "publish");
    expect(err.name).toBe("VariantNotApplicableError");
    expect(err.method).toBe("imports.start");
    expect(err.variant).toBe("publish");
    expect(err.message).toContain("imports.start");
    expect(err.message).toContain("publish");
  });

  it("WorkspaceNotImplementedError names the method", () => {
    const err = new WorkspaceNotImplementedError("files.tree");
    expect(err.name).toBe("WorkspaceNotImplementedError");
    expect(err.method).toBe("files.tree");
    expect(err.message).toContain("files.tree");
  });

  it("WorkspaceTaskFailedError carries taskId and optional exit code", () => {
    const err = new WorkspaceTaskFailedError("task-42", "non-zero exit", 127);
    expect(err.name).toBe("WorkspaceTaskFailedError");
    expect(err.taskId).toBe("task-42");
    expect(err.exitCode).toBe(127);
  });

  it("WorkspaceValidationError optionally carries field", () => {
    const err = new WorkspaceValidationError(
      "commitHash is required",
      "commitHash",
    );
    expect(err.name).toBe("WorkspaceValidationError");
    expect(err.field).toBe("commitHash");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "workspace/__tests__/errors"`
Expected: FAIL — module `../errors.js` not found.

- [ ] **Step 3: Write `agents/src/workspace/errors.ts`**

```typescript
import type { WorkspaceVariant } from "./variant.js";

export class WorkspaceUnavailableError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly variant: WorkspaceVariant,
    detail?: string,
  ) {
    super(
      `Workspace ${workspaceId} (${variant}) unavailable${detail ? `: ${detail}` : ""}`,
    );
    this.name = "WorkspaceUnavailableError";
  }
}

export class VariantNotApplicableError extends Error {
  constructor(
    public readonly method: string,
    public readonly variant: WorkspaceVariant,
  ) {
    super(`${method} is not applicable on the ${variant} variant`);
    this.name = "VariantNotApplicableError";
  }
}

export class WorkspaceNotImplementedError extends Error {
  constructor(public readonly method: string) {
    super(`${method} is not yet implemented`);
    this.name = "WorkspaceNotImplementedError";
  }
}

export class WorkspaceTaskFailedError extends Error {
  constructor(
    public readonly taskId: string,
    reason: string,
    public readonly exitCode?: number,
  ) {
    super(`Workspace task ${taskId} failed: ${reason}`);
    this.name = "WorkspaceTaskFailedError";
  }
}

export class WorkspaceValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "workspace/__tests__/errors"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add agents/src/workspace/errors.ts agents/src/workspace/__tests__/errors.test.ts
git commit -m "feat(workspace): typed errors for WorkspaceClient boundary"
```

---

## Task 3: `files.ts`

**Files:**

- Create: `agents/src/workspace/files.ts`

- [ ] **Step 1: Write `agents/src/workspace/files.ts`**

`FileEditResult` is a discriminated union mirroring `FileEdit`, so callers consuming results can narrow on `op` and the compiler enforces which fields are present (notably `from`/`to` on `move` vs. `path` on the rest):

```typescript
export interface DirectoryEntry {
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: Date;
}

export interface TreeOptions {
  path?: string;
  recursive?: boolean;
  maxDepth?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface ViewOptions {
  path: string;
  range?: { startLine: number; endLine: number };
}

export interface ViewResult {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
  truncated: boolean;
}

export interface SearchOptions {
  pattern: string;
  path?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export type FileEdit =
  | {
      op: "create";
      path: string;
      content: string;
      encoding?: "utf-8" | "base64";
    }
  | {
      op: "replaceText";
      path: string;
      find: string;
      replace: string;
      occurrence?: number;
      expectedSha256?: string;
    }
  | {
      op: "insertText";
      path: string;
      at:
        | { line: number; column?: number }
        | { beforeText: string }
        | { afterText: string };
      text: string;
      expectedSha256?: string;
    }
  | { op: "delete"; path: string; recursive?: boolean; expectedSha256?: string }
  | { op: "move"; from: string; to: string; expectedSha256?: string };

interface FileEditOutcome {
  ok: boolean;
  error?: string;
  sha256?: string;
}

export type FileEditResult =
  | ({ op: "create"; path: string } & FileEditOutcome)
  | ({ op: "replaceText"; path: string } & FileEditOutcome)
  | ({ op: "insertText"; path: string } & FileEditOutcome)
  | ({ op: "delete"; path: string } & FileEditOutcome)
  | ({ op: "move"; from: string; to: string } & FileEditOutcome);

export interface ApplyEditsOptions {
  edits: FileEdit[];
  expectedWorkspaceRevision?: string;
}

export interface ApplyEditsResponse {
  applied: number;
  results: FileEditResult[];
  workspaceRevision: string;
}

export interface WorkspaceFiles {
  tree(options?: TreeOptions): Promise<DirectoryEntry[]>;
  view(options: ViewOptions): Promise<ViewResult>;
  search(options: SearchOptions): Promise<SearchMatch[]>;
  applyEdits(options: ApplyEditsOptions): Promise<ApplyEditsResponse>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/files.ts
git commit -m "feat(workspace): files interface + AI-oriented edit ops"
```

---

## Task 4: `tasks.ts`

**Files:**

- Create: `agents/src/workspace/tasks.ts`

- [ ] **Step 1: Write `agents/src/workspace/tasks.ts`**

```typescript
export type TaskState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "timed_out";

export interface RunCommandOptions {
  command: string;
  workingDir?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
  captureOutput?: boolean;
  mode?: "sync" | "async" | "auto";
  syncDeadlineMs?: number;
}

export interface RunCommandResult {
  taskId: string;
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
}

export type RunCommandResponse =
  | ({ kind: "completed" } & RunCommandResult)
  | { kind: "accepted"; taskId: string; state: "queued" | "running" };

export interface TaskStatus {
  taskId: string;
  kind: string;
  state: TaskState;
  exitCode?: number;
  timedOut?: boolean;
  startedAt: Date;
  finishedAt?: Date;
  executionTimeMs?: number;
}

export interface TaskOutput {
  stdout: string;
  stderr: string;
  nextOffset: number;
  complete: boolean;
}

export interface WorkspaceTasks {
  runCommand(options: RunCommandOptions): Promise<RunCommandResponse>;
  runCommandSync(options: RunCommandOptions): Promise<RunCommandResult>;
  runCommandAsync(options: RunCommandOptions): Promise<{ taskId: string }>;
  get(taskId: string): Promise<TaskStatus>;
  output(taskId: string, since?: number, max?: number): Promise<TaskOutput>;
  cancel(taskId: string): Promise<{ state: "canceled" | "already_finished" }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/tasks.ts
git commit -m "feat(workspace): tasks interface with dual-mode run-command"
```

---

## Task 5: `runtime.ts`

**Files:**

- Create: `agents/src/workspace/runtime.ts`

- [ ] **Step 1: Write `agents/src/workspace/runtime.ts`**

```typescript
export type ProcessState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

interface HealthCheckConfigBase {
  intervalSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
  successThreshold?: number;
  startPeriodSeconds?: number;
}

export type HealthCheckConfig =
  | ({ type: "http"; url: string } & HealthCheckConfigBase)
  | ({ type: "command"; command: string } & HealthCheckConfigBase)
  | ({ type: "tcp"; address: string } & HealthCheckConfigBase);

export interface RestartPolicy {
  enabled: boolean;
  maxRestarts: number;
  windowSeconds: number;
  backoffMultiplier?: number;
  maxBackoffSeconds?: number;
  initialDelaySeconds?: number;
}

/**
 * A snapshot of the managed process. Reused by `DeploymentStatus.process` so
 * that interface does not silently break when `RuntimeStatus` drops a field.
 */
export interface ProcessSnapshot {
  state: ProcessState;
  pid?: number;
  startedAt?: Date;
  exitCode?: number;
  lastError?: string;
}

export interface RuntimeStatus extends ProcessSnapshot {
  health: {
    status: "healthy" | "unhealthy" | "starting" | "disabled";
    message: string;
    /** Absent when `status` is `'disabled'` or `'starting'` and no check has run yet. */
    lastCheckedAt?: Date;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
  };
  restarts: {
    total: number;
    recent: number;
    windowSeconds: number;
    maxRestarts: number;
  };
}

export interface HealthConfigUpdate {
  healthCheck?: HealthCheckConfig;
  restartPolicy?: RestartPolicy;
}

export interface StopOptions {
  signal?: string;
  timeoutSeconds?: number;
}

export interface RestartOptions {
  graceful?: boolean;
}

export interface WorkspaceRuntime {
  status(): Promise<RuntimeStatus>;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
  restart(options?: RestartOptions): Promise<void>;
  check(): Promise<RuntimeStatus["health"]>;
  configureHealth(update: HealthConfigUpdate): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/runtime.ts
git commit -m "feat(workspace): runtime interface"
```

---

## Task 6: `diagnostics.ts`

**Files:**

- Create: `agents/src/workspace/diagnostics.ts`

- [ ] **Step 1: Write `agents/src/workspace/diagnostics.ts`**

```typescript
export interface LogEntry {
  timestamp: Date;
  source: "stdout" | "stderr" | "system";
  level?: string;
  message: string;
}

export interface LogQuery {
  source?: "stdout" | "stderr";
  lines?: number;
  since?: Date;
  until?: Date;
  filterPattern?: string;
}

export interface ErrorQuery {
  since?: Date;
  lines?: number;
}

export interface RuntimeSummary {
  state: "stopped" | "starting" | "running" | "stopping" | "error";
  recentErrorCount: number;
  lastErrorAt?: Date;
  lastRestartAt?: Date;
  lastCrashReason?: string;
  hints: string[];
}

export interface WorkspaceDiagnostics {
  logs(query?: LogQuery): Promise<LogEntry[]>;
  errors(query?: ErrorQuery): Promise<{ entries: LogEntry[]; count: number }>;
  runtimeSummary(): Promise<RuntimeSummary>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/diagnostics.ts
git commit -m "feat(workspace): diagnostics interface"
```

---

## Task 7: `artifacts.ts`

**Files:**

- Create: `agents/src/workspace/artifacts.ts`

- [ ] **Step 1: Write `agents/src/workspace/artifacts.ts`**

```typescript
export type ArtifactKind = "source-bundle" | "build-bundle" | "uploaded";

export interface ArtifactRef {
  artifactId: string;
  kind: ArtifactKind;
  size: number;
  sha256: string;
  createdAt: Date;
}

export interface CreateSourceBundleOptions {
  includeNodeModules?: boolean;
  includeGit?: boolean;
}

export interface UploadOptions {
  content: Uint8Array;
  filename: string;
  mediaType?: string;
}

export interface WorkspaceArtifacts {
  createSourceBundle(options?: CreateSourceBundleOptions): Promise<ArtifactRef>;
  createBuildBundle(): Promise<ArtifactRef>;
  upload(options: UploadOptions): Promise<ArtifactRef>;
  get(artifactId: string): Promise<ArtifactRef>;
  download(artifactId: string): Promise<Uint8Array>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/artifacts.ts
git commit -m "feat(workspace): artifacts interface"
```

---

## Task 8: `imports.ts`

**Files:**

- Create: `agents/src/workspace/imports.ts`

- [ ] **Step 1: Write `agents/src/workspace/imports.ts`**

```typescript
import type { LogEntry } from "./diagnostics.js";

export interface ImportStart {
  sourceArtifactId?: string;
  gitUrl?: string;
  gitRef?: string;
  commands?: {
    install?: string;
    build?: string;
    start?: string;
  };
}

export type ImportPhase =
  | "extract"
  | "validate"
  | "install"
  | "build"
  | "commit"
  | "restart"
  | "done"
  | "failed";

export interface ImportStatus {
  importId: string;
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  phase: ImportPhase;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  logs?: LogEntry[];
}

export interface WorkspaceImports {
  start(
    options: ImportStart,
  ): Promise<{ importId: string; state: "queued" | "running" }>;
  get(importId: string): Promise<ImportStatus>;
  cancel(importId: string): Promise<{ state: "canceled" | "already_finished" }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/imports.ts
git commit -m "feat(workspace): imports interface"
```

---

## Task 9: `deployments.ts`

**Files:**

- Create: `agents/src/workspace/deployments.ts`

- [ ] **Step 1: Write `agents/src/workspace/deployments.ts`**

```typescript
import type { LogEntry } from "./diagnostics.js";
import type { ProcessSnapshot } from "./runtime.js";

export interface PrepareOptions {
  commitHash?: string;
}

export interface PrepareResult {
  artifactId: string;
  kind: "build-bundle";
  commitHash: string;
  size: number;
  sha256: string;
}

export interface DeployOptions {
  artifactId: string;
  waitForHealthy?: boolean;
  healthTimeoutSeconds?: number;
}

export interface DeployResult {
  status: "success" | "error";
  version: string;
  activatedAt: Date;
  healthStatus?: "healthy" | "unhealthy" | "timeout";
  healthCheckDurationMs?: number;
  error?: string;
  logs?: LogEntry[];
  exitCode?: number;
}

export interface DeploymentStatus {
  version: string | null;
  activatedAt?: Date;
  health: {
    status: "healthy" | "unhealthy" | "stopped" | "unknown";
    message: string;
  };
  process: ProcessSnapshot;
  logs?: LogEntry[];
  warnings?: string[];
}

export interface StatusOptions {
  includeLogs?: boolean;
  logLines?: number;
}

export interface WorkspaceDeployments {
  prepare(options?: PrepareOptions): Promise<PrepareResult>;
  activate(options: DeployOptions): Promise<DeployResult>;
  status(options?: StatusOptions): Promise<DeploymentStatus>;
  unpublish(): Promise<{ status: "success" | "not_published" }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/deployments.ts
git commit -m "feat(workspace): deployments interface"
```

---

## Task 10: `version-control.ts`

**Files:**

- Create: `agents/src/workspace/version-control.ts`

- [ ] **Step 1: Write `agents/src/workspace/version-control.ts`**

```typescript
export interface VersionControlStatus {
  branch: string;
  revision: string;
  dirty: boolean;
  aheadOfRemote?: number;
  behindRemote?: number;
  lastCheckpointAt?: Date;
}

export interface CheckpointOptions {
  message: string;
  paths?: string[];
}

export interface CheckpointResult {
  revision: string;
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface HistoryOptions {
  limit?: number;
  since?: Date;
  paths?: string[];
}

export interface Commit {
  revision: string;
  message: string;
  author: string;
  timestamp: Date;
}

export interface DiffOptions {
  from?: string;
  to?: string;
  paths?: string[];
}

export interface DiffPatch {
  path: string;
  diff: string;
}

export interface PreparePublishOptions {
  message?: string;
}

export interface WorkspaceVersionControl {
  status(): Promise<VersionControlStatus>;
  checkpoint(options: CheckpointOptions): Promise<CheckpointResult>;
  history(options?: HistoryOptions): Promise<Commit[]>;
  diff(options?: DiffOptions): Promise<DiffPatch[]>;
  preparePublish(
    options?: PreparePublishOptions,
  ): Promise<{ revision: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/version-control.ts
git commit -m "feat(workspace): version-control interface"
```

---

## Task 11: `config.ts`

**Files:**

- Create: `agents/src/workspace/config.ts`

- [ ] **Step 1: Write `agents/src/workspace/config.ts`**

```typescript
export interface EnvEntry {
  key: string;
  value: string;
  source: "workspace" | "inherited";
}

export interface SecretEntry {
  key: string;
  source: "workspace" | "inherited";
}

export interface UpsertEnvOptions {
  entries: Array<{ key: string; value: string }>;
  restartRuntime?: boolean;
}

export interface RemoveKeysOptions {
  keys: string[];
  restartRuntime?: boolean;
}

export interface WorkspaceConfig {
  listEnv(): Promise<EnvEntry[]>;
  upsertEnv(options: UpsertEnvOptions): Promise<{ updated: string[] }>;
  removeEnv(options: RemoveKeysOptions): Promise<{ removed: string[] }>;
  listSecrets(): Promise<SecretEntry[]>;
  upsertSecrets(options: UpsertEnvOptions): Promise<{ updated: string[] }>;
  removeSecrets(options: RemoveKeysOptions): Promise<{ removed: string[] }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/config.ts
git commit -m "feat(workspace): config interface"
```

---

## Task 12: `summary.ts`

**Files:**

- Create: `agents/src/workspace/summary.ts`

- [ ] **Step 1: Write `agents/src/workspace/summary.ts`**

```typescript
import type { WorkspaceVariant } from "./variant.js";

export interface WorkspaceSummary {
  workspaceId: string;
  variant: WorkspaceVariant;
  runtime: {
    state: "stopped" | "starting" | "running" | "stopping" | "error";
    pid?: number;
    uptimeSeconds?: number;
    health: "healthy" | "unhealthy" | "starting" | "unknown";
  };
  deployment?: {
    version: string | null;
    activatedAt?: Date;
  };
  diagnostics: {
    recentErrorCount: number;
    lastErrorAt?: Date;
  };
  versionControl?: {
    branch: string;
    revision: string;
    dirty: boolean;
    lastCheckpointAt?: Date;
  };
  capabilities: string[];
}

export type MethodAvailability = "live" | "stubbed" | "variant-not-applicable";

/**
 * Closed union of every addressable method on WorkspaceClient. Using a closed
 * key type makes `caps.methods['runtme.status']` a compile error rather than a
 * silent `undefined` at runtime.
 *
 * Every sub-interface verb appears here exactly once, plus top-level
 * `summary` and `capabilities`.
 */
export type WorkspaceMethodKey =
  // files
  | "files.tree"
  | "files.view"
  | "files.search"
  | "files.applyEdits"
  // tasks
  | "tasks.runCommand"
  | "tasks.runCommandSync"
  | "tasks.runCommandAsync"
  | "tasks.get"
  | "tasks.output"
  | "tasks.cancel"
  // runtime
  | "runtime.status"
  | "runtime.start"
  | "runtime.stop"
  | "runtime.restart"
  | "runtime.check"
  | "runtime.configureHealth"
  // diagnostics
  | "diagnostics.logs"
  | "diagnostics.errors"
  | "diagnostics.runtimeSummary"
  // artifacts
  | "artifacts.createSourceBundle"
  | "artifacts.createBuildBundle"
  | "artifacts.upload"
  | "artifacts.get"
  | "artifacts.download"
  // imports
  | "imports.start"
  | "imports.get"
  | "imports.cancel"
  // deployments
  | "deployments.prepare"
  | "deployments.activate"
  | "deployments.status"
  | "deployments.unpublish"
  // version control
  | "versionControl.status"
  | "versionControl.checkpoint"
  | "versionControl.history"
  | "versionControl.diff"
  | "versionControl.preparePublish"
  // config
  | "config.listEnv"
  | "config.upsertEnv"
  | "config.removeEnv"
  | "config.listSecrets"
  | "config.upsertSecrets"
  | "config.removeSecrets"
  // top-level
  | "summary"
  | "capabilities";

export type WorkspaceNamespaceKey =
  | "files"
  | "tasks"
  | "runtime"
  | "diagnostics"
  | "artifacts"
  | "imports"
  | "deployments"
  | "versionControl"
  | "config";

export interface WorkspaceCapabilities {
  methods: Record<WorkspaceMethodKey, MethodAvailability>;
  versions: Record<WorkspaceNamespaceKey, string>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/summary.ts
git commit -m "feat(workspace): summary and capabilities types"
```

---

## Task 13: `client.ts` — the composite (now all sub-interfaces exist)

**Files:**

- Create: `agents/src/workspace/client.ts`

- [ ] **Step 1: Write `agents/src/workspace/client.ts`**

```typescript
import type { WorkspaceVariant } from "./variant.js";
import type { WorkspaceFiles } from "./files.js";
import type { WorkspaceTasks } from "./tasks.js";
import type { WorkspaceRuntime } from "./runtime.js";
import type { WorkspaceDiagnostics } from "./diagnostics.js";
import type { WorkspaceArtifacts } from "./artifacts.js";
import type { WorkspaceImports } from "./imports.js";
import type { WorkspaceDeployments } from "./deployments.js";
import type { WorkspaceVersionControl } from "./version-control.js";
import type { WorkspaceConfig } from "./config.js";
import type { WorkspaceSummary, WorkspaceCapabilities } from "./summary.js";

export interface WorkspaceClient {
  readonly workspaceId: string;
  readonly variant: WorkspaceVariant;

  summary(): Promise<WorkspaceSummary>;
  capabilities(): Promise<WorkspaceCapabilities>;

  readonly files: WorkspaceFiles;
  readonly tasks: WorkspaceTasks;
  readonly runtime: WorkspaceRuntime;
  readonly diagnostics: WorkspaceDiagnostics;
  readonly artifacts: WorkspaceArtifacts;
  readonly imports: WorkspaceImports;
  readonly deployments: WorkspaceDeployments;
  readonly versionControl: WorkspaceVersionControl;
  readonly config: WorkspaceConfig;
}

export type CreateForWorkspace = (
  workspaceId: string,
  variant: WorkspaceVariant,
) => WorkspaceClient | null;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agents/src/workspace/client.ts
git commit -m "feat(workspace): WorkspaceClient composite interface"
```

---

## Task 14: `index.ts` re-exports

**Files:**

- Create: `agents/src/workspace/index.ts`

- [ ] **Step 1: Write `agents/src/workspace/index.ts`**

```typescript
export * from "./variant.js";
export * from "./client.js";
export * from "./errors.js";
export * from "./summary.js";
export * from "./files.js";
export * from "./tasks.js";
export * from "./runtime.js";
export * from "./diagnostics.js";
export * from "./artifacts.js";
export * from "./imports.js";
export * from "./deployments.js";
export * from "./version-control.js";
export * from "./config.js";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS. If a collision is reported (two files exporting the same name), rename the loser in its file and re-run. As written, no collisions.

- [ ] **Step 3: Commit**

```bash
git add agents/src/workspace/index.ts
git commit -m "feat(workspace): index re-exports"
```

---

## Task 15: Runtime HTTP adapter — TDD

Scope for this adapter:

- Live: `status`, `stop`, `restart`, `configureHealth`.
- Stubbed (throw `WorkspaceNotImplementedError`): `start` (needs a proper start-with-command contract), `check`.

`stop` must throw when the underlying `stopProcess` returns `false`.

**Files:**

- Create: `agents/src/workspace/adapters/http-runtime.ts`
- Test: `agents/src/workspace/adapters/__tests__/http-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DevSupervisorClient } from "../../../services/DevSupervisorClient.js";
import { HttpRuntime } from "../http-runtime.js";
import { WorkspaceNotImplementedError } from "../../errors.js";

function makeClient() {
  return {
    getProcessStatus: vi.fn(),
    getHealthStatus: vi.fn(),
    getRestartStats: vi.fn(),
    startProcess: vi.fn(),
    stopProcess: vi.fn(),
    restartProcess: vi.fn(),
    configureHealthCheck: vi.fn(),
  } as unknown as DevSupervisorClient;
}

describe("HttpRuntime", () => {
  let client: DevSupervisorClient;
  let runtime: HttpRuntime;

  beforeEach(() => {
    client = makeClient();
    runtime = new HttpRuntime(client);
  });

  it.each([
    ["300s", 300],
    ["5m", 300],
    ["5m0s", 300],
    ["1h30m", 5400],
    ["1h30m45s", 5445],
    ["90m", 5400],
    ["1.5s", 1.5],
    ["250ms", 0.25],
    ["42", 42],
    ["", 0],
    ["garbage", 0],
  ])(
    "status() parses restart_window %s as %d seconds",
    async (wire, expected) => {
      (client.getProcessStatus as any).mockResolvedValue({
        pid: 1,
        command: "",
        state: "running",
        start_time: "2026-05-08T10:00:00Z",
      });
      (client.getHealthStatus as any).mockResolvedValue({
        status: "healthy",
        message: "ok",
        last_check: "2026-05-08T10:00:00Z",
        duration: 0,
        consecutive_failures: 0,
        consecutive_successes: 0,
      });
      (client.getRestartStats as any).mockResolvedValue({
        total_restarts: 0,
        recent_restarts: 0,
        restart_window: wire,
        max_restarts: 0,
      });
      const result = await runtime.status();
      expect(result.restarts.windowSeconds).toBeCloseTo(expected, 6);
    },
  );

  it("status() composes process, health, and restart-stats", async () => {
    (client.getProcessStatus as any).mockResolvedValue({
      pid: 42,
      command: "pnpm run dev",
      state: "running",
      start_time: "2026-05-08T10:00:00Z",
    });
    (client.getHealthStatus as any).mockResolvedValue({
      status: "healthy",
      message: "ok",
      last_check: "2026-05-08T10:01:00Z",
      duration: 12,
      consecutive_failures: 0,
      consecutive_successes: 3,
    });
    (client.getRestartStats as any).mockResolvedValue({
      total_restarts: 1,
      recent_restarts: 0,
      restart_window: "300s",
      max_restarts: 5,
    });

    const result = await runtime.status();

    expect(result.state).toBe("running");
    expect(result.pid).toBe(42);
    expect(result.health.status).toBe("healthy");
    expect(result.health.consecutiveSuccesses).toBe(3);
    expect(result.restarts.total).toBe(1);
    expect(result.restarts.windowSeconds).toBe(300);
    expect(result.restarts.maxRestarts).toBe(5);
  });

  it("status() leaves health.lastCheckedAt undefined when last_check is absent (e.g. disabled/starting)", async () => {
    (client.getProcessStatus as any).mockResolvedValue({
      pid: 1,
      command: "",
      state: "starting",
      start_time: "2026-05-08T10:00:00Z",
    });
    (client.getHealthStatus as any).mockResolvedValue({
      status: "starting",
      message: "awaiting first probe",
      last_check: "",
      duration: 0,
      consecutive_failures: 0,
      consecutive_successes: 0,
    });
    (client.getRestartStats as any).mockResolvedValue({
      total_restarts: 0,
      recent_restarts: 0,
      restart_window: "300s",
      max_restarts: 5,
    });
    const result = await runtime.status();
    expect(result.health.status).toBe("starting");
    expect(result.health.lastCheckedAt).toBeUndefined();
  });

  it("start() throws WorkspaceNotImplementedError (no proper start-with-command contract)", async () => {
    await expect(runtime.start()).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
  });

  it("check() throws WorkspaceNotImplementedError", async () => {
    await expect(runtime.check()).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
  });

  it("restart() forwards graceful flag", async () => {
    (client.restartProcess as any).mockResolvedValue({ success: true });
    await runtime.restart({ graceful: false });
    expect(client.restartProcess).toHaveBeenCalledWith({ graceful: false });
  });

  it("restart() throws when underlying call reports failure", async () => {
    (client.restartProcess as any).mockResolvedValue({
      success: false,
      error: "boom",
    });
    await expect(runtime.restart()).rejects.toThrow(/boom/);
  });

  it("stop() forwards signal and timeout", async () => {
    (client.stopProcess as any).mockResolvedValue(true);
    await runtime.stop({ signal: "SIGINT", timeoutSeconds: 10 });
    expect(client.stopProcess).toHaveBeenCalledWith({
      signal: "SIGINT",
      timeout: 10,
    });
  });

  it("stop() throws when stopProcess returns false", async () => {
    (client.stopProcess as any).mockResolvedValue(false);
    await expect(runtime.stop()).rejects.toThrow(/runtime\.stop/);
  });

  it("configureHealth() forwards both pieces", async () => {
    (client.configureHealthCheck as any).mockResolvedValue(undefined);
    const healthCheck = {
      type: "http" as const,
      url: "http://localhost/health",
      intervalSeconds: 10,
      timeoutSeconds: 2,
      failureThreshold: 3,
    };
    const restartPolicy = {
      enabled: true,
      maxRestarts: 5,
      windowSeconds: 300,
    };
    await runtime.configureHealth({ healthCheck, restartPolicy });
    expect(client.configureHealthCheck).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-runtime"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `agents/src/workspace/adapters/http-runtime.ts`**

```typescript
import type { DevSupervisorClient } from "../../services/DevSupervisorClient.js";
import type {
  WorkspaceRuntime,
  RuntimeStatus,
  StopOptions,
  RestartOptions,
  HealthConfigUpdate,
  HealthCheckConfig,
  RestartPolicy,
} from "../runtime.js";
import { WorkspaceNotImplementedError } from "../errors.js";

/**
 * Parse a Go-style duration string into seconds.
 *
 * Accepts:
 *   - plain numbers (interpreted as seconds)
 *   - simple units: "300s", "5m", "1h"
 *   - compound: "5m0s", "1h30m45s", "90m"
 *   - fractional: "1.5s"
 *   - sub-second units: "250ms", "100us", "5ns"
 *
 * Returns 0 for unparseable input rather than throwing — callers use this for
 * observability fields where a zero is preferable to a crash.
 */
function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const re = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    matched = true;
    const n = Number(m[1]);
    switch (m[2]) {
      case "ns":
        total += n / 1e9;
        break;
      case "us":
      case "µs":
        total += n / 1e6;
        break;
      case "ms":
        total += n / 1000;
        break;
      case "s":
        total += n;
        break;
      case "m":
        total += n * 60;
        break;
      case "h":
        total += n * 3600;
        break;
    }
  }
  if (matched) return total;
  const plain = Number(trimmed);
  return Number.isFinite(plain) ? plain : 0;
}

function toHealthCheckWire(config: HealthCheckConfig) {
  const wire: Record<string, unknown> = {
    type: config.type,
    interval: `${config.intervalSeconds}s`,
    timeout: `${config.timeoutSeconds}s`,
    failure_threshold: config.failureThreshold,
  };
  switch (config.type) {
    case "command":
      wire.command = config.command;
      break;
    case "http":
      wire.url = config.url;
      break;
    case "tcp":
      wire.address = config.address;
      break;
  }
  if (config.successThreshold !== undefined)
    wire.success_threshold = config.successThreshold;
  if (config.startPeriodSeconds !== undefined)
    wire.start_period = `${config.startPeriodSeconds}s`;
  return wire;
}

function toRestartPolicyWire(policy: RestartPolicy) {
  const wire: Record<string, unknown> = {
    enabled: policy.enabled,
    max_restarts: policy.maxRestarts,
    restart_window: `${policy.windowSeconds}s`,
  };
  if (policy.backoffMultiplier !== undefined)
    wire.backoff_multiplier = policy.backoffMultiplier;
  if (policy.maxBackoffSeconds !== undefined)
    wire.max_backoff = `${policy.maxBackoffSeconds}s`;
  if (policy.initialDelaySeconds !== undefined)
    wire.initial_delay = `${policy.initialDelaySeconds}s`;
  return wire;
}

export class HttpRuntime implements WorkspaceRuntime {
  constructor(private readonly client: DevSupervisorClient) {}

  async status(): Promise<RuntimeStatus> {
    const [proc, health, restart] = await Promise.all([
      this.client.getProcessStatus(),
      this.client.getHealthStatus(),
      this.client.getRestartStats(),
    ]);

    return {
      state: proc.state as RuntimeStatus["state"],
      pid: proc.pid,
      startedAt: proc.start_time ? new Date(proc.start_time) : undefined,
      exitCode: proc.exit_code,
      lastError: proc.error,
      health: {
        status: health.status,
        message: health.message,
        lastCheckedAt: health.last_check
          ? new Date(health.last_check)
          : undefined,
        consecutiveFailures: health.consecutive_failures,
        consecutiveSuccesses: health.consecutive_successes,
      },
      restarts: {
        total: restart.total_restarts,
        recent: restart.recent_restarts,
        windowSeconds: parseDurationToSeconds(restart.restart_window),
        maxRestarts: restart.max_restarts,
      },
    };
  }

  async start(): Promise<void> {
    // Today's supervisor start endpoint requires a command; the workspace API
    // does not. Proper start requires a command/config contract — deferred.
    throw new WorkspaceNotImplementedError("runtime.start");
  }

  async stop(options?: StopOptions): Promise<void> {
    const ok = await this.client.stopProcess({
      signal: options?.signal ?? "SIGTERM",
      timeout: options?.timeoutSeconds ?? 30,
    });
    if (!ok) {
      throw new Error("runtime.stop failed");
    }
  }

  async restart(options?: RestartOptions): Promise<void> {
    const result = await this.client.restartProcess({
      graceful: options?.graceful !== false,
    });
    if (!result.success) {
      throw new Error(
        `runtime.restart failed: ${result.error ?? "unknown error"}`,
      );
    }
  }

  async check(): Promise<RuntimeStatus["health"]> {
    throw new WorkspaceNotImplementedError("runtime.check");
  }

  async configureHealth(update: HealthConfigUpdate): Promise<void> {
    const hc = update.healthCheck
      ? toHealthCheckWire(update.healthCheck)
      : undefined;
    const rp = update.restartPolicy
      ? toRestartPolicyWire(update.restartPolicy)
      : undefined;
    await this.client.configureHealthCheck(hc as any, rp as any);
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-runtime"`
Expected: PASS (20 tests — 9 behavioral + 11 parametrized duration cases).

- [ ] **Step 5: Commit**

```bash
git add agents/src/workspace/adapters/http-runtime.ts agents/src/workspace/adapters/__tests__/http-runtime.test.ts
git commit -m "feat(workspace): HTTP adapter for runtime (status/stop/restart/configureHealth)"
```

---

## Task 16: Diagnostics HTTP adapter — TDD

Scope:

- Live: `logs` — but only forwards `source`, `lines`, `since`. Passing `until` or `filterPattern` throws `WorkspaceValidationError` (the underlying endpoint does not support them; silently dropping would mislead AI callers).
- Stubbed: `errors`, `runtimeSummary`.

**Files:**

- Create: `agents/src/workspace/adapters/http-diagnostics.ts`
- Test: `agents/src/workspace/adapters/__tests__/http-diagnostics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DevSupervisorClient } from "../../../services/DevSupervisorClient.js";
import { HttpDiagnostics } from "../http-diagnostics.js";
import {
  WorkspaceNotImplementedError,
  WorkspaceValidationError,
} from "../../errors.js";

function makeClient() {
  return { getLogs: vi.fn() } as unknown as DevSupervisorClient;
}

describe("HttpDiagnostics", () => {
  let client: DevSupervisorClient;
  let diag: HttpDiagnostics;

  beforeEach(() => {
    client = makeClient();
    diag = new HttpDiagnostics(client);
  });

  it("logs() forwards source, lines, and since (ISO string)", async () => {
    (client.getLogs as any).mockResolvedValue([
      {
        timestamp: "2026-05-08T10:00:00Z",
        source: "stdout",
        level: "info",
        message: "ready",
      },
    ]);

    const since = new Date("2026-05-08T09:00:00Z");
    const result = await diag.logs({ source: "stdout", lines: 50, since });

    expect(client.getLogs).toHaveBeenCalledWith({
      source: "stdout",
      lines: 50,
      since: since.toISOString(),
    });
    expect(result[0].timestamp).toBeInstanceOf(Date);
  });

  it("logs() with no query forwards an empty object", async () => {
    (client.getLogs as any).mockResolvedValue([]);
    expect(await diag.logs()).toEqual([]);
    expect(client.getLogs).toHaveBeenCalledWith({});
  });

  it("logs() throws WorkspaceValidationError when until is supplied", async () => {
    await expect(diag.logs({ until: new Date() })).rejects.toBeInstanceOf(
      WorkspaceValidationError,
    );
  });

  it("logs() throws WorkspaceValidationError when filterPattern is supplied", async () => {
    await expect(diag.logs({ filterPattern: "boom" })).rejects.toBeInstanceOf(
      WorkspaceValidationError,
    );
  });

  it("errors() throws WorkspaceNotImplementedError", async () => {
    await expect(diag.errors()).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
  });

  it("runtimeSummary() throws WorkspaceNotImplementedError", async () => {
    await expect(diag.runtimeSummary()).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-diagnostics"`
Expected: FAIL.

- [ ] **Step 3: Write `agents/src/workspace/adapters/http-diagnostics.ts`**

```typescript
import type { DevSupervisorClient } from "../../services/DevSupervisorClient.js";
import type {
  WorkspaceDiagnostics,
  LogEntry,
  LogQuery,
  ErrorQuery,
  RuntimeSummary,
} from "../diagnostics.js";
import {
  WorkspaceNotImplementedError,
  WorkspaceValidationError,
} from "../errors.js";

export class HttpDiagnostics implements WorkspaceDiagnostics {
  constructor(private readonly client: DevSupervisorClient) {}

  async logs(query: LogQuery = {}): Promise<LogEntry[]> {
    if (query.until !== undefined) {
      throw new WorkspaceValidationError(
        'diagnostics.logs: "until" is not supported by this adapter',
        "until",
      );
    }
    if (query.filterPattern !== undefined) {
      throw new WorkspaceValidationError(
        'diagnostics.logs: "filterPattern" is not supported by this adapter',
        "filterPattern",
      );
    }
    const wire: Record<string, unknown> = {};
    if (query.source) wire.source = query.source;
    if (query.lines !== undefined) wire.lines = query.lines;
    if (query.since) wire.since = query.since.toISOString();
    const entries = await this.client.getLogs(wire as any);
    return entries.map((e) => ({
      timestamp: new Date(e.timestamp),
      source: e.source as LogEntry["source"],
      level: e.level,
      message: e.message,
    }));
  }

  async errors(
    _query?: ErrorQuery,
  ): Promise<{ entries: LogEntry[]; count: number }> {
    throw new WorkspaceNotImplementedError("diagnostics.errors");
  }

  async runtimeSummary(): Promise<RuntimeSummary> {
    throw new WorkspaceNotImplementedError("diagnostics.runtimeSummary");
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-diagnostics"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add agents/src/workspace/adapters/http-diagnostics.ts agents/src/workspace/adapters/__tests__/http-diagnostics.test.ts
git commit -m "feat(workspace): HTTP adapter for diagnostics.logs with strict option validation"
```

---

## Task 17: Tasks HTTP adapter — TDD

Scope:

- Live: `runCommandSync`, `runCommand` in sync/auto mode.
- Validation: rejects `env` (supervisor `/exec` does not forward env) and `syncDeadlineMs` (no deadline enforcement at this layer).
- Stubbed: `runCommandAsync`, `get`, `output`, `cancel`, and `runCommand` with `mode: 'async'`.

**Files:**

- Create: `agents/src/workspace/adapters/http-tasks.ts`
- Test: `agents/src/workspace/adapters/__tests__/http-tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DevSupervisorClient } from "../../../services/DevSupervisorClient.js";
import { HttpTasks } from "../http-tasks.js";
import {
  WorkspaceNotImplementedError,
  WorkspaceValidationError,
} from "../../errors.js";

function makeClient() {
  return { exec: vi.fn() } as unknown as DevSupervisorClient;
}

describe("HttpTasks", () => {
  let client: DevSupervisorClient;
  let tasks: HttpTasks;

  beforeEach(() => {
    client = makeClient();
    tasks = new HttpTasks(client);
  });

  it("runCommandSync returns a RunCommandResult with a synthesized taskId", async () => {
    (client.exec as any).mockResolvedValue({
      command: "ls",
      exit_code: 0,
      stdout: "a\nb\n",
      stderr: "",
      execution_time: 12,
      success: true,
      timed_out: false,
    });

    const result = await tasks.runCommandSync({ command: "ls" });

    expect(client.exec).toHaveBeenCalledWith({
      command: "ls",
      working_dir: undefined,
      timeout: undefined,
      capture_output: undefined,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a\nb\n");
    expect(result.timedOut).toBe(false);
    expect(result.executionTimeMs).toBe(12);
    expect(result.taskId).toMatch(/^sync-/);
  });

  it("runCommandSync forwards workingDir, timeout, captureOutput", async () => {
    (client.exec as any).mockResolvedValue({
      command: "pnpm test",
      exit_code: 1,
      stdout: "",
      stderr: "fail",
      execution_time: 500,
      success: false,
      timed_out: false,
    });

    await tasks.runCommandSync({
      command: "pnpm test",
      workingDir: "/app",
      timeoutSeconds: 60,
      captureOutput: false,
    });

    expect(client.exec).toHaveBeenCalledWith({
      command: "pnpm test",
      working_dir: "/app",
      timeout: 60,
      capture_output: false,
    });
  });

  it("runCommandSync throws WorkspaceValidationError when env is supplied", async () => {
    await expect(
      tasks.runCommandSync({ command: "ls", env: { FOO: "bar" } }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("runCommandSync throws WorkspaceValidationError when syncDeadlineMs is supplied", async () => {
    await expect(
      tasks.runCommandSync({ command: "ls", syncDeadlineMs: 5000 }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("runCommand (auto) returns completed kind", async () => {
    (client.exec as any).mockResolvedValue({
      command: "echo hi",
      exit_code: 0,
      stdout: "hi\n",
      stderr: "",
      execution_time: 5,
      success: true,
      timed_out: false,
    });
    const response = await tasks.runCommand({ command: "echo hi" });
    expect(response.kind).toBe("completed");
    if (response.kind === "completed") {
      expect(response.stdout).toBe("hi\n");
    }
  });

  it("runCommand with mode async throws WorkspaceNotImplementedError", async () => {
    await expect(
      tasks.runCommand({ command: "ls", mode: "async" }),
    ).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });

  it("runCommandAsync throws WorkspaceNotImplementedError", async () => {
    await expect(
      tasks.runCommandAsync({ command: "ls" }),
    ).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });

  it("get, output, cancel all throw WorkspaceNotImplementedError", async () => {
    await expect(tasks.get("x")).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
    await expect(tasks.output("x")).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
    await expect(tasks.cancel("x")).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-tasks"`
Expected: FAIL.

- [ ] **Step 3: Write `agents/src/workspace/adapters/http-tasks.ts`**

```typescript
import type { DevSupervisorClient } from "../../services/DevSupervisorClient.js";
import type {
  WorkspaceTasks,
  RunCommandOptions,
  RunCommandResponse,
  RunCommandResult,
  TaskStatus,
  TaskOutput,
} from "../tasks.js";
import {
  WorkspaceNotImplementedError,
  WorkspaceValidationError,
} from "../errors.js";

function syntheticTaskId(): string {
  // No module-level mutable state — uniqueness comes from timestamp + random.
  // Real task IDs will be server-assigned once the async endpoint exists.
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateSupported(options: RunCommandOptions): void {
  if (options.env !== undefined) {
    throw new WorkspaceValidationError(
      'tasks.runCommand: "env" is not supported by this adapter',
      "env",
    );
  }
  if (options.syncDeadlineMs !== undefined) {
    throw new WorkspaceValidationError(
      'tasks.runCommand: "syncDeadlineMs" is not supported by this adapter',
      "syncDeadlineMs",
    );
  }
}

export class HttpTasks implements WorkspaceTasks {
  constructor(private readonly client: DevSupervisorClient) {}

  async runCommand(options: RunCommandOptions): Promise<RunCommandResponse> {
    const mode = options.mode ?? "auto";
    if (mode === "async") {
      throw new WorkspaceNotImplementedError("tasks.runCommand (async mode)");
    }
    const result = await this.runCommandSync(options);
    return { kind: "completed", ...result };
  }

  async runCommandSync(options: RunCommandOptions): Promise<RunCommandResult> {
    validateSupported(options);
    const wire = {
      command: options.command,
      working_dir: options.workingDir,
      timeout: options.timeoutSeconds,
      capture_output: options.captureOutput,
    };
    const raw = await this.client.exec(wire as any);
    return {
      taskId: syntheticTaskId(),
      exitCode: raw.exit_code ?? 0,
      timedOut: Boolean(raw.timed_out),
      stdout: raw.stdout ?? "",
      stderr: raw.stderr ?? "",
      executionTimeMs: raw.execution_time ?? 0,
    };
  }

  async runCommandAsync(
    _options: RunCommandOptions,
  ): Promise<{ taskId: string }> {
    throw new WorkspaceNotImplementedError("tasks.runCommandAsync");
  }

  async get(_taskId: string): Promise<TaskStatus> {
    throw new WorkspaceNotImplementedError("tasks.get");
  }

  async output(
    _taskId: string,
    _since?: number,
    _max?: number,
  ): Promise<TaskOutput> {
    throw new WorkspaceNotImplementedError("tasks.output");
  }

  async cancel(
    _taskId: string,
  ): Promise<{ state: "canceled" | "already_finished" }> {
    throw new WorkspaceNotImplementedError("tasks.cancel");
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-tasks"`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add agents/src/workspace/adapters/http-tasks.ts agents/src/workspace/adapters/__tests__/http-tasks.test.ts
git commit -m "feat(workspace): HTTP adapter for tasks (sync only; strict option validation)"
```

---

## Task 18: Deployments HTTP adapter — TDD

Scope:

- Live on publish variant: `status`, `unpublish`.
- Stubbed: `prepare` (preview-only, no endpoint yet) and `activate` (deferred — mapping `artifactId → commitHash` would encode a legacy bridge as the long-term API; deferred until real artifact-backed activation exists).
- Variant gating: `prepare` on non-preview and `activate`/`status`/`unpublish` on non-publish throw `VariantNotApplicableError`.

**Files:**

- Create: `agents/src/workspace/adapters/http-deployments.ts`
- Test: `agents/src/workspace/adapters/__tests__/http-deployments.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DevSupervisorClient } from "../../../services/DevSupervisorClient.js";
import { HttpDeployments } from "../http-deployments.js";
import {
  WorkspaceNotImplementedError,
  VariantNotApplicableError,
} from "../../errors.js";

function makeClient() {
  return {
    publish: vi.fn(),
    unpublish: vi.fn(),
    getPublishStatus: vi.fn(),
  } as unknown as DevSupervisorClient;
}

describe("HttpDeployments", () => {
  let client: DevSupervisorClient;

  beforeEach(() => {
    client = makeClient();
  });

  describe("publish variant", () => {
    let deployments: HttpDeployments;
    beforeEach(() => {
      deployments = new HttpDeployments(client, "publish");
    });

    it("activate throws WorkspaceNotImplementedError (artifact-backed activation deferred)", async () => {
      await expect(
        deployments.activate({ artifactId: "abc" }),
      ).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
    });

    it("unpublish forwards to client.unpublish", async () => {
      (client.unpublish as any).mockResolvedValue({ status: "success" });
      const result = await deployments.unpublish();
      expect(result.status).toBe("success");
    });

    it("status maps getPublishStatus response", async () => {
      (client.getPublishStatus as any).mockResolvedValue({
        version: "v1",
        health: { status: "healthy", message: "ok" },
        process: {
          state: "running",
          pid: 10,
          uptime: "5m",
        },
        warnings: [],
      });
      const result = await deployments.status({ includeLogs: false });
      expect(client.getPublishStatus).toHaveBeenCalledWith({
        includeLogs: false,
        lines: undefined,
      });
      expect(result.version).toBe("v1");
      expect(result.process.state).toBe("running");
      expect(result.process.pid).toBe(10);
    });

    it("prepare throws VariantNotApplicableError (preview-only)", async () => {
      await expect(deployments.prepare()).rejects.toBeInstanceOf(
        VariantNotApplicableError,
      );
    });
  });

  describe("preview variant", () => {
    let deployments: HttpDeployments;
    beforeEach(() => {
      deployments = new HttpDeployments(client, "preview");
    });

    it("activate throws VariantNotApplicableError", async () => {
      await expect(
        deployments.activate({ artifactId: "x" }),
      ).rejects.toBeInstanceOf(VariantNotApplicableError);
    });

    it("unpublish throws VariantNotApplicableError", async () => {
      await expect(deployments.unpublish()).rejects.toBeInstanceOf(
        VariantNotApplicableError,
      );
    });

    it("status throws VariantNotApplicableError", async () => {
      await expect(deployments.status()).rejects.toBeInstanceOf(
        VariantNotApplicableError,
      );
    });

    it("prepare throws WorkspaceNotImplementedError", async () => {
      await expect(deployments.prepare()).rejects.toBeInstanceOf(
        WorkspaceNotImplementedError,
      );
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-deployments"`
Expected: FAIL.

- [ ] **Step 3: Write `agents/src/workspace/adapters/http-deployments.ts`**

```typescript
import type { DevSupervisorClient } from "../../services/DevSupervisorClient.js";
import type {
  WorkspaceDeployments,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  PrepareOptions,
  PrepareResult,
  StatusOptions,
} from "../deployments.js";
import type { ProcessSnapshot } from "../runtime.js";
import type { WorkspaceVariant } from "../variant.js";
import {
  VariantNotApplicableError,
  WorkspaceNotImplementedError,
} from "../errors.js";

export class HttpDeployments implements WorkspaceDeployments {
  constructor(
    private readonly client: DevSupervisorClient,
    private readonly variant: WorkspaceVariant,
  ) {}

  async prepare(_options?: PrepareOptions): Promise<PrepareResult> {
    if (this.variant !== "preview") {
      throw new VariantNotApplicableError("deployments.prepare", this.variant);
    }
    throw new WorkspaceNotImplementedError("deployments.prepare");
  }

  async activate(_options: DeployOptions): Promise<DeployResult> {
    if (this.variant !== "publish") {
      throw new VariantNotApplicableError("deployments.activate", this.variant);
    }
    // Deferred: mapping artifactId → commitHash against today's /publish would
    // lock a legacy bridge into the long-term contract. Wait for real
    // artifact-backed activation before implementing.
    throw new WorkspaceNotImplementedError("deployments.activate");
  }

  async status(options?: StatusOptions): Promise<DeploymentStatus> {
    if (this.variant !== "publish") {
      throw new VariantNotApplicableError("deployments.status", this.variant);
    }
    const response = await this.client.getPublishStatus({
      includeLogs: options?.includeLogs,
      lines: options?.logLines,
    });

    return {
      version: response.version,
      health: response.health,
      process: {
        state: response.process.state as ProcessSnapshot["state"],
        pid: response.process.pid,
      },
      logs: response.logs?.map((l: any) => ({
        timestamp: new Date(l.timestamp),
        source: l.source,
        message: l.message,
      })),
      warnings: response.warnings,
    };
  }

  async unpublish(): Promise<{ status: "success" | "not_published" }> {
    if (this.variant !== "publish") {
      throw new VariantNotApplicableError(
        "deployments.unpublish",
        this.variant,
      );
    }
    const response = await this.client.unpublish();
    return { status: response.status };
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-deployments"`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add agents/src/workspace/adapters/http-deployments.ts agents/src/workspace/adapters/__tests__/http-deployments.test.ts
git commit -m "feat(workspace): HTTP adapter for deployments (status/unpublish; activate deferred)"
```

---

## Task 19: Stub adapters for not-yet-implemented namespaces

**Files:**

- Create: `agents/src/workspace/adapters/http-files.ts`
- Create: `agents/src/workspace/adapters/http-artifacts.ts`
- Create: `agents/src/workspace/adapters/http-imports.ts`
- Create: `agents/src/workspace/adapters/http-version-control.ts`
- Create: `agents/src/workspace/adapters/http-config.ts`

Each implements its interface by throwing `WorkspaceNotImplementedError`. Variant-gated namespaces enforce variant checks before throwing NotImplemented.

- [ ] **Step 1: Write `agents/src/workspace/adapters/http-files.ts`**

```typescript
import type {
  WorkspaceFiles,
  TreeOptions,
  ViewOptions,
  ViewResult,
  SearchOptions,
  SearchMatch,
  ApplyEditsOptions,
  ApplyEditsResponse,
  DirectoryEntry,
} from "../files.js";
import { WorkspaceNotImplementedError } from "../errors.js";

export class HttpFiles implements WorkspaceFiles {
  async tree(_options?: TreeOptions): Promise<DirectoryEntry[]> {
    throw new WorkspaceNotImplementedError("files.tree");
  }
  async view(_options: ViewOptions): Promise<ViewResult> {
    throw new WorkspaceNotImplementedError("files.view");
  }
  async search(_options: SearchOptions): Promise<SearchMatch[]> {
    throw new WorkspaceNotImplementedError("files.search");
  }
  async applyEdits(_options: ApplyEditsOptions): Promise<ApplyEditsResponse> {
    throw new WorkspaceNotImplementedError("files.applyEdits");
  }
}
```

- [ ] **Step 2: Write `agents/src/workspace/adapters/http-artifacts.ts`**

```typescript
import type {
  WorkspaceArtifacts,
  ArtifactRef,
  CreateSourceBundleOptions,
  UploadOptions,
} from "../artifacts.js";
import { WorkspaceNotImplementedError } from "../errors.js";

export class HttpArtifacts implements WorkspaceArtifacts {
  async createSourceBundle(
    _options?: CreateSourceBundleOptions,
  ): Promise<ArtifactRef> {
    throw new WorkspaceNotImplementedError("artifacts.createSourceBundle");
  }
  async createBuildBundle(): Promise<ArtifactRef> {
    throw new WorkspaceNotImplementedError("artifacts.createBuildBundle");
  }
  async upload(_options: UploadOptions): Promise<ArtifactRef> {
    throw new WorkspaceNotImplementedError("artifacts.upload");
  }
  async get(_artifactId: string): Promise<ArtifactRef> {
    throw new WorkspaceNotImplementedError("artifacts.get");
  }
  async download(_artifactId: string): Promise<Uint8Array> {
    throw new WorkspaceNotImplementedError("artifacts.download");
  }
}
```

- [ ] **Step 3: Write `agents/src/workspace/adapters/http-imports.ts`**

```typescript
import type {
  WorkspaceImports,
  ImportStart,
  ImportStatus,
} from "../imports.js";
import type { WorkspaceVariant } from "../variant.js";
import {
  VariantNotApplicableError,
  WorkspaceNotImplementedError,
} from "../errors.js";

export class HttpImports implements WorkspaceImports {
  constructor(private readonly variant: WorkspaceVariant) {}

  async start(
    _options: ImportStart,
  ): Promise<{ importId: string; state: "queued" | "running" }> {
    if (this.variant !== "preview") {
      throw new VariantNotApplicableError("imports.start", this.variant);
    }
    throw new WorkspaceNotImplementedError("imports.start");
  }
  async get(_importId: string): Promise<ImportStatus> {
    throw new WorkspaceNotImplementedError("imports.get");
  }
  async cancel(
    _importId: string,
  ): Promise<{ state: "canceled" | "already_finished" }> {
    throw new WorkspaceNotImplementedError("imports.cancel");
  }
}
```

- [ ] **Step 4: Write `agents/src/workspace/adapters/http-version-control.ts`**

```typescript
import type {
  WorkspaceVersionControl,
  VersionControlStatus,
  CheckpointOptions,
  CheckpointResult,
  HistoryOptions,
  Commit,
  DiffOptions,
  DiffPatch,
  PreparePublishOptions,
} from "../version-control.js";
import type { WorkspaceVariant } from "../variant.js";
import {
  VariantNotApplicableError,
  WorkspaceNotImplementedError,
} from "../errors.js";

export class HttpVersionControl implements WorkspaceVersionControl {
  constructor(private readonly variant: WorkspaceVariant) {}

  private ensurePreview(method: string) {
    if (this.variant !== "preview") {
      throw new VariantNotApplicableError(method, this.variant);
    }
  }

  async status(): Promise<VersionControlStatus> {
    this.ensurePreview("versionControl.status");
    throw new WorkspaceNotImplementedError("versionControl.status");
  }
  async checkpoint(_options: CheckpointOptions): Promise<CheckpointResult> {
    this.ensurePreview("versionControl.checkpoint");
    throw new WorkspaceNotImplementedError("versionControl.checkpoint");
  }
  async history(_options?: HistoryOptions): Promise<Commit[]> {
    this.ensurePreview("versionControl.history");
    throw new WorkspaceNotImplementedError("versionControl.history");
  }
  async diff(_options?: DiffOptions): Promise<DiffPatch[]> {
    this.ensurePreview("versionControl.diff");
    throw new WorkspaceNotImplementedError("versionControl.diff");
  }
  async preparePublish(
    _options?: PreparePublishOptions,
  ): Promise<{ revision: string }> {
    this.ensurePreview("versionControl.preparePublish");
    throw new WorkspaceNotImplementedError("versionControl.preparePublish");
  }
}
```

- [ ] **Step 5: Write `agents/src/workspace/adapters/http-config.ts`**

```typescript
import type {
  WorkspaceConfig,
  EnvEntry,
  SecretEntry,
  UpsertEnvOptions,
  RemoveKeysOptions,
} from "../config.js";
import type { WorkspaceVariant } from "../variant.js";
import {
  VariantNotApplicableError,
  WorkspaceNotImplementedError,
} from "../errors.js";

export class HttpConfig implements WorkspaceConfig {
  constructor(private readonly variant: WorkspaceVariant) {}

  private ensureMutationAllowed(method: string) {
    // Per spec: mutation restricted on publish variant by default.
    if (this.variant === "publish") {
      throw new VariantNotApplicableError(method, this.variant);
    }
  }

  async listEnv(): Promise<EnvEntry[]> {
    throw new WorkspaceNotImplementedError("config.listEnv");
  }
  async upsertEnv(_options: UpsertEnvOptions): Promise<{ updated: string[] }> {
    this.ensureMutationAllowed("config.upsertEnv");
    throw new WorkspaceNotImplementedError("config.upsertEnv");
  }
  async removeEnv(_options: RemoveKeysOptions): Promise<{ removed: string[] }> {
    this.ensureMutationAllowed("config.removeEnv");
    throw new WorkspaceNotImplementedError("config.removeEnv");
  }
  async listSecrets(): Promise<SecretEntry[]> {
    throw new WorkspaceNotImplementedError("config.listSecrets");
  }
  async upsertSecrets(
    _options: UpsertEnvOptions,
  ): Promise<{ updated: string[] }> {
    this.ensureMutationAllowed("config.upsertSecrets");
    throw new WorkspaceNotImplementedError("config.upsertSecrets");
  }
  async removeSecrets(
    _options: RemoveKeysOptions,
  ): Promise<{ removed: string[] }> {
    this.ensureMutationAllowed("config.removeSecrets");
    throw new WorkspaceNotImplementedError("config.removeSecrets");
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agents/src/workspace/adapters/http-files.ts agents/src/workspace/adapters/http-artifacts.ts agents/src/workspace/adapters/http-imports.ts agents/src/workspace/adapters/http-version-control.ts agents/src/workspace/adapters/http-config.ts
git commit -m "feat(workspace): stub adapters for not-yet-implemented namespaces"
```

---

## Task 20: `HttpWorkspaceClient` composer — TDD

Variant-aware, method-level `capabilities()`: one entry per method with availability `'live' | 'stubbed' | 'variant-not-applicable'`. Keeps the advertisement honest so `capabilities()` is a reliable source of truth for callers.

**Files:**

- Create: `agents/src/workspace/adapters/http-workspace-client.ts`
- Test: `agents/src/workspace/adapters/__tests__/http-workspace-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import type { DevSupervisorClient } from "../../../services/DevSupervisorClient.js";
import { HttpWorkspaceClient } from "../http-workspace-client.js";
import { WorkspaceNotImplementedError } from "../../errors.js";

function makeClient() {
  return {
    exec: vi.fn(),
    getLogs: vi.fn(),
    getProcessStatus: vi.fn(),
    getHealthStatus: vi.fn(),
    getRestartStats: vi.fn(),
    restartProcess: vi.fn(),
    stopProcess: vi.fn(),
    configureHealthCheck: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    getPublishStatus: vi.fn(),
  } as unknown as DevSupervisorClient;
}

describe("HttpWorkspaceClient", () => {
  it("exposes workspaceId and variant", () => {
    const wsc = new HttpWorkspaceClient("wksp-1", "preview", makeClient());
    expect(wsc.workspaceId).toBe("wksp-1");
    expect(wsc.variant).toBe("preview");
  });

  it("exposes all nine sub-adapters as properties", () => {
    const wsc = new HttpWorkspaceClient("wksp-1", "preview", makeClient());
    expect(wsc.files).toBeDefined();
    expect(wsc.tasks).toBeDefined();
    expect(wsc.runtime).toBeDefined();
    expect(wsc.diagnostics).toBeDefined();
    expect(wsc.artifacts).toBeDefined();
    expect(wsc.imports).toBeDefined();
    expect(wsc.deployments).toBeDefined();
    expect(wsc.versionControl).toBeDefined();
    expect(wsc.config).toBeDefined();
  });

  it("summary() throws WorkspaceNotImplementedError", async () => {
    const wsc = new HttpWorkspaceClient("wksp-1", "preview", makeClient());
    await expect(wsc.summary()).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
  });

  it("capabilities() on preview reports method-level availability", async () => {
    const wsc = new HttpWorkspaceClient("wksp-1", "preview", makeClient());
    const caps = await wsc.capabilities();

    // Live on preview
    expect(caps.methods["runtime.status"]).toBe("live");
    expect(caps.methods["runtime.restart"]).toBe("live");
    expect(caps.methods["diagnostics.logs"]).toBe("live");
    expect(caps.methods["tasks.runCommandSync"]).toBe("live");

    // Stubbed on preview
    expect(caps.methods["runtime.start"]).toBe("stubbed");
    expect(caps.methods["files.tree"]).toBe("stubbed");
    expect(caps.methods["deployments.prepare"]).toBe("stubbed");

    // Publish-only on preview
    expect(caps.methods["deployments.activate"]).toBe("variant-not-applicable");
    expect(caps.methods["deployments.status"]).toBe("variant-not-applicable");
    expect(caps.methods["deployments.unpublish"]).toBe(
      "variant-not-applicable",
    );

    expect(caps.versions.runtime).toBeDefined();
  });

  it("capabilities() on publish reports method-level availability", async () => {
    const wsc = new HttpWorkspaceClient("wksp-1", "publish", makeClient());
    const caps = await wsc.capabilities();

    // Live on publish
    expect(caps.methods["runtime.status"]).toBe("live");
    expect(caps.methods["diagnostics.logs"]).toBe("live");
    expect(caps.methods["deployments.status"]).toBe("live");
    expect(caps.methods["deployments.unpublish"]).toBe("live");
    expect(caps.methods["tasks.runCommandSync"]).toBe("live");

    // Stubbed on publish (real method, not yet wired)
    expect(caps.methods["deployments.activate"]).toBe("stubbed");

    // Preview-only on publish
    expect(caps.methods["deployments.prepare"]).toBe("variant-not-applicable");
    expect(caps.methods["imports.start"]).toBe("variant-not-applicable");
    expect(caps.methods["versionControl.checkpoint"]).toBe(
      "variant-not-applicable",
    );
    expect(caps.methods["config.upsertEnv"]).toBe("variant-not-applicable");

    expect(caps.versions.deployments).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-workspace-client"`
Expected: FAIL.

- [ ] **Step 3: Write `agents/src/workspace/adapters/http-workspace-client.ts`**

```typescript
import type { DevSupervisorClient } from "../../services/DevSupervisorClient.js";
import type { WorkspaceClient } from "../client.js";
import type { WorkspaceVariant } from "../variant.js";
import type {
  WorkspaceSummary,
  WorkspaceCapabilities,
  WorkspaceMethodKey,
  WorkspaceNamespaceKey,
  MethodAvailability,
} from "../summary.js";
import { WorkspaceNotImplementedError } from "../errors.js";
import { HttpFiles } from "./http-files.js";
import { HttpTasks } from "./http-tasks.js";
import { HttpRuntime } from "./http-runtime.js";
import { HttpDiagnostics } from "./http-diagnostics.js";
import { HttpArtifacts } from "./http-artifacts.js";
import { HttpImports } from "./http-imports.js";
import { HttpDeployments } from "./http-deployments.js";
import { HttpVersionControl } from "./http-version-control.js";
import { HttpConfig } from "./http-config.js";

const BASE_VERSIONS: Record<WorkspaceNamespaceKey, string> = {
  runtime: "1-partial",
  diagnostics: "1-logs-only",
  tasks: "1-sync-only",
  files: "0-stubbed",
  artifacts: "0-stubbed",
  imports: "0-stubbed",
  deployments: "0-partial",
  versionControl: "0-stubbed",
  config: "0-stubbed",
};

const COMMON_METHODS: Partial<Record<WorkspaceMethodKey, MethodAvailability>> =
  {
    // runtime
    "runtime.status": "live",
    "runtime.start": "stubbed",
    "runtime.stop": "live",
    "runtime.restart": "live",
    "runtime.check": "stubbed",
    "runtime.configureHealth": "live",
    // diagnostics
    "diagnostics.logs": "live",
    "diagnostics.errors": "stubbed",
    "diagnostics.runtimeSummary": "stubbed",
    // tasks
    "tasks.runCommand": "live",
    "tasks.runCommandSync": "live",
    "tasks.runCommandAsync": "stubbed",
    "tasks.get": "stubbed",
    "tasks.output": "stubbed",
    "tasks.cancel": "stubbed",
    // files
    "files.tree": "stubbed",
    "files.view": "stubbed",
    "files.search": "stubbed",
    "files.applyEdits": "stubbed",
    // artifacts
    "artifacts.createSourceBundle": "stubbed",
    "artifacts.createBuildBundle": "stubbed",
    "artifacts.upload": "stubbed",
    "artifacts.get": "stubbed",
    "artifacts.download": "stubbed",
    // top-level
    summary: "stubbed",
    capabilities: "live",
  };

const PREVIEW_METHODS = {
  ...COMMON_METHODS,
  // deployments — only prepare is preview-applicable (and currently stubbed)
  "deployments.prepare": "stubbed",
  "deployments.activate": "variant-not-applicable",
  "deployments.status": "variant-not-applicable",
  "deployments.unpublish": "variant-not-applicable",
  // imports — preview-applicable, all stubbed today
  "imports.start": "stubbed",
  "imports.get": "stubbed",
  "imports.cancel": "stubbed",
  // version control — preview-applicable, all stubbed
  "versionControl.status": "stubbed",
  "versionControl.checkpoint": "stubbed",
  "versionControl.history": "stubbed",
  "versionControl.diff": "stubbed",
  "versionControl.preparePublish": "stubbed",
  // config — preview allows mutation; all stubbed today
  "config.listEnv": "stubbed",
  "config.upsertEnv": "stubbed",
  "config.removeEnv": "stubbed",
  "config.listSecrets": "stubbed",
  "config.upsertSecrets": "stubbed",
  "config.removeSecrets": "stubbed",
} satisfies Record<WorkspaceMethodKey, MethodAvailability>;

const PUBLISH_METHODS = {
  ...COMMON_METHODS,
  // deployments — activate is real-method-but-stubbed; status/unpublish live; prepare preview-only
  "deployments.prepare": "variant-not-applicable",
  "deployments.activate": "stubbed",
  "deployments.status": "live",
  "deployments.unpublish": "live",
  // imports — preview-only; get/cancel are symmetric and not meaningful without start
  "imports.start": "variant-not-applicable",
  "imports.get": "variant-not-applicable",
  "imports.cancel": "variant-not-applicable",
  // version control — preview-only per adapter gate
  "versionControl.status": "variant-not-applicable",
  "versionControl.checkpoint": "variant-not-applicable",
  "versionControl.history": "variant-not-applicable",
  "versionControl.diff": "variant-not-applicable",
  "versionControl.preparePublish": "variant-not-applicable",
  // config — reads stubbed, mutation variant-not-applicable on publish
  "config.listEnv": "stubbed",
  "config.upsertEnv": "variant-not-applicable",
  "config.removeEnv": "variant-not-applicable",
  "config.listSecrets": "stubbed",
  "config.upsertSecrets": "variant-not-applicable",
  "config.removeSecrets": "variant-not-applicable",
} satisfies Record<WorkspaceMethodKey, MethodAvailability>;

const PREVIEW_CAPABILITIES: WorkspaceCapabilities = {
  methods: PREVIEW_METHODS,
  versions: BASE_VERSIONS,
};

const PUBLISH_CAPABILITIES: WorkspaceCapabilities = {
  methods: PUBLISH_METHODS,
  versions: BASE_VERSIONS,
};

export class HttpWorkspaceClient implements WorkspaceClient {
  readonly files: HttpFiles;
  readonly tasks: HttpTasks;
  readonly runtime: HttpRuntime;
  readonly diagnostics: HttpDiagnostics;
  readonly artifacts: HttpArtifacts;
  readonly imports: HttpImports;
  readonly deployments: HttpDeployments;
  readonly versionControl: HttpVersionControl;
  readonly config: HttpConfig;

  constructor(
    public readonly workspaceId: string,
    public readonly variant: WorkspaceVariant,
    client: DevSupervisorClient,
  ) {
    this.files = new HttpFiles();
    this.tasks = new HttpTasks(client);
    this.runtime = new HttpRuntime(client);
    this.diagnostics = new HttpDiagnostics(client);
    this.artifacts = new HttpArtifacts();
    this.imports = new HttpImports(variant);
    this.deployments = new HttpDeployments(client, variant);
    this.versionControl = new HttpVersionControl(variant);
    this.config = new HttpConfig(variant);
  }

  async summary(): Promise<WorkspaceSummary> {
    throw new WorkspaceNotImplementedError("workspace.summary");
  }

  async capabilities(): Promise<WorkspaceCapabilities> {
    return this.variant === "publish"
      ? PUBLISH_CAPABILITIES
      : PREVIEW_CAPABILITIES;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-workspace-client"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add agents/src/workspace/adapters/http-workspace-client.ts agents/src/workspace/adapters/__tests__/http-workspace-client.test.ts
git commit -m "feat(workspace): HttpWorkspaceClient composer with variant-aware capabilities"
```

---

## Task 21: `createForWorkspace` factory — TDD

**Files:**

- Create: `agents/src/workspace/__tests__/create-for-workspace.test.ts`
- Modify: `agents/src/workspace/index.ts` — add `createForWorkspace`

- [ ] **Step 1: Confirm the factory methods to delegate to**

Before writing the test, inspect `agents/src/utils/dev-supervisor-client-factory.ts` to confirm exact method names.

Run: `grep -n "createForApp\|createForPublishSupervisor\|createForSocketPath\|static " agents/src/utils/dev-supervisor-client-factory.ts`

Expected: `createForApp(appId)` at minimum. If the publish-side method is named differently, substitute the correct name in Steps 2 and 4.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createForWorkspace } from "../index.js";
import { DevSupervisorClientFactory } from "../../utils/dev-supervisor-client-factory.js";

describe("createForWorkspace", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when createForApp returns null (no socketPath on the app record)", () => {
    vi.spyOn(DevSupervisorClientFactory, "createForApp").mockReturnValue(null);
    expect(createForWorkspace("wksp-1", "preview")).toBeNull();
  });

  it("returns null when createForApp throws (unknown workspace)", () => {
    vi.spyOn(DevSupervisorClientFactory, "createForApp").mockImplementation(
      () => {
        throw new Error("App with ID unknown not found");
      },
    );
    expect(createForWorkspace("unknown", "preview")).toBeNull();
  });

  it("returns null when createForPublishSupervisor throws", () => {
    vi.spyOn(
      DevSupervisorClientFactory,
      "createForPublishSupervisor",
    ).mockImplementation(() => {
      throw new Error("App with ID unknown not found");
    });
    expect(createForWorkspace("unknown", "publish")).toBeNull();
  });

  it("returns a WorkspaceClient bound to preview when the preview client exists", () => {
    const fakeClient = { isAvailable: () => true } as any;
    vi.spyOn(DevSupervisorClientFactory, "createForApp").mockReturnValue(
      fakeClient,
    );
    const client = createForWorkspace("wksp-1", "preview");
    expect(client).not.toBeNull();
    expect(client?.workspaceId).toBe("wksp-1");
    expect(client?.variant).toBe("preview");
  });

  it("returns a WorkspaceClient bound to publish when the publish supervisor is reachable", () => {
    const fakeClient = { isAvailable: () => true } as any;
    const spy = vi
      .spyOn(DevSupervisorClientFactory, "createForPublishSupervisor")
      .mockReturnValue(fakeClient);
    const client = createForWorkspace("wksp-1", "publish");
    expect(client?.variant).toBe("publish");
    expect(spy).toHaveBeenCalledWith("wksp-1");
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm --filter @airo/agents test:unit "workspace/__tests__/create-for-workspace"`
Expected: FAIL.

- [ ] **Step 4: Append the factory to `agents/src/workspace/index.ts`**

Add at the bottom:

```typescript
import { DevSupervisorClientFactory } from "../utils/dev-supervisor-client-factory.js";
import { HttpWorkspaceClient } from "./adapters/http-workspace-client.js";
import type { WorkspaceClient } from "./client.js";
import type { WorkspaceVariant } from "./variant.js";

/**
 * Bind a WorkspaceClient to a workspace + variant.
 *
 * Returns `null` for either failure mode (callers that need to distinguish
 * them should retry and surface their own error):
 *   1. Unknown workspace — `DevSupervisorClientFactory.createForApp` throws
 *      (`App with ID ... not found`) when the app record is absent; we
 *      translate the throw to `null`.
 *   2. Unreachable supervisor — `createForApp` returns a client whenever the
 *      app record has a `socketPath`, without probing reachability.
 *      Unreachability surfaces as a typed error on the first method call,
 *      not at bind time. A live probe here would be a future refinement.
 */
export function createForWorkspace(
  workspaceId: string,
  variant: WorkspaceVariant,
): WorkspaceClient | null {
  try {
    const client =
      variant === "publish"
        ? DevSupervisorClientFactory.createForPublishSupervisor(workspaceId)
        : DevSupervisorClientFactory.createForApp(workspaceId);
    if (!client) return null;
    return new HttpWorkspaceClient(workspaceId, variant, client);
  } catch {
    return null;
  }
}
```

If Step 1 revealed a different publish-side method name, use that name here.

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm --filter @airo/agents test:unit "workspace/__tests__/create-for-workspace"`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add agents/src/workspace/__tests__/create-for-workspace.test.ts agents/src/workspace/index.ts
git commit -m "feat(workspace): createForWorkspace factory"
```

---

## Task 22: Full test + typecheck + lint + build sweep

- [ ] **Step 1: Run all workspace tests**

Run: `pnpm --filter @airo/agents test:unit "workspace/"`
Expected: all tests pass (approximately 57 tests across 7 test files).

- [ ] **Step 2: Typecheck the whole package**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 3: Lint the whole package**

Run: `pnpm --filter @airo/agents lint`
Expected: PASS. Fix any errors reported in `agents/src/workspace/`.

- [ ] **Step 4: Build the whole package**

Run: `pnpm --filter @airo/agents build`
Expected: PASS.

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A agents/src/workspace
git commit -m "chore(workspace): lint fixes"
```

Skip if no changes.

---

## Done

At the end of this plan:

- `agents/src/workspace/` with 14 interface/type files and `index.ts` that re-exports everything plus `createForWorkspace`.
- 10 HTTP adapters; every commit on the branch compiles cleanly.
- Live surface: `runtime.{status,stop,restart,configureHealth}`, `diagnostics.logs` (validated), `tasks.{runCommandSync,runCommand}` (sync/auto, validated), `deployments.{status,unpublish}`, `capabilities()` (variant-aware).
- Stubbed surface: everything else — throws `WorkspaceNotImplementedError`. Unsupported option fields on live methods throw `WorkspaceValidationError`.
- Typed errors: `WorkspaceUnavailableError`, `VariantNotApplicableError`, `WorkspaceNotImplementedError`, `WorkspaceTaskFailedError`, `WorkspaceValidationError`.
- ~57 tests. No existing code paths changed.

Follow-up plans (one per group) fill in stubbed adapters as supervisor-side endpoints land, then migrate call sites off `DevSupervisorClientFactory.createForApp`.
