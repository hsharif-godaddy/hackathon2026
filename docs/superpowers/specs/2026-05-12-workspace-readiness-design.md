# Workspace Readiness

**Status:** Draft
**Date:** 2026-05-12
**Scope:** Define a single server-pushed readiness signal for a workspace (container bootstrap → setup → managed process → healthy), replacing client-side polling of `/setup/status` and fixing the ~20s blank-iframe hang on the develop page. Extends the `/workspace/*` surface from [2026-05-08 agent ↔ supervisor interfaces](2026-05-08-agent-supervisor-interfaces-design.md) (PR [#3528](https://github.com/gdcorp-partners/airo-app-builder/pull/3528)).

**Issue:** [AIROBUILD-1623](https://godaddy-corp.atlassian.net/browse/AIROBUILD-1623) — develop page shows ~22s blank iframe on warm/cold hibernation restore.

## Problem

After a Nomad reschedule the container starts with ephemeral disk wiped. `nomad_setup.sh` (git restore + `npm install`) is deferred until the first HTTP request to the preview proxy. The browser's `<iframe src>` request is that first HTTP request, so it sits inside `dev-supervisor` for ~20s and eventually 200s. While that's happening the UI has already reached its `ready` state — chat, file tree, and terminal interact with a workspace that isn't restored yet.

Three independent consumers care about the same state:

1. **Browser UI** — when to mount the iframe, file tree, etc.
2. **Agents service `git-hook-service`** (`agents/src/services/git-hook-service.ts:135`) — gates git ops on setup completion.
3. **Agent tools/runtime** — any "run this command" or "serve this URL" intent the agent expresses depends on the workspace being alive.

Today each consumer reaches for supervisor state independently (where it does at all), via polling, and uses `setup_executed === true` as the readiness signal — which is **wrong**: it means the setup script finished, not that the dev server is serving. Vite/Next takes more time after `npm install`. The iframe can still race.

A UI-only fix (the 2026-03-27 design that briefly existed at commit `c116cf52a`) addresses the spinner but not the blocked HTTP request, the duplicated polling, or the "what does ready mean" question. This spec proposes the layer below.

## Goal

One authoritative, server-pushed readiness signal for a workspace, consumed identically by the agent (via `WorkspaceClient.runtime.watch()`) and by the browser (via a new WebSocket message fanned out from the agents service).

## Scope

- **In:** Extension to `/workspace/runtime` — fold supervisor-side setup into `runtime.state`; add a `/workspace/runtime/events` SSE endpoint; extend `RuntimeClient` with a `watch()` stream. Agents-side `WorkspaceStatusService` that subscribes once per workspace and fans out to WebSocket clients. A `workspace-status` message in the agents↔browser WebSocket protocol. UI state-machine gate on the new signal. Deprecation of the standalone `/setup/status` and `/setup/execute` endpoints in the agent-facing surface.
- **Out:** Remote transport and auth for `WorkspaceClient` (out of scope in [2026-05-08](2026-05-08-agent-supervisor-interfaces-design.md); this spec does not revisit).
- **Out:** Per-phase progress UX (install progress bars, build percentage). The `state` enum is extensible; specific progress surfaces can follow.
- **Out:** Variants other than `preview`. Publish variant's runtime is covered by `deployments.activate`; the readiness pattern here applies only if/when publish grows a long-running managed process.

## Non-goals

- Changing _when_ setup is triggered. `runtime.start()` already exists in the 2026-05-08 spec and will subsume "execute deferred setup then start the managed process."
- Exposing raw `setup_*` fields on the agent surface. They become an internal implementation detail of the supervisor's runtime lifecycle.

## Design

### Transport topology

| Hop                                         | Transport                                              | Why                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| supervisor → agents                         | **SSE** (`GET /workspace/runtime/events`)              | One-way stream, stateless, no Go WebSocket server, aligns with the existing HTTP+JWT auth model on the supervisor.                                                                     |
| agents → browser                            | **WebSocket** (existing Socket.IO session)             | Already authenticated, already multiplexes agent events; one additional message type.                                                                                                  |
| agent code (in agents service) → supervisor | `WorkspaceClient.runtime.watch()` → SSE under the hood | Transport-agnostic interface per [2026-05-08](2026-05-08-agent-supervisor-interfaces-design.md); a future non-HTTP transport implements `watch()` against its native stream primitive. |

The browser never talks to the supervisor directly. This matches the existing split (browser ↔ agents WebSocket ↔ supervisor HTTP).

### Runtime state model

Extend the existing `ProcessState` + `health.status` split from [2026-05-08 §`runtime.ts`](../plans/2026-05-08-workspace-client-foundation.md) rather than collapsing them. `ProcessState` gains two new values that express the supervisor-side bootstrap; `health.status` is unchanged.

```
ProcessState (existing) ∪ new:
  'stopped' | 'starting' | 'running' | 'stopping' | 'error'   // existing
  'setup-running'                                              // NEW — nomad_setup.sh executing (git restore, npm install)
  'setup-failed'                                               // NEW — terminal pre-start failure; requires retry

health.status (unchanged): 'healthy' | 'unhealthy' | 'starting' | 'disabled'
```

**Derived readiness** (the signal the UI and `git-hook-service` actually care about):

```
ready === (state === 'running' && health.status === 'healthy')
```

Consumers derive it from `RuntimeStatus` rather than the spec defining a new "ready" state. This keeps Phase 1's split typing intact and avoids double-accounting between `state` and `health`.

`RuntimeStatus` gains an optional `setup` block for observability during the transitory bootstrap, absent once past `setup-running`:

```ts
interface RuntimeStatus extends ProcessSnapshot {
  setup?: {
    configured: boolean;
    deferred: boolean;
    executed: boolean;
    running: boolean;
    error?: string;
  };
  health: { ... };     // unchanged
  restarts: { ... };   // unchanged
}
```

Transitions are monotone within a lifecycle (one terminal failure mode, one steady-state success mode). The supervisor is the authority; events describe state transitions, not tick counters.

### Stream shape — transport-agnostic

The on-wire transport for `runtime.watch()` is an implementation detail of the HTTP adapter. Two paths:

1. **Phase 1 (ships with this plan):** The HTTP adapter polls existing supervisor endpoints (`/process/status`, `/health-config/status`, `/setup/status`), composes `RuntimeStatus`, and yields a `RuntimeEvent` when any material field changes. Poll interval is 1s while transitory (`state ∈ {'setup-running', 'starting'} || health.status === 'starting'`), 5s while steady. No Go changes on the supervisor.
2. **Phase 2 (future, optional):** Native SSE at `GET /workspace/runtime/events`. The HTTP adapter swaps its implementation; all callers (and the wire contract below) are unchanged.

The adapter hides the transport; consumers always see:

```ts
for await (const evt of runtime.watch(abort.signal)) { ... }
```

If/when the SSE endpoint lands, its frame shape is:

```
event: runtime.state
data:  { state, setup?, health?, pid?, at }

event: runtime.error
data:  { state: 'setup-failed' | 'unhealthy', message, at }

# heartbeat every 15s, comment line per SSE convention
```

Invariants (apply to both transports):

- The first event emitted by `watch()` is always a snapshot of current state, not a replay.
- Subsequent events fire on state change or material health change (not on each probe).
- `watch()` exits when `signal.aborted`, not on transport errors — transient failures are absorbed and retried internally.
- Timestamps on the wire are ISO-8601 strings; hydrated to `Date` at the adapter boundary (per [2026-05-08 convention](2026-05-08-agent-supervisor-interfaces-design.md)).

### `WorkspaceClient.runtime.watch()`

Extending the interface sketch in [2026-05-08 §`/workspace/runtime`](2026-05-08-agent-supervisor-interfaces-design.md):

```ts
interface RuntimeClient {
  status(): Promise<RuntimeStatus>;
  start(): Promise<StartResult>;
  stop(opts?: {
    signal?: string;
    timeoutSeconds?: number;
  }): Promise<StopResult>;
  restart(opts?: { graceful?: boolean }): Promise<RestartResult>;
  check(): Promise<HealthResult>;
  watch(signal: AbortSignal): AsyncIterable<RuntimeEvent>; // NEW
}

type RuntimeEvent =
  | {
      kind: "state";
      state: RuntimeState;
      setup?: SetupInfo;
      health?: HealthInfo;
      at: Date;
    }
  | {
      kind: "error";
      state: "setup-failed" | "unhealthy";
      message: string;
      at: Date;
    };
```

HTTP adapter: opens SSE against `/workspace/runtime/events`, yields one event per SSE frame, closes on `signal.abort()`.

The same streaming convention (`watch(signal)` returning `AsyncIterable`) answers the open question at [2026-05-08 line 546](2026-05-08-agent-supervisor-interfaces-design.md) about streaming imports. Subsequent specs can add `tasks.watch(taskId)` and `imports.watch(importId)` without revisiting this contract.

### Agents-side: `WorkspaceStatusService`

One instance per `workspaceId` inside the agents service.

Responsibilities:

1. On first interest (WebSocket client authenticates, or `git-hook-service` asks), call `runtime.watch()` once and cache the stream.
2. If the first emitted state is `initializing` or `stopped` and setup is deferred, call `runtime.start()` eagerly. (Forcing function — the supervisor's setup today only fires on first HTTP proxy hit.)
3. Maintain the latest `RuntimeEvent` in memory.
4. Fan out state changes to:
   - All subscribed WebSocket clients (as `workspace-status` messages).
   - An internal `EventEmitter` consumed by `git-hook-service` (replaces its current direct `getSetupStatus()` poll).
5. On SSE disconnect, retry with backoff; surface a `stale: true` flag on cached state after 30s of disconnection so consumers can choose to degrade.

Replaces two current call sites:

- `agents/src/services/git-hook-service.ts:135` — `devSupervisor.getSetupStatus()` → `workspaceStatusService.awaitReady(workspaceId)`.
- `agents/src/services/git-hook-service.ts:147` — `devSupervisor.executeSetup()` → implicit, driven by `WorkspaceStatusService` on first subscribe.

### Agents ↔ browser WebSocket protocol

New server→client message:

```ts
type WorkspaceStatusMessage = {
  type: "workspace-status";
  workspaceId: string;
  state: RuntimeState;
  setup?: SetupInfo;
  health?: HealthInfo;
  error?: string;
  at: string; // ISO
};
```

Semantics:

- Sent once on authentication (current snapshot).
- Sent on each state change delivered by `WorkspaceStatusService`.
- Carries enough information that the UI does not need to call back to get details.

No new BFF REST route. No new browser polling loop.

### UI state machine

`app/src/app/[market]/develop/hooks/initializationMachine.ts` — add `waitingForWorkspace` between `initializingPage` and `loadingHistory`:

```
initializingPage
  ↓ PAGE_DATA_LOADED
waitingForWorkspace
  ├─ WORKSPACE_HEALTHY     → loadingHistory
  ├─ WORKSPACE_FAILED      → error (retry dispatches runtime.start via agents)
  └─ WORKSPACE_TIMEOUT     → error (safety net, 120s)
```

The `WORKSPACE_*` events are dispatched by the existing WebSocket handler on receipt of `workspace-status`. No polling effect in `useInitialization.ts`.

`PreviewPane` binds its `<iframe src>` to `state.matches('ready')` so no HTTP request is issued to the preview proxy before the managed process is actually serving. This is the change that removes the 20s iframe hang — not the spinner copy.

Loading copy is phase-aware:

| `state`                          | Copy                                |
| -------------------------------- | ----------------------------------- |
| `initializing` / `setup-running` | "Restoring your workspace…"         |
| `starting`                       | "Starting dev server…"              |
| `unhealthy`                      | "Preview is unreachable, retrying…" |
| `setup-failed`                   | "Setup failed: \<message\>" + Retry |

## Migration plan

Detailed task breakdown in [docs/superpowers/plans/2026-05-12-workspace-readiness-implementation.md](../plans/2026-05-12-workspace-readiness-implementation.md). Summary:

1. **WorkspaceClient interface.** Extend `runtime.ts` with two new `ProcessState` values, `setup?` on `RuntimeStatus`, `RuntimeEvent`, `WorkspaceRuntime.watch()`.
2. **HTTP adapter.** `HttpRuntime.status()` composes `/setup/status` into the state. `HttpRuntime.watch()` polls composed status and yields a discriminated-union event stream. No Go changes required in Phase 1.
3. **Agents — `WorkspaceStatusService`.** New service. One instance per workspace. Subscribes once via `runtime.watch()`, caches, fans out to internal `EventEmitter` and to WebSocket clients. Eagerly calls `runtime.start()` when state is `stopped` with deferred setup.
4. **Agents WebSocket.** Emit `workspace-status` on authentication (snapshot) and on each state change.
5. **UI.** Handler for `workspace-status`, new `waitingForWorkspace` state in `initializationMachine`, `PreviewPane` gates iframe on derived readiness.
6. **`git-hook-service` migration.** Drop direct `/setup/*` calls in favour of `WorkspaceStatusService.awaitReady(workspaceId)`.
7. **Deprecation.** After one release, mark `/setup/status` and `/setup/execute` internal to the supervisor (no agent-surface exposure). `WorkspaceMethodKey` does not gain a `setup.*` key.

Phase 2 (out of this plan): native SSE at `/workspace/runtime/events`, adapter swap.

## Failure modes

| Scenario                                                | Behavior                                                                                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supervisor not reachable                                | `WorkspaceStatusService` retries SSE connect with backoff; surfaces `stale: true` after 30s. UI shows "Preview is unreachable, retrying…" but does not transition to error until the 120s safety timeout. |
| Setup script fails                                      | Supervisor emits `{ state: 'setup-failed', error }`. Agents fans out to UI and `git-hook-service`. UI shows retry; retry dispatches `runtime.start()` via agents.                                         |
| Managed process crashes post-ready                      | Supervisor transitions `healthy → unhealthy`. Iframe stays mounted (user already has context); UI shows a banner rather than tearing down.                                                                |
| Local dev with no supervisor (e.g. dev-runner variants) | `WorkspaceStatusService` detects a missing factory entry and synthesizes a `healthy` event so the existing local-dev flow is unchanged.                                                                   |
| Reconnect after setup already ran                       | Snapshot-on-connect yields current state directly; no historical replay needed.                                                                                                                           |

## Open questions

- **Timeout home.** The 120s safety timeout can live in the UI (simple, one place) or in `WorkspaceStatusService` (covers all consumers). Preference: UI, since only the UI wants to fail loudly — agent tool execution should block indefinitely rather than timeout spuriously.
- **Event bus shape.** Should `WorkspaceStatusService`'s internal emitter be promoted to a shared abstraction (e.g. for future `tasks.watch` fanout), or stay local? Suggest: keep local until the second consumer exists.
- **Publish variant.** The publish container has a simpler lifecycle (no long-running dev server). Does `runtime.watch()` make sense there, or is `deployments` events sufficient? Suggest: N/A on publish for now; `capabilities` reports `runtime.watch` as `variant-not-applicable`.
