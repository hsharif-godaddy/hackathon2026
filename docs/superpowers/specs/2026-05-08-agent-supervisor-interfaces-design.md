# Workspace Client

**Status:** Draft
**Date:** 2026-05-08
**Scope:** Define an intent-oriented HTTP API the agent speaks to its preview/publish workspaces, and the `WorkspaceClient` TypeScript interface that mirrors it. No call-site migration; supervisor-side endpoint implementation phased.

## Problem

The agent reaches its preview/publish containers through a grab-bag of concretes:

- `DevSupervisorClient` (exec, process, logs, health, publish, setup, proxy, diagnostics) reached via `DevSupervisorClientFactory.createForApp(appId)` at ~50 sites.
- `FileSystemOperations` (POSIX-shaped: `readFile`, `mkdir`, `stat`, `readdir`, `open`, streams) — a shim over `node:fs/promises`.
- Direct `node:fs` / `child_process` reach-ins in tools and routes.
- Agent-side logic that *conceptually* belongs to the workspace: tarball creation, git porcelain, zip-import orchestration, .env file patching.

Two problems:

1. **Shape.** What's exposed mirrors the mechanism (POSIX syscalls, supervisor endpoints, agent-local tars). It does not mirror the *intent* the agent is expressing: "run this command and give me bounded output," "make a publishable artifact," "checkpoint my changes," "summarize what's going wrong."
2. **Transport.** POSIX-per-call and local-tarball creation don't translate cleanly to a remote HTTP service. The supervisor is being lifted to a remotely callable API; the contract the agent programs against should be sized for that transport from the start.

## Goal

Define the intent-oriented HTTP API the agent speaks to a workspace, and the TypeScript `WorkspaceClient` that mirrors it. Each endpoint names the job the agent is doing, not the supervisor's implementation detail.

## Scope

- **In:** The HTTP API shape (namespaces, verbs, payload sketches). The TypeScript `WorkspaceClient` interface and its sub-interfaces. An HTTP adapter that implements `WorkspaceClient` by calling the API. The `createForWorkspace(workspaceId, variant)` factory. Tests for adapters.
- **In (phased):** Supervisor-side endpoint implementation — mapped below to what exists today vs. what's new. The existing `DevSupervisorClient` continues to work; the new adapter reuses it where endpoints already exist and grows alongside supervisor work for the rest.
- **Out:** Migrating existing call sites. `DevSupervisorClient`, `DevSupervisorClientFactory`, and `FileSystemOperations` stay put; the new client lands alongside them.
- **Out:** Remote transport and auth — separate specs. The interface is transport-agnostic; auth attaches at the HTTP client layer the adapter receives.
- **Out:** Full rename of `appId` → `workspaceId` across the codebase. The name changes at the new interface boundary only.

## Terminology

- **Workspace** replaces "app" at the interface boundary — `workspaceId` is the identifier.
- **Variant** is one of `"preview" | "publish"`. Today's `app.socketPath` is the preview variant; `app.publishSupervisorPath` is the publish variant.
- **Task** is a named unit of asynchronous work (initially: command execution; later: imports, artifact builds).
- **Artifact** is an immutable blob in workspace-scoped storage, addressed by ID.

## HTTP API Shape

Top-level inspection:

```
GET  /workspace/summary        # cheap overview for an AI first-call
GET  /workspace/capabilities   # which namespaces this variant supports
```

Namespaces:

```
/workspace/files               # read, tree, search, structured edits
/workspace/tasks               # async command execution
/workspace/runtime             # managed app lifecycle
/workspace/diagnostics         # logs, errors, summaries
/workspace/artifacts           # immutable blobs
/workspace/imports             # source import workflows
/workspace/deployments         # prepare / activate / status / unpublish
/workspace/version-control     # intent-based git
/workspace/config              # typed env and secrets
```

Convention: `GET` for pure reads; `POST` for actions (including queries with structured bodies).

