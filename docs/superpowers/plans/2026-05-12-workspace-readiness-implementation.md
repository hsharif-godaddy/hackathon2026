# Workspace Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a single server-pushed workspace readiness signal that replaces the `/setup/status` polling pattern and fixes the ~20s blank-iframe hang on the develop page ([AIROBUILD-1623](https://godaddy-corp.atlassian.net/browse/AIROBUILD-1623)). Extends the `WorkspaceClient` surface from [2026-05-08 plan](2026-05-08-workspace-client-foundation.md): adds `ProcessState` bootstrap values, `RuntimeStatus.setup`, `RuntimeEvent`, `WorkspaceRuntime.watch()`, the HTTP adapter for `watch()` (polling-backed), an agents-side `WorkspaceStatusService`, a new `workspace-status` WebSocket message, UI state-machine gating, and `git-hook-service` migration.

**Architecture:** Interface and type changes stay confined to `agents/src/workspace/runtime.ts`. Adapter polling logic is added to `agents/src/workspace/adapters/http-runtime.ts`. `WorkspaceStatusService` is a new singleton-per-workspace under `agents/src/services/`. WebSocket fan-out hooks into existing Socket.IO server plumbing. UI changes are localized to `useDevelopPageStore`, `initializationMachine`, `useInitialization`, and `PreviewPane`.

**Transport decision:** Phase 1 uses adapter-side polling of three existing supervisor endpoints (`/process/status`, `/health-config/status`, `/setup/status`). No Go changes required. The transport-agnostic `watch()` interface means a future Phase 2 can swap to native SSE (`GET /workspace/runtime/events`) without touching any consumer — per the streaming convention the 2026-05-12 spec sets for `tasks.watch` and `imports.watch`.

**Type convention:** Wire timestamps are ISO-8601 strings (per [2026-05-08](../specs/2026-05-08-agent-supervisor-interfaces-design.md) convention); adapter hydrates to `Date`. `RuntimeEvent` is a discriminated union.

**Tech Stack:** TypeScript, Vitest, existing `WorkspaceClient` scaffolding from 2026-05-08 plan, existing `DevSupervisorClient`, existing Socket.IO server in `agents/src/server/websocket/`, XState v5 on the app side.

**Spec:** [docs/superpowers/specs/2026-05-12-workspace-readiness-design.md](../specs/2026-05-12-workspace-readiness-design.md)

**Dependency:** Assumes the 2026-05-08 plan's Phase 1 scaffolding exists (`agents/src/workspace/` with `runtime.ts`, `http-runtime.ts`, typed errors, factory). If landed against pre-Phase-1 main, the prerequisite tasks from that plan are sequenced first.

**Compilation invariant:** Every committed snapshot compiles cleanly. Task ordering introduces type changes before consumers.

**Out of scope (Phase 2 / future):**

- Native SSE endpoint at `GET /workspace/runtime/events` on the supervisor (Go).
- Per-phase progress UX (install %, build %).
- Publish-variant `runtime.watch` (reports `variant-not-applicable`).
- `tasks.watch`, `imports.watch` (same streaming convention; separate plans).

**Live in this plan:**

- `ProcessState` + `'setup-running' | 'setup-failed'`
- `RuntimeStatus.setup?: SetupInfo`
- `RuntimeEvent` discriminated union + `WorkspaceRuntime.watch(signal)`
- `HttpRuntime` polling-backed `watch()` + `/setup/status` composition in `status()`
- `WorkspaceStatusService` singleton
- `workspace-status` WebSocket message + UI handler
- `initializationMachine.waitingForWorkspace` state
- `PreviewPane` iframe gating
- `git-hook-service` migration

---

## File Structure

**Modified:**

- `agents/src/workspace/runtime.ts` — new `ProcessState` values, `SetupInfo`, `RuntimeStatus.setup?`, `RuntimeEvent`, `WorkspaceRuntime.watch()`.
- `agents/src/workspace/adapters/http-runtime.ts` — `status()` composes `/setup/status`; implement `watch()`.
- `agents/src/workspace/adapters/__tests__/http-runtime.test.ts` — new cases for setup fold + `watch()`.
- `agents/src/workspace/summary.ts` — add `'runtime.watch'` to `WorkspaceMethodKey` closed union; PREVIEW/PUBLISH maps updated.
- `agents/src/services/git-hook-service.ts` — migrate off direct `/setup/*` calls.
- `agents/src/server/websocket/...` — emit `workspace-status` on auth + on change.
- `app/src/stores/useDevelopPageStore.ts` — `workspaceStatus` field.
- `app/src/services/websocket/handlers/...` — `workspace-status` handler.
- `app/src/app/[market]/develop/hooks/initializationMachine.ts` — `waitingForWorkspace` state.
- `app/src/app/[market]/develop/hooks/useInitialization.ts` — subscribe effect, timeout guard.
- `app/src/app/[market]/develop/components/preview/PreviewPane.tsx` — gate iframe on derived readiness.

**Created:**

- `agents/src/services/WorkspaceStatusService.ts` — singleton per workspace.
- `agents/src/services/__tests__/WorkspaceStatusService.test.ts`.
- `packages/shared/src/websocket/workspace-status.ts` — shared `WorkspaceStatusMessage` type (both services depend on `@airo/shared/websocket`).

