# Graceful Shutdown Git Commit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On SIGTERM (Nomad deploy), abort active LLM streams so file writes stop, then commit all uncommitted changes and squash-merge feature branches to main before the process exits.

**Architecture:** The existing `shutdown()` in `app.ts` calls `wsServer.close()` which aborts all streams via `stateManager.abortAll()`. We insert an async git commit step after stream abort but before `process.exit()`. The `gitHookService` singleton already tracks active feature branches per app and has `handleConnectionEnd()` which commits + squash-merges. We export it and call it from shutdown.

**Tech Stack:** Node.js, git (via GitUtils/DevSupervisorClient), Socket.IO

---

### Task 1: Export gitHookService from ai-lib-websocket-server

**Files:**

- Modify: `agents/src/server/ai-lib-websocket-server.ts`

**Step 1: Add export for gitHookService**

The `gitHookService` is currently a module-level `const` (line 139). Add a getter function export so `app.ts` can access it without exposing the instance directly.

Add after the existing `getWebSocketServerInfo` export (around line 2283):

```typescript
/**
 * Get the GitHookService instance for shutdown git operations
 */
export function getGitHookService() {
  return gitHookService;
}
```

**Step 2: Commit**

```bash
git add agents/src/server/ai-lib-websocket-server.ts
git commit -m "refactor: export gitHookService getter for shutdown access"
```

---

### Task 2: Add git commit step to graceful shutdown

**Files:**

- Modify: `agents/src/server/app.ts`

**Step 1: Add import**

Add `getGitHookService` to the existing import from `./ai-lib-websocket-server.js` (line 179):

```typescript
import {
  setupAILibWebSocketServer,
  getWebSocketServerInfo,
  getGitHookService,
} from "./ai-lib-websocket-server.js";
```

**Step 2: Add git commit after wsServer.close() and before server.close()**

The key ordering is:

1. `wsServer.close()` — calls `stateManager.abortAll()`, which aborts all LLM streams (stops tool execution and file writes)
2. **NEW: git commit all active branches** — safe because streams are aborted, no more writes
3. `server.close()` — close HTTP server
4. `process.exit()`

In the `shutdown()` function, after the `wsServer.close()` block (after the `finally { wsServer = null; }` on line 634) and before the `SERVER_CLOSE_TIMEOUT_MS` block, add:

```typescript
// Git: commit and squash-merge all active feature branches before exit
// Streams are already aborted by wsServer.close(), so no more file writes
try {
  const gitHookService = getGitHookService();
  const activeAppIds = gitHookService.getActiveAppIds();

  if (activeAppIds.length > 0) {
    logger.info("server.shutdown.git.begin", {
      service: serviceName,
      activeApps: activeAppIds.length,
    });

    const results = await Promise.allSettled(
      activeAppIds.map((appId) =>
        gitHookService.handleConnectionEnd(appId, "disconnection"),
      ),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    logger.info("server.shutdown.git.complete", {
      service: serviceName,
      succeeded,
      failed,
    });
  }
} catch (error) {
  logger.warn("server.shutdown.git.error", {
    service: serviceName,
    error: error instanceof Error ? error.message : String(error),
  });
}
```

Using `Promise.allSettled` so one app's git failure doesn't block others.

**Step 3: Commit**

```bash
git add agents/src/server/app.ts
git commit -m "feat: commit active git branches on graceful shutdown"
```

---

### Task 3: Verify typecheck and existing tests pass

**Step 1: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: clean pass

**Step 2: Run git-related tests**

Run: `pnpm --filter @airo/agents test:unit "git.test"`
Expected: 29/29 pass

**Step 3: Run MediaManifest tests**

Run: `pnpm --filter @airo/agents test:unit "MediaManifest"`
Expected: 11/11 pass

**Step 4: Commit (if lint-staged made formatting changes)**

```bash
git add -A && git commit -m "chore: lint fixups" || true
```

---

### Task 4: Write unit test for shutdown git commit behavior

**Files:**

- Create: `agents/src/server/__tests__/shutdown-git-commit.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Test the shutdown git commit logic in isolation.
 * We test the core behavior: iterate active apps, call handleConnectionEnd for each,
 * handle failures gracefully.
 */
describe("shutdown git commit behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should call handleConnectionEnd for all active apps", async () => {
    const handleConnectionEnd = vi.fn().mockResolvedValue("abc123");
    const gitHookService = {
      getActiveAppIds: () => ["app1", "app2", "app3"],
      handleConnectionEnd,
    };

    const activeAppIds = gitHookService.getActiveAppIds();
    await Promise.allSettled(
      activeAppIds.map((appId) =>
        gitHookService.handleConnectionEnd(appId, "disconnection"),
      ),
    );

    expect(handleConnectionEnd).toHaveBeenCalledTimes(3);
    expect(handleConnectionEnd).toHaveBeenCalledWith("app1", "disconnection");
    expect(handleConnectionEnd).toHaveBeenCalledWith("app2", "disconnection");
    expect(handleConnectionEnd).toHaveBeenCalledWith("app3", "disconnection");
  });

  it("should continue processing other apps when one fails", async () => {
    const handleConnectionEnd = vi
      .fn()
      .mockResolvedValueOnce("abc123")
      .mockRejectedValueOnce(new Error("git lock failed"))
      .mockResolvedValueOnce("def456");

    const gitHookService = {
      getActiveAppIds: () => ["app1", "app2", "app3"],
      handleConnectionEnd,
    };

    const activeAppIds = gitHookService.getActiveAppIds();
    const results = await Promise.allSettled(
      activeAppIds.map((appId) =>
        gitHookService.handleConnectionEnd(appId, "disconnection"),
      ),
    );

    expect(handleConnectionEnd).toHaveBeenCalledTimes(3);
    expect(results[0]).toEqual({ status: "fulfilled", value: "abc123" });
    expect(results[1]).toEqual(expect.objectContaining({ status: "rejected" }));
    expect(results[2]).toEqual({ status: "fulfilled", value: "def456" });
  });

  it("should handle empty active apps list", async () => {
    const handleConnectionEnd = vi.fn();
    const gitHookService = {
      getActiveAppIds: () => [],
      handleConnectionEnd,
    };

    const activeAppIds = gitHookService.getActiveAppIds();
    expect(activeAppIds.length).toBe(0);
    expect(handleConnectionEnd).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the test**

Run: `pnpm --filter @airo/agents test:unit "shutdown-git-commit"`
Expected: 3/3 pass

**Step 3: Commit**

```bash
git add agents/src/server/__tests__/shutdown-git-commit.test.ts
git commit -m "test: add shutdown git commit behavior tests"
```

---

## Execution Order Summary

```
SIGTERM received
  → shutdown()
    → wsServer.close()
      → stateManager.abortAll()  ← streams aborted, file writes stop
      → io.close()               ← sockets disconnected
    → NEW: gitHookService commit all active branches  ← safe, no concurrent writes
    → server.close()
    → process.exit()
```

The critical invariant: `abortAll()` fires **before** the git operations, guaranteeing no LLM tool is writing files while we `git add . && git commit`.