### `/workspace/summary` and `/workspace/capabilities`

```
GET /workspace/summary
  → {
      workspaceId, variant,
      runtime: { state, pid?, uptimeSeconds?, health: 'healthy' | 'unhealthy' | 'starting' | 'unknown' },
      deployment?: { version: string | null, activatedAt?: <ISO-8601 string> },
      diagnostics: { recentErrorCount: number, lastErrorAt?: <ISO-8601 string> },
      versionControl?: { branch, revision, dirty, lastCheckpointAt? },
      capabilities: string[],            // e.g. ["files","tasks","runtime",...]
    }

GET /workspace/capabilities
  → {
      methods: {
        [namespaceMethodKey: string]: 'live' | 'stubbed' | 'variant-not-applicable',
        // e.g. "runtime.status": "live", "deployments.prepare": "variant-not-applicable"
      },
      versions: { [namespace: string]: string }
    }
```

`summary` is a single cheap call that seeds an agent turn; `capabilities` advertises what this variant supports so the client can branch without probing each namespace. Method-level availability lets callers branch on individual verbs — `runtime.status` may be live on both variants while `deployments.activate` is stubbed on publish and variant-not-applicable on preview. Wire payloads use ISO-8601 strings for timestamps; the TypeScript client hydrates them to `Date` at the adapter boundary.

### `/workspace/files`

Intent verbs, not POSIX. All paths are workspace-relative.

```
POST /workspace/files/tree
  body: { path?, recursive?, maxDepth?, includeGlobs?, excludeGlobs? }
  → { entries: [{ path, kind: 'file'|'directory', size, modifiedAt }] }

POST /workspace/files/view
  body: { path, range?: { startLine, endLine } }
  → { path, content: string, encoding: 'utf-8'|'base64', truncated: boolean }

POST /workspace/files/search
  body: { pattern, path?, caseSensitive?, maxResults?, includeGlobs?, excludeGlobs? }
  → { matches: [{ path, line, column, preview }] }

POST /workspace/files/apply-edits
  body: {
    edits: FileEdit[],                   # batched
    expectedWorkspaceRevision?: string,  # optimistic concurrency on the workspace as a whole
  }
  → { applied: number, results: FileEditResult[], workspaceRevision: string }
```

`FileEdit` is a discriminated union of AI-oriented ops. Each op optionally carries `expectedSha256` on the target file so the agent can guard against clobbering changes it hasn't seen.

```typescript
type FileEdit =
  | { op: 'create';      path: string; content: string; encoding?: 'utf-8' | 'base64' }          # fails if exists
  | { op: 'replaceText'; path: string; find: string; replace: string; occurrence?: number; expectedSha256?: string }
  | { op: 'insertText';  path: string; at: { line: number; column?: number } | { beforeText: string } | { afterText: string }; text: string; expectedSha256?: string }
  | { op: 'delete';      path: string; recursive?: boolean; expectedSha256?: string }
  | { op: 'move';        from: string; to: string; expectedSha256?: string };
```

Why batched: the agent typically produces multi-file changes in one turn; one round-trip per file is wasteful over HTTP. `create` auto-creates parents. `replaceText`/`insertText` are the common AI modify patterns; a blunt "overwrite file" can still be expressed as `delete` + `create` when the agent genuinely means to replace wholesale, which forces it to confront the intent.

`expectedWorkspaceRevision` is returned by every mutating response (`apply-edits`, `version-control.checkpoint`, `imports.*` completion). Passing the stale value back on the next edit produces a typed conflict rather than a silent overwrite.

Dropped from the prior POSIX surface: `mkdir`, `access`, `stat`, `open`, `FileHandle`, `createReadStream`, `createWriteStream`. Dropped from the prior draft: a standalone `write` verb — folded into `create` (strict) and `delete`+`create` (replace). A `patch`-style multi-find/replace within one file is expressed as multiple `replaceText` ops in one `apply-edits` call.

### `/workspace/tasks`