Total: ~10 modified, 3 created, 3 tests added/extended.

---

## Task 1: Extend `ProcessState` + `RuntimeStatus` in `runtime.ts`

**Files:**

- Modify: `agents/src/workspace/runtime.ts`

- [ ] **Step 1: Edit `agents/src/workspace/runtime.ts`**

Extend `ProcessState` with two supervisor-bootstrap values. Add `SetupInfo` and a `setup?` field to `RuntimeStatus`. Keep `health.status` unchanged — derived readiness lives in consumers.

```typescript
export type ProcessState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error"
  | "setup-running" // NEW — nomad_setup.sh executing
  | "setup-failed"; // NEW — terminal pre-start failure; requires retry

/**
 * Supervisor-side bootstrap status. Present while the workspace is in
 * {@link ProcessState} `'setup-running'` or `'setup-failed'`, absent otherwise.
 */
export interface SetupInfo {
  configured: boolean;
  deferred: boolean;
  executed: boolean;
  running: boolean;
  /** Populated only when the setup script has failed. */
  error?: string;
}

export interface RuntimeStatus extends ProcessSnapshot {
  setup?: SetupInfo; // NEW
  health: {
    /* unchanged */
  };
  restarts: {
    /* unchanged */
  };
}
```

Do not modify `ProcessSnapshot` (reused by `DeploymentStatus.process` per 2026-05-08).

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/runtime.ts
git commit -m "feat(workspace): extend ProcessState with setup states, add SetupInfo"
```

---

## Task 2: Add `RuntimeEvent` + `WorkspaceRuntime.watch()`

**Files:**

- Modify: `agents/src/workspace/runtime.ts`

- [ ] **Step 1: Edit `agents/src/workspace/runtime.ts`** — append:

```typescript
/**
 * Discriminated-union event emitted by {@link WorkspaceRuntime.watch}.
 *
 * The first event after `watch()` is called is always a `state` event carrying
 * a snapshot of the current status — there is no separate subscribe/read step.
 * Subsequent events fire on material transitions (state change, health change,
 * setup block appearance/disappearance), not on every poll tick.
 */
export type RuntimeEvent =
  | {
      kind: "state";
      state: ProcessState;
      setup?: SetupInfo;
      health: RuntimeStatus["health"];
      pid?: number;
      at: Date;
    }
  | {
      kind: "error";
      state: "setup-failed" | "error";
      message: string;
      at: Date;
    };

export interface WorkspaceRuntime {
  status(): Promise<RuntimeStatus>;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
  restart(options?: RestartOptions): Promise<void>;
  check(): Promise<RuntimeStatus["health"]>;
  configureHealth(update: HealthConfigUpdate): Promise<void>;