Dual-mode: one endpoint, two response shapes. The caller declares its preference; the server may downgrade to async if it chooses, but never upgrades to sync.

```
POST /workspace/tasks/run-command
  body: {
    command, workingDir?, env?, timeoutSeconds?, captureOutput?,
    mode?: 'sync' | 'async' | 'auto',   # default 'auto'
    syncDeadlineMs?: number,            # default 30_000 when mode != 'async'
  }
  → # completed (sync/auto, finished within deadline):
    { kind: 'completed', taskId, exitCode, timedOut, stdout, stderr, executionTimeMs }
  |
    # accepted (async, or auto-downgraded):
    { kind: 'accepted', taskId, state: 'queued' | 'running' }

GET  /workspace/tasks/:id
  → { taskId, kind: 'run-command', state, exitCode?, timedOut?, startedAt, finishedAt?, executionTimeMs? }

GET  /workspace/tasks/:id/output
  ?  since?=<offset>&max?=<bytes>
  → { stdout, stderr, nextOffset, complete }

POST /workspace/tasks/:id/cancel
  → { state: 'canceled' | 'already_finished' }
```

Response shape is discriminated by `kind`. `'completed'` carries the full result inline; `'accepted'` hands back a task ID for polling. `'auto'` prefers `'completed'` when the command finishes within `syncDeadlineMs`; longer-running commands are returned as `'accepted'` so the HTTP connection doesn't hold forever.

Two TypeScript conveniences mirror the pattern:

```typescript
interface WorkspaceTasks {
  runCommand(options: RunCommandOptions): Promise<RunCommandResponse>;        // exact HTTP shape
  runCommandSync(options: RunCommandOptions): Promise<RunCommandResult>;       # blocks; rejects if server returned 'accepted' past deadline
  runCommandAsync(options: RunCommandOptions): Promise<{ taskId: string }>;   # forces mode='async'
  get(taskId: string): Promise<TaskStatus>;
  output(taskId: string, since?: number, max?: number): Promise<TaskOutput>;
  cancel(taskId: string): Promise<{ state: 'canceled' | 'already_finished' }>;
}
```

Migration path: today's `exec` callers move to `runCommandSync` without restructuring. Callers with long-running work (imports, builds) move to async deliberately.

Supervisor-side: today's `/exec` is synchronous. Until async infrastructure lands, the adapter honors `mode: 'async'` by returning a fake task ID and completing it in one sync call under the hood, so client code compiled against the async surface keeps working. Task IDs, cancel, and incremental output become real when the supervisor endpoint does.

### `/workspace/runtime`

Managed app process lifecycle + health config.

```
GET  /workspace/runtime/status
  → { state, pid?, startedAt?, exitCode?, lastError?,
      health: { status: 'healthy'|'unhealthy'|'starting'|'disabled',
                message, lastCheckedAt, consecutiveFailures, consecutiveSuccesses },
      restarts: { total, recent, windowSeconds, maxRestarts } }

POST /workspace/runtime/start
POST /workspace/runtime/stop      { signal?, timeoutSeconds? }
POST /workspace/runtime/restart   { graceful? }
POST /workspace/runtime/check     # trigger an on-demand health probe, return fresh result

POST /workspace/runtime/health-config
  body: { healthCheck?: HealthCheckConfig, restartPolicy?: RestartPolicy }
  → 204
```

`status` collapses today's `/process/status`, `/health-config/status`, and `/health-config/restart-stats` into one response. `health-config` is configuration; `check` is an on-demand probe the agent can run after a change.

### `/workspace/diagnostics`

Diagnostic-oriented, not raw log dumping.

```
POST /workspace/diagnostics/logs
  body: { source?: 'stdout'|'stderr', lines?, since?, until?, filterPattern? }
  → { entries: LogEntry[] }

POST /workspace/diagnostics/errors
  body: { since?, lines? }
  → { entries: LogEntry[], count }

POST /workspace/diagnostics/runtime-summary
  → { state, recentErrorCount, lastErrorAt?,
      lastRestartAt?, lastCrashReason?, hints: string[] }
```

`runtime-summary` is the "what should the agent know right now" call — cheap, opinionated, plain-language `hints` for the LLM (e.g., "process crashed 3× in last 5m with ENOENT on ./node_modules/.bin/vite"). `errors` is a pre-filtered slice rather than the agent post-processing a raw tail.

### `/workspace/artifacts`

Immutable blobs addressed by ID. The agent does not pick tar flags.

```
POST /workspace/artifacts/create-source-bundle
  body: { includeNodeModules?: boolean, includeGit?: boolean }
  → { artifactId, size, sha256, kind: 'source-bundle' }

POST /workspace/artifacts/create-build-bundle
  body: {}
  → { artifactId, size, sha256, kind: 'build-bundle' }  # errors if dist/ missing

POST /workspace/artifacts/upload
  body: multipart or { content: base64, filename, mediaType? }
  → { artifactId, size, sha256, kind: 'uploaded' }

GET  /workspace/artifacts/:id
  → { artifactId, kind, size, sha256, createdAt }

GET  /workspace/artifacts/:id/content
  → binary stream
```

Artifacts are workspace-scoped and retained long enough to flow through deployments and imports (see below). Retention policy is a supervisor concern; the client sees IDs.

### `/workspace/imports`

Workflow endpoints. Input references an artifact ID (normally one produced by `artifacts/upload`).

```
POST /workspace/imports/start
  body: {
    sourceArtifactId?: string,       # zip-style import
    gitUrl?: string, gitRef?: string, # git-style import
    commands?: { install?: string, build?: string, start?: string }
  }
  → { importId, state: 'queued' | 'running' }

GET  /workspace/imports/:id
  → { importId, state, phase: 'extract'|'validate'|'install'|'build'|'commit'|'restart'|'done'|'failed',
      startedAt, finishedAt?, error?, logs?: LogEntry[] }

POST /workspace/imports/:id/cancel
  → { state: 'canceled' | 'already_finished' }
```

The workspace owns extraction, validation, cleanup, install/build, commit, and restart. The agent says "import this" and polls.

### `/workspace/deployments`

Split across variants:

| Verb | Preview | Publish |
|---|---|---|
| `prepare` | ✓ (build + create build-bundle artifact) | — |
| `activate` | — | ✓ (activate an artifact by ID) |
| `status` | limited | ✓ |
| `unpublish` | — | ✓ |

```
# Preview
POST /workspace/deployments/prepare
  body: { commitHash?: string }
  → { artifactId, kind: 'build-bundle', commitHash, size, sha256 }

# Publish
POST /workspace/deployments/activate
  body: { artifactId, waitForHealthy?, healthTimeoutSeconds? }
  → { status, version, activatedAt, healthStatus?, healthCheckDurationMs? }

GET  /workspace/deployments/status
  ?  includeLogs?=<bool>&logLines?=<n>
  → { version: string|null, activatedAt?, health: {...}, process: {...}, logs?, warnings? }

POST /workspace/deployments/unpublish
  → { status: 'success' | 'not_published' }
```

The shift from today's `publish(commitHash)` is that deploy is a two-step across variants: preview produces an artifact, publish activates it. The artifact ID is the hand-off. Adapter can provide a one-shot helper that chains both for callers that don't care.

### `/workspace/version-control`

Intent-based. Raw git remains reachable via `/workspace/tasks/run-command`.

```
POST /workspace/version-control/status
  → { branch, revision, dirty, aheadOfRemote?, behindRemote?, lastCheckpointAt? }

POST /workspace/version-control/checkpoint
  body: { message, paths?: string[] }   # paths default = all changed
  → { revision, summary: { filesChanged, insertions, deletions } }

POST /workspace/version-control/history
  body: { limit?, since?, paths? }
  → { commits: [{ revision, message, author, timestamp }] }

POST /workspace/version-control/diff
  body: { from?, to?, paths? }          # defaults: working tree vs HEAD
  → { patches: [{ path, diff }] }

POST /workspace/version-control/prepare-publish
  body: { message? }
  → { revision }                        # checkpoint + any publish-specific bookkeeping
```