  /**
   * Subscribe to runtime state transitions. Yields a snapshot first, then
   * one event per material transition until `signal` aborts. Transient
   * transport errors are absorbed internally and retried; the iterator
   * never throws on network failure.
   */
  watch(signal: AbortSignal): AsyncIterable<RuntimeEvent>;
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/workspace/runtime.ts
git commit -m "feat(workspace): RuntimeEvent + WorkspaceRuntime.watch()"
```

---

## Task 3: Register `runtime.watch` in the capabilities map

**Files:**

- Modify: `agents/src/workspace/summary.ts`
- Modify: `agents/src/workspace/adapters/http-workspace-client.ts` (if the PREVIEW/PUBLISH method maps live there)

- [ ] **Step 1: Add `'runtime.watch'` to `WorkspaceMethodKey`**

In `summary.ts`, extend the closed union and mark it `live` on preview, `variant-not-applicable` on publish.

```typescript
export type WorkspaceMethodKey =
  | "runtime.status"
  | "runtime.start"
  | "runtime.stop"
  | "runtime.restart"
  | "runtime.check"
  | "runtime.configureHealth"
  | "runtime.watch"; // NEW
// ... rest unchanged
```

- [ ] **Step 2: Update PREVIEW_METHODS / PUBLISH_METHODS**

```typescript
// preview
"runtime.watch": "live",

// publish
"runtime.watch": "variant-not-applicable",
```

Keep the `as const satisfies Partial<Record<WorkspaceMethodKey, MethodAvailability>>` idiom on `COMMON_METHODS` (iteration-2 fix from #3528, plan:2584).

- [ ] **Step 3: Commit**

```bash
git add agents/src/workspace/summary.ts agents/src/workspace/adapters/http-workspace-client.ts
git commit -m "feat(workspace): register runtime.watch in capabilities map"
```

---

## Task 4: `HttpRuntime.status()` composes `/setup/status` — TDD

**Files:**

- Modify: `agents/src/workspace/adapters/http-runtime.ts`
- Modify: `agents/src/workspace/adapters/__tests__/http-runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `http-runtime.test.ts`:

```typescript
describe("status() setup composition", () => {
  it("returns state='setup-running' with setup block when setup is running", async () => {
    const client = mockClient({
      getProcessStatus: { state: "stopped" }, // process not started yet
      getHealthConfigStatus: { status: "disabled" },
      getRestartStats: {
        /* defaults */
      },
      getSetupStatus: {
        setup_configured: true,
        setup_deferred: true,
        setup_executed: false,
        setup_running: true,
      },
    });
    const runtime = new HttpRuntime(client);
    const status = await runtime.status();

    expect(status.state).toBe("setup-running");
    expect(status.setup).toEqual({
      configured: true,
      deferred: true,
      executed: false,
      running: true,
    });
  });

  it("returns state='setup-failed' with error string when setup errored", async () => {
    const client = mockClient({
      getProcessStatus: { state: "stopped" },
      getSetupStatus: {
        setup_configured: true,
        setup_deferred: true,
        setup_executed: false,
        setup_running: false,
        setup_error: "git clone failed: auth denied",
      },
    });
    const status = await new HttpRuntime(client).status();
    expect(status.state).toBe("setup-failed");
    expect(status.setup?.error).toBe("git clone failed: auth denied");
  });

  it("omits setup block once setup_executed is true and process started", async () => {
    const client = mockClient({
      getProcessStatus: { state: "running", pid: 1234 },
      getSetupStatus: {
        setup_configured: true,
        setup_deferred: false,
        setup_executed: true,
        setup_running: false,
      },
    });
    const status = await new HttpRuntime(client).status();
    expect(status.state).toBe("running");
    expect(status.setup).toBeUndefined();
  });

  it("omits setup block when setup is not configured", async () => {
    const client = mockClient({
      getProcessStatus: { state: "running" },
      getSetupStatus: {
        setup_configured: false,
        setup_deferred: false,
        setup_executed: false,
        setup_running: false,
      },
    });
    const status = await new HttpRuntime(client).status();
    expect(status.setup).toBeUndefined();
  });

  it("absorbs /setup/status failure (returns status without setup block)", async () => {
    const client = mockClient({
      getProcessStatus: { state: "running" },
      getSetupStatus: () => {
        throw new Error("supervisor 503");
      },
    });
    const status = await new HttpRuntime(client).status();
    expect(status.state).toBe("running");
    expect(status.setup).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement composition in `http-runtime.ts`**

```typescript
async status(): Promise<RuntimeStatus> {
  const [process, healthCfg, restartStats, setup] = await Promise.all([
    this.client.getProcessStatus(),
    this.client.getHealthConfigStatus(),
    this.client.getRestartStats(),
    this.client.getSetupStatus().catch(() => null),   // absorb transient error
  ]);

  const setupInfo = deriveSetupInfo(setup);
  const state = deriveState(process.state, setupInfo);

  return {
    state,
    pid: process.pid,
    startedAt: process.started_at ? new Date(process.started_at) : undefined,
    exitCode: process.exit_code,
    lastError: process.last_error,
    setup: setupInfo,
    health: toHealthSnapshot(healthCfg),
    restarts: toRestartSnapshot(restartStats),
  };
}

function deriveSetupInfo(raw: SetupStatusWire | null): SetupInfo | undefined {
  if (!raw || !raw.setup_configured) return undefined;
  // Setup executed successfully and not currently running → bootstrap is over.
  if (raw.setup_executed && !raw.setup_running) return undefined;
  return {
    configured: raw.setup_configured,
    deferred: raw.setup_deferred,
    executed: raw.setup_executed,
    running: raw.setup_running,
    error: raw.setup_error ?? undefined,
  };
}

function deriveState(
  processState: ProcessStateWire,
  setup: SetupInfo | undefined,
): ProcessState {
  if (setup?.error) return "setup-failed";
  if (setup?.running) return "setup-running";
  return mapProcessState(processState);   // existing mapper
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-runtime"
```

Expected: PASS (5 new cases; existing cases unaffected).

- [ ] **Step 4: Commit**

```bash
git add agents/src/workspace/adapters/http-runtime.ts \
        agents/src/workspace/adapters/__tests__/http-runtime.test.ts
git commit -m "feat(workspace): HttpRuntime.status composes /setup/status into ProcessState"
```

---

## Task 5: `HttpRuntime.watch()` polling-backed stream — TDD

**Files:**

- Modify: `agents/src/workspace/adapters/http-runtime.ts`
- Modify: `agents/src/workspace/adapters/__tests__/http-runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Use Vitest's `vi.useFakeTimers()` and an AbortController to drive the iterator deterministically. Mock `status()` responses in sequence.

```typescript
describe("watch()", () => {
  it("yields a snapshot as the first event", async () => {
    const runtime = new HttpRuntime(
      mockClient({ getProcessStatus: { state: "running" } }),
    );
    const abort = new AbortController();
    const iter = runtime.watch(abort.signal)[Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.value).toMatchObject({ kind: "state", state: "running" });
    abort.abort();
  });

  it("emits only on material change (no duplicate state events)", async () => {
    const responses = [
      { state: "setup-running" },
      { state: "setup-running" }, // same — suppressed
      { state: "running" },
    ];
    // ... iterate 3 polls, expect 2 events, abort
  });

  it("absorbs transient transport errors without throwing", async () => {
    // status() rejects on poll 2, resolves on poll 3
    // iterator yields {state: X}, skips the error poll, yields on the recovery poll
  });

  it("uses 1s interval while transitory, 5s once steady", async () => {
    // assert vi.advanceTimersByTime cadence while state is 'setup-running' vs 'running'
  });

  it("emits an 'error' event on setup-failed transition", async () => {
    // first state 'setup-running', next state 'setup-failed' with error message
    // expect two events: state -> error (discriminated union kind)
  });

  it("exits cleanly when signal is aborted", async () => {
    const abort = new AbortController();
    const iter = runtime.watch(abort.signal)[Symbol.asyncIterator]();
    await iter.next();
    abort.abort();
    const second = await iter.next();
    expect(second.done).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `watch()` in `http-runtime.ts`**

```typescript
private static readonly TRANSITORY_POLL_MS = 1000;
private static readonly STEADY_POLL_MS = 5000;

async *watch(signal: AbortSignal): AsyncIterable<RuntimeEvent> {
  let last: RuntimeStatus | null = null;

  while (!signal.aborted) {
    let current: RuntimeStatus | null = null;
    try {
      current = await this.status();
    } catch {
      // Transient — skip and retry.
    }

    if (current) {
      if (last === null) {
        // Snapshot.
        yield toStateEvent(current);
      } else if (hasMaterialChange(last, current)) {
        if (current.state === "setup-failed" && current.setup?.error) {
          yield { kind: "error", state: "setup-failed",
                  message: current.setup.error, at: new Date() };
        } else {
          yield toStateEvent(current);
        }
      }
      last = current;
    }

    const delay = isTransitory(current ?? last) ? TRANSITORY_POLL_MS : STEADY_POLL_MS;
    await abortableDelay(delay, signal);
  }
}

function isTransitory(s: RuntimeStatus | null): boolean {
  if (!s) return true;
  if (s.state === "setup-running" || s.state === "starting") return true;
  if (s.health.status === "starting") return true;
  return false;
}

function hasMaterialChange(a: RuntimeStatus, b: RuntimeStatus): boolean {
  return a.state !== b.state
      || a.health.status !== b.health.status
      || (a.setup?.error ?? null) !== (b.setup?.error ?? null);
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
```

No module-level mutable state (per #3528 iter-1 finding); the iterator closes over `last` inside the async generator instance.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @airo/agents test:unit "workspace/adapters/__tests__/http-runtime"
```

Expected: PASS (6 new `watch()` cases).

- [ ] **Step 4: Commit**

```bash
git add agents/src/workspace/adapters/http-runtime.ts \
        agents/src/workspace/adapters/__tests__/http-runtime.test.ts
git commit -m "feat(workspace): HttpRuntime.watch polling-backed AsyncIterable"
```

---

## Task 6: `WorkspaceStatusMessage` shared type

**Files:**

- Create: `packages/shared/src/websocket/workspace-status.ts`
- Modify: `packages/shared/src/websocket/index.ts` (re-export)

- [ ] **Step 1: Create shared type**

```typescript
// packages/shared/src/websocket/workspace-status.ts

/**
 * Server → client message emitted by agents on WebSocket authentication
 * (snapshot) and on each workspace state transition (deltas). Mirror of
 * {@link RuntimeStatus} with wire-safe timestamps.
 *
 * `ready` is derived server-side for convenience; clients may recompute.
 */
export interface WorkspaceStatusMessage {
  type: "workspace-status";
  workspaceId: string;
  state:
    | "stopped"
    | "starting"
    | "running"
    | "stopping"
    | "error"
    | "setup-running"
    | "setup-failed";
  ready: boolean;
  setup?: {
    configured: boolean;
    deferred: boolean;
    executed: boolean;
    running: boolean;
    error?: string;
  };
  health: {
    status: "healthy" | "unhealthy" | "starting" | "disabled";
    message: string;
  };
  pid?: number;
  /** ISO-8601 timestamp of the observation. */
  at: string;
}
```

- [ ] **Step 2: Re-export from `packages/shared/src/websocket/index.ts`**

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/websocket/workspace-status.ts \
        packages/shared/src/websocket/index.ts
git commit -m "feat(shared): WorkspaceStatusMessage type"
```

---

## Task 7: `WorkspaceStatusService` — TDD

**Files:**

- Create: `agents/src/services/WorkspaceStatusService.ts`
- Create: `agents/src/services/__tests__/WorkspaceStatusService.test.ts`

One instance per `workspaceId`, held in a module-level `Map` keyed by workspace. Not a singleton module (per engineering guidelines); the map itself is `const` and entries are immutable once created.

- [ ] **Step 1: Write failing tests**

```typescript
describe("WorkspaceStatusService", () => {
  it("subscribes to runtime.watch on first interest and caches state", async () => {
    const client = fakeWorkspaceClient();
    const service = new WorkspaceStatusService("wk-1", client);
    const snapshot = await service.awaitState();     // first call bootstraps
    expect(snapshot.state).toBe("setup-running");
    expect(client.runtime.watchCallCount).toBe(1);
  });

  it("awaitReady() resolves when state becomes running + health healthy", async () => {
    const client = fakeWorkspaceClient({
      events: [
        { kind: "state", state: "setup-running", health: { status: "starting" } },
        { kind: "state", state: "starting",      health: { status: "starting" } },
        { kind: "state", state: "running",       health: { status: "healthy"  } },
      ],
    });
    const service = new WorkspaceStatusService("wk-1", client);
    await expect(service.awaitReady()).resolves.toMatchObject({ state: "running" });
  });

  it("awaitReady() rejects with WorkspaceSetupFailedError on setup-failed", async () => {
    const client = fakeWorkspaceClient({
      events: [{ kind: "error", state: "setup-failed", message: "git denied" }],
    });
    const service = new WorkspaceStatusService("wk-1", client);
    await expect(service.awaitReady()).rejects.toThrow(/git denied/);
  });

  it("eagerly calls runtime.start() when first event is stopped with deferred setup", async () => {
    const client = fakeWorkspaceClient({
      events: [{ kind: "state", state: "stopped",
                 setup: { configured: true, deferred: true, executed: false, running: false } }],
    });
    new WorkspaceStatusService("wk-1", client);
    await flushPromises();
    expect(client.runtime.startCallCount).toBe(1);
  });

  it("does NOT call runtime.start() when setup already executed", async () => {
    // state 'stopped' but setup.executed=true → already ran, supervisor decides when/if to start
  });

  it("fans out state changes to subscribers", async () => {
    const service = new WorkspaceStatusService("wk-1", fakeWorkspaceClient({ events: [...] }));
    const observed: string[] = [];
    const off = service.subscribe((evt) => observed.push(evt.state));
    await flushEvents();
    expect(observed).toEqual(["setup-running", "running"]);
    off();
  });

  it("surfaces stale=true after 30s of watch disconnect", async () => {
    vi.useFakeTimers();
    const client = fakeWorkspaceClient({ failWatchAfter: 1 });
    const service = new WorkspaceStatusService("wk-1", client);
    await flushEvents();
    vi.advanceTimersByTime(30_000);
    expect(service.currentStatus()?.stale).toBe(true);
  });

  it("aborts the watch on dispose()", async () => {
    const client = fakeWorkspaceClient();
    const service = new WorkspaceStatusService("wk-1", client);
    service.dispose();
    expect(client.runtime.lastAbortSignal?.aborted).toBe(true);
  });

  it("getOrCreate returns the same instance for the same workspaceId", () => {
    const a = WorkspaceStatusService.getOrCreate("wk-1", clientFactory);
    const b = WorkspaceStatusService.getOrCreate("wk-1", clientFactory);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Implement `WorkspaceStatusService.ts`**

```typescript
import { EventEmitter } from "node:events";
import type {
  WorkspaceClient,
  RuntimeEvent,
  RuntimeStatus,
  ProcessState,
  SetupInfo,
} from "../workspace";

export class WorkspaceSetupFailedError extends Error {
  constructor(
    public readonly workspaceId: string,
    message: string,
  ) {
    super(`Workspace ${workspaceId} setup failed: ${message}`);
    this.name = "WorkspaceSetupFailedError";
  }
}

export interface CachedStatus {
  state: ProcessState;
  setup?: SetupInfo;
  health: RuntimeStatus["health"];
  pid?: number;
  at: Date;
  stale: boolean;
}

type Listener = (status: CachedStatus) => void;

export class WorkspaceStatusService {
  private static readonly instances = new Map<string, WorkspaceStatusService>();

  static getOrCreate(
    workspaceId: string,
    clientFactory: () => WorkspaceClient | null,
  ): WorkspaceStatusService | null {
    const existing = this.instances.get(workspaceId);
    if (existing) return existing;
    const client = clientFactory();
    if (!client) return null;
    const created = new WorkspaceStatusService(workspaceId, client);
    this.instances.set(workspaceId, created);
    return created;
  }

  private readonly emitter = new EventEmitter();
  private readonly abort = new AbortController();
  private cached: CachedStatus | null = null;
  private staleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly workspaceId: string,
    private readonly client: WorkspaceClient,
  ) {
    void this.runWatchLoop();
  }

  subscribe(listener: Listener): () => void {
    this.emitter.on("change", listener);
    if (this.cached) listener(this.cached);
    return () => this.emitter.off("change", listener);
  }

  currentStatus(): CachedStatus | null {
    return this.cached;
  }

  async awaitState(): Promise<CachedStatus> {
    if (this.cached) return this.cached;
    return new Promise((resolve) => this.emitter.once("change", resolve));
  }

  async awaitReady(): Promise<CachedStatus> {
    if (isReady(this.cached)) return this.cached!;
    return new Promise((resolve, reject) => {
      const off = this.subscribe((s) => {
        if (s.state === "setup-failed") {
          off();
          reject(
            new WorkspaceSetupFailedError(
              this.workspaceId,
              s.setup?.error ?? "unknown error",
            ),
          );
        } else if (isReady(s)) {
          off();
          resolve(s);
        }
      });
    });
  }

  dispose(): void {
    this.abort.abort();
    WorkspaceStatusService.instances.delete(this.workspaceId);
    if (this.staleTimer) clearTimeout(this.staleTimer);
  }

  private async runWatchLoop(): Promise<void> {
    const backoff = expBackoff(100, 5_000);
    while (!this.abort.signal.aborted) {
      try {
        for await (const evt of this.client.runtime.watch(this.abort.signal)) {
          this.onEvent(evt);
        }
      } catch (err) {
        // runtime.watch contract says it doesn't throw on transient; any throw
        // here is a bug or shutdown.
        if (this.abort.signal.aborted) return;
        logger.warn("workspace-status.watch-unexpected-error", { err });
      }
      this.armStaleTimer();
      const delay = await backoff();
      if (this.abort.signal.aborted) return;
    }
  }

  private onEvent(evt: RuntimeEvent): void {
    const next = toCachedStatus(evt);
    this.cached = next;
    this.clearStaleTimer();

    // Eagerly trigger setup execution the first time we see a stopped state
    // with deferred setup. Idempotent on the supervisor side.
    if (
      next.state === "stopped" &&
      next.setup?.configured &&
      next.setup.deferred &&
      !next.setup.executed
    ) {
      void this.client.runtime
        .start()
        .catch((err) =>
          logger.warn("workspace-status.eager-start-failed", { err }),
        );
    }

    this.emitter.emit("change", next);
  }

  private armStaleTimer(): void {
    this.staleTimer = setTimeout(() => {
      if (!this.cached) return;
      this.cached = { ...this.cached, stale: true };
      this.emitter.emit("change", this.cached);
    }, 30_000);
  }

  private clearStaleTimer(): void {
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
  }
}

function isReady(s: CachedStatus | null): s is CachedStatus {
  return !!s && s.state === "running" && s.health.status === "healthy";
}
```

Note on guidelines compliance:

- `cached`, `staleTimer` are instance-scope `let`-equivalents (class fields) — acceptable per guidelines (tactical local reassignment in a narrow scope).
- No closures over mutable outer bindings (`cached` is read via `this`, not captured).
- `instances` map is `const`; entries are immutable.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @airo/agents test:unit "services/__tests__/WorkspaceStatusService"
```

Expected: PASS (9 cases).

- [ ] **Step 4: Commit**

```bash
git add agents/src/services/WorkspaceStatusService.ts \
        agents/src/services/__tests__/WorkspaceStatusService.test.ts
git commit -m "feat(agents): WorkspaceStatusService — per-workspace readiness cache + fan-out"
```

---

## Task 8: Migrate `git-hook-service` off `/setup/*`

**Files:**

- Modify: `agents/src/services/git-hook-service.ts`
- Modify: `agents/src/services/__tests__/git-hook-service.test.ts`

- [ ] **Step 1: Update tests**

Replace mocks of `devSupervisor.getSetupStatus` / `executeSetup` with mocks of `WorkspaceStatusService.getOrCreate(...).awaitReady()`.

- [ ] **Step 2: Replace the inline polling block**

Old (`git-hook-service.ts:135-164`):

```typescript
const setupStatus = await devSupervisor.getSetupStatus();
// ... branches on setup_executed / setup_running / setup_error ...
devSupervisor.executeSetup().catch(...);
```

New:

```typescript
const status = WorkspaceStatusService.getOrCreate(workspaceId, () =>
  createWorkspaceClient(workspaceId, "preview"),
);
if (!status) {
  // Supervisor unreachable — degrade exactly as before (log and proceed;
  // the subsequent git op will surface the real error).
  return;
}
await status.awaitReady();
```

Remove the now-unused imports of `getSetupStatus` / `executeSetup`.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @airo/agents test:unit "services/__tests__/git-hook-service"
```

- [ ] **Step 4: Commit**

```bash
git add agents/src/services/git-hook-service.ts \
        agents/src/services/__tests__/git-hook-service.test.ts
git commit -m "refactor(git-hook-service): consume WorkspaceStatusService instead of /setup/* polling"
```

---

## Task 9: Emit `workspace-status` over WebSocket

**Files:**

- Modify: `agents/src/server/websocket/index.ts` (or wherever auth handler lives — identify via grep)
- Modify: `agents/src/server/websocket/__tests__/...`

- [ ] **Step 1: Identify auth hook**

```bash
grep -rn "authenticate\|handshake\|socket.on" agents/src/server/websocket | head -20
```

Locate the spot where the server confirms client auth and currently emits any initial state (e.g. connection ack). The `workspace-status` snapshot emission lands there.

- [ ] **Step 2: Write failing tests**

Two cases:

1. On auth, the server calls `WorkspaceStatusService.getOrCreate(workspaceId).awaitState()` and emits one `workspace-status` message.
2. While the client is connected, each change event from `subscribe()` emits one `workspace-status` message.

- [ ] **Step 3: Implement**

```typescript
// in the post-auth handler
const statusService = WorkspaceStatusService.getOrCreate(workspaceId, () =>
  createWorkspaceClient(workspaceId, "preview"),
);
if (statusService) {
  const snapshot = await statusService.awaitState();
  socket.emit("workspace-status", toWireMessage(workspaceId, snapshot));
  const off = statusService.subscribe((s) =>
    socket.emit("workspace-status", toWireMessage(workspaceId, s)),
  );
  socket.on("disconnect", off);
}

function toWireMessage(id: string, s: CachedStatus): WorkspaceStatusMessage {
  return {
    type: "workspace-status",
    workspaceId: id,
    state: s.state,
    ready: s.state === "running" && s.health.status === "healthy",
    setup: s.setup,
    health: { status: s.health.status, message: s.health.message },
    pid: s.pid,
    at: s.at.toISOString(),
  };
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/websocket/...
git commit -m "feat(agents): emit workspace-status on WS auth + on change"
```

---

## Task 10: Browser `workspace-status` handler + store

**Files:**

- Modify: `app/src/stores/useDevelopPageStore.ts`
- Modify: `app/src/services/websocket/handlers/index.ts` (identify exact file via grep)
- Modify: `app/src/services/websocket/handlers/__tests__/...`

- [ ] **Step 1: Extend the store**

Add to `useDevelopPageStore`:

```typescript
interface WorkspaceStatusSlice {
  workspaceStatus: WorkspaceStatusMessage | null;
  setWorkspaceStatus: (s: WorkspaceStatusMessage) => void;
  clearWorkspaceStatus: () => void;
}
```

Import the type from `@airo/shared/websocket`.

- [ ] **Step 2: Add handler**

In the existing WS handler layer (Tier-2 "Data" per app/CLAUDE.md — handlers write to the store directly; do NOT call lifecycle methods):

```typescript
socket.on("workspace-status", (msg: WorkspaceStatusMessage) => {
  useDevelopPageStore.getState().setWorkspaceStatus(msg);
  // Dispatch to initialization machine (lifecycle path — through adapter, NOT direct).
  machineRef.current?.send({
    type: msg.ready
      ? "WORKSPACE_READY"
      : msg.state === "setup-failed"
        ? "WORKSPACE_FAILED"
        : "WORKSPACE_UPDATED",
    message: msg,
  });
});
```

The initialization machine treats `WORKSPACE_UPDATED` as informational (updates context, no transition).

- [ ] **Step 3: Tests**

- Handler writes to store on receipt.
- Handler dispatches `WORKSPACE_READY` when `ready === true`.
- Handler dispatches `WORKSPACE_FAILED` when `state === 'setup-failed'`.

- [ ] **Step 4: Commit**

```bash
git add app/src/stores/useDevelopPageStore.ts \
        app/src/services/websocket/handlers/...
git commit -m "feat(app): workspace-status WebSocket handler + store slice"
```

---

## Task 11: `initializationMachine` — `waitingForWorkspace` state

**Files:**

- Modify: `app/src/app/[market]/develop/hooks/initializationMachine.ts`
- Modify: `app/src/app/[market]/develop/hooks/initializationMachine.test.ts`

- [ ] **Step 1: Add events + context**

```typescript
type InitializationMachineEvent =
  // ... existing
  | { type: "WORKSPACE_READY"; message: WorkspaceStatusMessage }
  | { type: "WORKSPACE_FAILED"; message: WorkspaceStatusMessage }
  | { type: "WORKSPACE_UPDATED"; message: WorkspaceStatusMessage }
  | { type: "WORKSPACE_TIMEOUT" }
  | { type: "RETRY_WORKSPACE" };

interface InitializationMachineContext {
  // ... existing
  workspaceStatus: WorkspaceStatusMessage | null;
  workspaceError: string | null;
  workspaceWaitStartedAt: number | null;
}
```

- [ ] **Step 2: Insert state between `initializingPage` and `loadingHistory`**

```
initializingPage
  ↓ PAGE_DATA_LOADED
waitingForWorkspace
  ├─ WORKSPACE_READY    → loadingHistory
  ├─ WORKSPACE_FAILED   → error (retry sends RETRY_WORKSPACE)
  ├─ WORKSPACE_UPDATED  → waitingForWorkspace (updates context)
  └─ WORKSPACE_TIMEOUT  → error
error
  └─ RETRY_WORKSPACE    → waitingForWorkspace (fresh timer)
```

Add actions to assign/clear the new context fields.

- [ ] **Step 3: Tests**

- Transition `initializingPage → waitingForWorkspace` on `PAGE_DATA_LOADED`.
- `WORKSPACE_READY` → `loadingHistory`.
- `WORKSPACE_FAILED` → `error` with message in context.
- `WORKSPACE_TIMEOUT` → `error`.
- `RETRY_WORKSPACE` from `error` → `waitingForWorkspace` (context reset).
- `WORKSPACE_UPDATED` in `waitingForWorkspace` stays in same state (context updated).

- [ ] **Step 4: Commit**

```bash
git add app/src/app/[market]/develop/hooks/initializationMachine.ts \
        app/src/app/[market]/develop/hooks/initializationMachine.test.ts
git commit -m "feat(app): waitingForWorkspace state in initialization machine"
```

---

## Task 12: `useInitialization` — timeout guard + retry action

**Files:**

- Modify: `app/src/app/[market]/develop/hooks/useInitialization.ts`

- [ ] **Step 1: Add timeout effect**

No polling effect — the WS handler already dispatches `WORKSPACE_READY` / `WORKSPACE_FAILED`. The hook only needs a safety timeout so the user sees a retry if the supervisor never reports ready.

```typescript
useEffect(() => {
  if (!state.matches("waitingForWorkspace")) return;
  const timer = setTimeout(() => send({ type: "WORKSPACE_TIMEOUT" }), 120_000);
  return () => clearTimeout(timer);
}, [state, send]);
```

- [ ] **Step 2: Retry wiring**

`RETRY_WORKSPACE` event on retry button → machine transitions to `waitingForWorkspace`. The backend-side `WorkspaceStatusService` will re-emit its cached state (which may already be `setup-failed`); retry additionally calls `appService.retryWorkspaceStart(appId)` (new method, one-liner that POSTs to an agents endpoint wrapping `runtime.start()`).

- [ ] **Step 3: Tests** (render hook, assert timeout dispatch, assert retry path)

- [ ] **Step 4: Commit**

```bash
git add app/src/app/[market]/develop/hooks/useInitialization.ts
git commit -m "feat(app): workspace wait timeout + retry wiring in useInitialization"
```

---

## Task 13: `PreviewPane` — gate iframe on ready

**Files:**

- Modify: `app/src/app/[market]/develop/components/preview/PreviewPane.tsx`
- Modify: corresponding test file

- [ ] **Step 1: Add readiness read**

```typescript
const { workspaceStatus } = useDevelopPageStore();
const isReady = workspaceStatus?.ready === true;
```

Gate the `<iframe>` mount on `isReady`. While `!isReady`, render a phase-aware loader:

```tsx
if (!isReady) {
  return <WorkspaceLoader status={workspaceStatus} onRetry={handleRetry} />;
}
return <iframe src={previewUrl} ... />;
```

- [ ] **Step 2: `WorkspaceLoader` component**

Phase → copy map:

```typescript
const COPY: Record<WorkspaceStatusMessage["state"], string> = {
  "setup-running": "Restoring your workspace…",
  "setup-failed": "Setup failed",
  stopped: "Starting dev server…",
  starting: "Starting dev server…",
  running: "Waiting for preview to respond…", // running but health not yet healthy
  stopping: "Restarting dev server…",
  error: "Preview crashed — retrying…",
};
```

Setup-failed variant shows `status.setup?.error` and a Retry button; all others show a spinner.

- [ ] **Step 3: E2E test check**

This touches `PreviewPane`. Per project CLAUDE.md:

```bash
grep -rn "PreviewPane\|preview-iframe\|data-testid.*preview" tests/e2e tests/regression
```

Update any E2E specs that assumed the iframe was in the DOM immediately after navigation — they now need to wait for `WORKSPACE_READY` / `workspace-status.ready === true`.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/PreviewPane.tsx \
        app/src/app/[market]/develop/components/preview/PreviewPane.test.tsx \
        tests/e2e/... tests/regression/...
git commit -m "feat(app): PreviewPane gates iframe on workspace readiness"
```

---

## Task 14: Deprecate `/setup/status` + `/setup/execute` on the agent surface

**Files:**

- Modify: `agents/src/services/DevSupervisorClient.ts` — mark `getSetupStatus` / `executeSetup` `@deprecated`.
- Modify: `agents/CLAUDE.md` — note the new pattern (use `WorkspaceStatusService` or `WorkspaceClient.runtime`).

Do **not** delete the methods or the supervisor endpoints. Deletion is a separate follow-up once one release has elapsed and no callers remain.

- [ ] **Step 1: JSDoc deprecation**

```typescript
/** @deprecated Use `WorkspaceClient.runtime.status()` or `WorkspaceStatusService.awaitState()`.
 *  Remove after 2026-06. */
async getSetupStatus(): Promise<SetupStatus> { ... }

/** @deprecated Use `WorkspaceClient.runtime.start()`.
 *  Remove after 2026-06. */
async executeSetup(): Promise<SetupExecuteResponse> { ... }
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/services/DevSupervisorClient.ts agents/CLAUDE.md
git commit -m "chore(agents): deprecate /setup/* methods — use WorkspaceClient.runtime"
```

---

## Task 15: Final sweep — typecheck, lint, build, tests

- [ ] **Step 1: Full workspace tests**

```bash
pnpm --filter @airo/agents test:unit
pnpm --filter website test
pnpm --filter @airo/shared test
```

- [ ] **Step 2: Typecheck + lint + build (Turborepo)**

```bash
pnpm typecheck
pnpm lint
pnpm build
```

- [ ] **Step 3: Manual smoke (local dev)**

```bash
pnpm run dev
```

- Create or open a dev app.
- Observe `workspace-status` message stream in browser devtools (filter Socket.IO frames).
- Iframe should mount only once `ready === true`.
- Stop the preview container mid-session; observe graceful `running → error → running` transitions in the loader copy.

- [ ] **Step 4: Grafana / Loki check on staging**

After merge + staging deploy, confirm `workspace-status.*` events appear in agents logs and that `setup-gating.*` / `git-hook-service.setup-*` log domains no longer fire (evidence the migration is complete).

- [ ] **Step 5: Commit any final test / lint fixes**

```bash
git add -A
git commit -m "chore(workspace-readiness): final lint/test/build sweep"
```

---

## Done

When all tasks pass:

- `PreviewPane` no longer issues the preview HTTP request before the dev server is serving — the 20s iframe hang is eliminated at the transport layer.
- `git-hook-service` consumes a shared, cached readiness signal instead of duplicate-polling the supervisor.
- The `workspace-status` WebSocket message becomes the canonical UI signal, extensible to future phases (install progress, build progress) without protocol churn.
- `WorkspaceClient.runtime.watch()` establishes the streaming convention for subsequent `tasks.watch` / `imports.watch` adapters.
- `/setup/status` and `/setup/execute` are marked deprecated on the agent-side client; supervisor endpoints remain internal.

Follow-up plans:

- **Phase 2 — native SSE.** `GET /workspace/runtime/events` on the supervisor; adapter swaps from polling to stream consumption; no consumer changes.
- **tasks.watch / imports.watch.** Same streaming convention, answering [2026-05-08 line 546](../specs/2026-05-08-agent-supervisor-interfaces-design.md).
- **Removal of `/setup/*` from the supervisor.** Once no callers remain (target: one release after this lands).