`checkpoint` is the AI-facing verb for "stage relevant changes and commit." Today's `GitUtils` porcelain stays until callers migrate.

### `/workspace/config`

Typed env and secrets. Replaces .env file patching.

```
GET  /workspace/config/env
  → { entries: [{ key, value, source: 'workspace'|'inherited' }] }

POST /workspace/config/env/upsert
  body: { entries: [{ key, value }], restartRuntime?: boolean }
  → { updated: string[] }

POST /workspace/config/env/remove
  body: { keys: string[], restartRuntime?: boolean }
  → { removed: string[] }

GET  /workspace/config/secrets
  → { entries: [{ key, source: 'workspace'|'inherited' }] }  # no values

POST /workspace/config/secrets/upsert
  body: { entries: [{ key, value }], restartRuntime?: boolean }
  → { updated: string[] }

POST /workspace/config/secrets/remove
  body: { keys: string[], restartRuntime?: boolean }
  → { removed: string[] }
```

Secret values are write-only; the agent can set them but cannot read them back. `restartRuntime` is a convenience so the agent doesn't have to make a second `runtime/restart` call.

**Publish-variant constraint:** on the publish variant, `config.env` and `config.secrets` reads/status are allowed; mutation is restricted to activation-time (i.e., via `deployments.activate`'s config payload, TBD) unless the platform model explicitly supports live mutation of a published workspace. The client surfaces this as `VariantNotApplicableError` on direct `upsert`/`remove` against the publish variant by default; a capability flag from `/workspace/capabilities` may relax it.

## TypeScript Interface

One 1:1 mirror of the HTTP shape.

```typescript
export type WorkspaceVariant = 'preview' | 'publish';

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

export function createForWorkspace(
  workspaceId: string,
  variant: WorkspaceVariant,
): WorkspaceClient | null;
```

Each sub-interface mirrors its namespace's verbs exactly — e.g. `files.tree`, `files.view`, `files.search`, `files.applyEdits`; `tasks.runCommand`, `tasks.get`, `tasks.output`, `tasks.cancel`, plus a synchronous convenience `tasks.runCommandSync`; `deployments.prepare` / `deployments.activate` / `deployments.status` / `deployments.unpublish` with `VariantNotApplicableError` on the wrong variant.

Type names mirror payload shapes (`TreeOptions`, `ViewOptions`, `FileEdit`, `RunCommandOptions`, `TaskStatus`, `RuntimeStatus`, `HealthCheckConfig`, `ArtifactRef`, `ImportStatus`, `DeployResult`, `DiffOptions`, `EnvEntry`, `SecretEntry`).

## Variant Applicability

| Namespace | Preview | Publish |
|---|---|---|
| `files` | read/write | read-only |
| `tasks` | ✓ | limited (debugging) |
| `runtime` | ✓ | ✓ |
| `diagnostics` | ✓ | ✓ |
| `artifacts` | ✓ (create + upload) | consume (download) |
| `imports` | ✓ | — |
| `deployments` | `prepare` only | `activate`/`status`/`unpublish` |
| `version-control` | ✓ | — |
| `config` | ✓ | ✓ |

Misuse (`imports.start` on a publish-variant client) throws `VariantNotApplicableError`. `capabilities()` advertises what the variant supports.

## Mapping to Today's Supervisor

| Namespace verb | Today's wire | Status |
|---|---|---|
| `files.*` | none (FileSystemOperations does POSIX via exec) | New supervisor endpoints |
| `tasks.runCommandSync` | `POST /exec` | Exists; use as-is |
| `tasks.runCommand`/`get`/`output`/`cancel` | — | New |
| `runtime.status` | `GET /process/status` + `/health-config/status` + `/restart-stats` | Exists (adapter composes) |
| `runtime.start`/`stop`/`restart` | `POST /process/*` | Exists |
| `runtime.check` | — | New |
| `runtime.configureHealth` | `PUT /health-config` | Exists |
| `diagnostics.logs` | `GET /logs` | Exists |
| `diagnostics.errors` / `runtime-summary` | — | New |
| `artifacts.*` | — | New. Subsumes agent-side tarball creation in `agents/src/utils/git.ts` |
| `imports.*` | handled in agents routes (`/zip-import`, `/git-import`) | New supervisor endpoints; agent routes migrate to call them |
| `deployments.prepare` | — | New (on preview variant) |
| `deployments.activate` | `POST /publish` | Exists; param shape changes (artifactId vs commitHash) |
| `deployments.status` | `GET /publish/status` | Exists |
| `deployments.unpublish` | `POST /unpublish` | Exists |
| `version-control.*` | none (agent-side `GitUtils` via exec) | New |
| `config.*` | `/api/secrets` (alloc file) + .env patching | New |
| `summary` / `capabilities` | — | New |

Phasing: the adapter can ship in parts. Endpoints that exist today plug in immediately; endpoints that don't are implemented in the supervisor alongside adapter coverage as follow-up work. Each sub-interface is usable as soon as its endpoints land; callers migrate when their namespace is ready.

## Dropped from the Public Client

`getProxyConfig`, `getProxyStatus`, `getInfo`, supervisor-self `healthCheck`, and `isAvailable` are dropped from `WorkspaceClient` — no live callers justify them on the public surface.

They are **not** dropped from implementation concerns. The factory still needs equivalent bind/reachability behavior internally: `createForWorkspace` must be able to probe that a supervisor target is reachable before returning a client (today's `isAvailable`), and supervisor self-health is a legitimate platform/debug need reachable through the concrete `DevSupervisorClient` or a future admin surface. What's being removed is agent-code dependency on these verbs, not the capability itself.

## Error Model

Typed errors at the interface boundary:

- `WorkspaceUnavailableError` — workspace not reachable.
- `VariantNotApplicableError` — method not supported on this variant.
- `WorkspaceNotImplementedError` — method exists in the interface but its adapter is not yet wired (covers phased rollout of supervisor endpoints).
- `WorkspaceTaskFailedError` — task surfaced a failure (non-zero exit, import phase error).
- `WorkspaceValidationError` — 4xx from the HTTP layer with a machine-readable `field` when possible.

Everything else surfaces as `Error` with cause chained. Adapters normalize HTTP status codes; they do not leak `ECONNREFUSED`/`ENOENT`.

## Directory Layout

```
agents/src/workspace/
├── client.ts                 # WorkspaceClient, WorkspaceVariant, createForWorkspace signature
├── files.ts                  # WorkspaceFiles + types
├── tasks.ts
├── runtime.ts
├── diagnostics.ts
├── artifacts.ts
├── imports.ts
├── deployments.ts
├── version-control.ts
├── config.ts
├── summary.ts                # summary() + capabilities() response types
├── errors.ts
├── index.ts                  # re-exports + factory
└── adapters/
    ├── http-workspace-client.ts
    ├── http-files.ts
    ├── http-tasks.ts
    ├── http-runtime.ts
    ├── http-diagnostics.ts
    ├── http-artifacts.ts
    ├── http-imports.ts
    ├── http-deployments.ts
    ├── http-version-control.ts
    ├── http-config.ts
    └── __tests__/
```

Each HTTP adapter receives an HTTP client (or, during phasing, a `DevSupervisorClient`) and implements exactly its namespace. The top-level `HttpWorkspaceClient` composes them. The seam the remote-transport spec plugs into is the HTTP client injected here.

## Factory

```typescript
export function createForWorkspace(
  workspaceId: string,
  variant: WorkspaceVariant,
): WorkspaceClient | null;
```

Returns `null` when the workspace is unknown or unreachable at bind time. Internally:

1. Look up the workspace's supervisor target for the variant.
2. Build the HTTP client (currently: `DevSupervisorClient` wrapping the unix socket; future: remote).
3. Construct sub-adapters and compose into `HttpWorkspaceClient`.

Auth attaches at step 2 and remains the factory's concern.

## Tests

- Per-adapter unit tests against a mocked HTTP/`DevSupervisorClient`, verifying request shape and response parsing.
- Integration tests against a fake HTTP server exercising the full `WorkspaceClient`.
- Variant tests: `imports.start` on publish variant throws `VariantNotApplicableError`; `deployments.activate` on preview throws.
- Contract tests asserting mapped-to-today endpoints produce identical wire calls as the current `DevSupervisorClient`.

## Migration / Rollout

1. Land interfaces + adapters for namespaces that map cleanly to today's supervisor (`runtime`, `diagnostics.logs`, `deployments.activate`/`status`/`unpublish`, `tasks.runCommandSync`). Call sites unchanged.
2. Parallel: supervisor grows endpoints for the new namespaces (`files`, `artifacts`, `imports`, `version-control`, `config`, async `tasks`, `diagnostics.errors`/`runtime-summary`, `summary`, `capabilities`). Each ships its adapter as it becomes available.
3. Migrate call sites per namespace, in blast-radius order:
   - `HealthMonitoringService` → `runtime` + `diagnostics`
   - `git-hook-service` → existing setup path (retained as-is until folded into `imports` or `version-control`)
   - `server-management-tool` → `runtime`
   - `view-logs-tool` → `diagnostics.logs`
   - publish routes + publishing skill → `deployments`
   - command-execution callers → `tasks`
   - tools on `FileSystemOperations` → `files`
   - tools/routes on direct `node:fs`/`child_process` → `files` / `tasks`
   - zip/git-import routes → `imports`
   - `GitUtils` callers → `version-control`
   - .env/secret patching → `config`
4. Once callers are migrated: `DevSupervisorClient`, `DevSupervisorClientFactory`, `FileSystemOperations`, and agent-side tarball/git/import orchestration shrink to adapter internals or are deleted.

Each step is independent; nothing in step 1 blocks parallel work elsewhere.

## Auth Assumption

Out of scope for this spec, but the interface boundary commits to a shape that lets the auth spec plug in cleanly:

- **The HTTP adapter receives an already-authenticated HTTP client.** The adapter does not know how tokens are obtained, rotated, or attached — that is the caller (factory) concern.
- **Interfaces carry no credentials.** No `token`, `apiKey`, or `authHeader` parameter appears in any method signature.
- **Reachability probing in the factory** (see "Dropped from the Public Client") must not bake in transport-specific auth: it probes via the same authenticated HTTP client it hands to the adapter, so auth failures surface the same way for the probe and for real calls.

A follow-up auth spec is a **prerequisite** for the remote (TCP-facing) implementation. Local-socket compatibility can ship without one because SO_PEERCRED + the existing JWT plumbing covers it; anything beyond local must not land until the auth model is written down.

## Forward-looking notes

- Remote transport and auth land as separate specs; `WorkspaceClient`'s HTTP shape is the seam.
- Streaming (log tail, task output, ranged file reads) is not in v1. Add when a concrete caller needs it.
- Full `appId` → `workspaceId` rename across the codebase is a separate sweep.
- `/workspace/summary` and `/workspace/capabilities` are designed to be the first calls an MCP-style client makes. Keep them cheap.

## Open questions

- Artifact retention policy (supervisor-side; not a client concern but needs a number before deployments cross variants reliably).
- Whether `/workspace/imports` needs a streaming progress endpoint or whether phased polling is enough.
- Whether `config.secrets` should support value inspection for non-agent callers (admin UI) — likely yes, via a separate privileged endpoint not in this interface.
