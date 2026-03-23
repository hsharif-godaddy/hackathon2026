# Funnel Gap Logging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 funnel events to fill gaps between homepage prompt submission and first agent response, enabling drop-off analysis in Elasticsearch.

**Architecture:** Client-side events use `shipAnalyticsLog()` (batched to `/api/client-logs`, auto-enriched with `customerId`). Agents-side events use `logger.info()` (JSON to stdout → FluentBit → ES). A per-socket `Map` in the agents WS server carries `isInitialPrompt` and `customerId` from `onMessageStart` to `onMessageComplete`/`onError`.

**Tech Stack:** TypeScript, Socket.IO, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-funnel-gap-logging-design.md`

---

## Chunk 1: Agents-Side Events (initial_prompt.complete / error)

### Task 1: Add per-socket metadata Map and populate in onMessageStart

**Files:**

- Modify: `agents/src/server/ai-lib-websocket-server.ts:1340-1525` (near other Maps like `connectionStartTimes`)

- [ ] **Step 1: Add the Map declaration**

Near the existing `connectionStartTimes` Map (around line 1340), add:

```typescript
// Tracks initial-prompt metadata per socket for funnel events in onMessageComplete/onError
// Populated in onMessageStart, consumed and cleaned up in onMessageComplete/onError/onDisconnection
const initialPromptMetadata = new Map<
  string,
  {
    isInitialPrompt: boolean;
    customerId?: string;
    agentName?: string;
    startTime: number;
  }
>();
```

- [ ] **Step 2: Populate the Map in onMessageStart**

After the existing `isInitialPrompt` logic (line ~1522, right after the `funnel.initial_prompt.processing` log block), add:

```typescript
// Store metadata for funnel events in onMessageComplete/onError
// These callbacks don't receive per-message data from ai-transport
initialPromptMetadata.set(socketId, {
  isInitialPrompt,
  customerId,
  agentName: agentName || undefined,
  startTime: Date.now(),
});
```

Note: `agentName` is available as a parameter in the `onMessageStart` callback (line ~1370). Storing it here makes it available in `onError` where the `result` object is not passed.

- [ ] **Step 3: Clean up in onDisconnection**

In the `onDisconnection` handler (line ~1599), add cleanup alongside the existing `connectionStartTimes.delete(socketId)`:

```typescript
initialPromptMetadata.delete(socketId);
```

- [ ] **Step 4: Verify no test regressions**

Run: `pnpm --filter @airo/agents test:unit "ai-lib-websocket"`
Expected: All existing tests pass (no test file exists for this module, but verify no import-level failures)

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/ai-lib-websocket-server.ts
git commit -m "feat(funnel): add per-socket initialPromptMetadata Map for funnel event propagation"
```

### Task 2: Add funnel.initial_prompt.complete event

**Files:**

- Modify: `agents/src/server/ai-lib-websocket-server.ts:1571-1597` (onMessageComplete callback)

- [ ] **Step 1: Add funnel event in onMessageComplete**

In the `onMessageComplete` handler, after the existing `logger.info('websocket.message.completed', ...)` call (line ~1583), add:

```typescript
// Funnel event: Track completion of initial prompt (first build)
const promptMeta = initialPromptMetadata.get(socketId);
if (promptMeta?.isInitialPrompt && appId) {
  const durationMs = Date.now() - promptMeta.startTime;
  logger.info("funnel.initial_prompt.complete", {
    appId,
    customerId: promptMeta.customerId,
    durationMs,
    // The result object uses `agentName` in ai-transport but the existing handler
    // destructures `result.agentId`. Use whichever is populated, prefer metadata.
    agentName:
      promptMeta.agentName || result.agentName || result.agentId || "unknown",
  });
}
// Always clean up regardless of isInitialPrompt
if (promptMeta) {
  initialPromptMetadata.delete(socketId);
}
```

- [ ] **Step 2: Verify no test regressions**

Run: `pnpm --filter @airo/agents test:unit`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add agents/src/server/ai-lib-websocket-server.ts
git commit -m "feat(funnel): add funnel.initial_prompt.complete event in onMessageComplete"
```

### Task 3: Add funnel.initial_prompt.error event

**Files:**

- Modify: `agents/src/server/ai-lib-websocket-server.ts:1709-1770` (onError callback)

- [ ] **Step 1: Add funnel event in onError**

In the `onError` handler, after the existing error logging (line ~1730, before the git hook block), add:

```typescript
// Funnel event: Track failure of initial prompt
const promptMeta = initialPromptMetadata.get(socketId);
if (promptMeta?.isInitialPrompt && appId) {
  logger.info("funnel.initial_prompt.error", {
    appId,
    customerId: promptMeta.customerId,
    error: error.message,
    agentName: promptMeta.agentName || "unknown",
  });
}
// Always clean up
if (promptMeta) {
  initialPromptMetadata.delete(socketId);
}
```

- [ ] **Step 2: Verify no test regressions**

Run: `pnpm --filter @airo/agents test:unit`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add agents/src/server/ai-lib-websocket-server.ts
git commit -m "feat(funnel): add funnel.initial_prompt.error event in onError"
```

---

## Chunk 2: Client-Side Events — Develop Page

### Task 4: Add funnel.develop_page.loaded event

**Files:**

- Modify: `app/src/app/develop/[id]/page.tsx:254-263` (existing impression useEffect)

**Context:** The develop page already has a `useEffect(() => { ... }, [])` that fires `logImpressionEvent('develop.page.view')` on mount (line 254-263). Add the funnel event in the same effect.

**Important:** `isCreateFlowSession` is a `useState(false)` that gets set to `true` later (line ~787 during auto-send). It is **always `false` at mount time**, so it cannot be used here. Instead, check session storage directly for the initial prompt keys, matching the pattern used by `checkHasInitialPrompt()` in `useInitialization.ts` (handles both jobId and appId key variants).

The `appId` comes from the URL params. `shipAnalyticsLog` is already imported (used at line 244).

- [ ] **Step 1: Add funnel event inside existing mount useEffect**

In the `useEffect(() => { ... }, [])` at line 254, add after the existing `logAiroHQEvent` call:

```typescript
// Funnel event: Track that user reached the develop page
// Check session storage directly because isCreateFlowSession is not yet set at mount time
if (appId) {
  const hasInitialPrompt =
    sessionStorage.getItem(`initial-prompt-pending-${appId}`) !== null;
  shipAnalyticsLog("funnel.develop_page.loaded", {
    appId,
    source: hasInitialPrompt ? "quick-create" : "direct-nav",
  });
}
```

**Note:** For V2 flows, the initial prompt may be keyed by `jobId` rather than `appId`. The initialization machine resolves this and copies it. If by the time the develop page mounts the prompt key has been migrated to the real `appId`, this check works. If not (e.g., the page mounts with the real appId before migration), `source` may incorrectly report `'direct-nav'`. This is acceptable — the event still fires with the correct `appId` for funnel correlation. The `source` field is secondary context.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter website test "develop/\\[id\\]"`
Expected: Existing tests pass (if a test file exists for this page). If no direct test file, run: `pnpm --filter website test "develop"`

- [ ] **Step 3: Commit**

```bash
git add app/src/app/develop/\\[id\\]/page.tsx
git commit -m "feat(funnel): add funnel.develop_page.loaded event on develop page mount"
```

---

## Chunk 3: Client-Side Events — ConnectionManager (token + WebSocket)

### Task 5: Add funnel.ws.token_acquired and funnel.ws.token_failed events

**Files:**

- Modify: `app/src/services/websocket/ConnectionManager.ts:125-165` (defaultFetchAgentToken function)
- Test: `app/src/services/websocket/__tests__/ConnectionManager.test.ts`

**Context:** `defaultFetchAgentToken` is a module-level function (not a class method). It already logs errors internally but returns `null`, discarding error details. The spec recommends emitting funnel events inside this function where error info is available (option b).

`shipAnalyticsLog` needs to be imported at the top of the file.

- [ ] **Step 1: Add import for shipAnalyticsLog**

At the top of `ConnectionManager.ts`, add:

```typescript
import { shipAnalyticsLog } from "@/lib/logging";
```

- [ ] **Step 2: Add funnel events inside defaultFetchAgentToken**

Modify `defaultFetchAgentToken` (lines 125-165):

After `return token` (line 156, success path), add before the return:

```typescript
shipAnalyticsLog("funnel.ws.token_acquired", {
  appId: siteId,
  durationMs: Date.now() - fetchStart,
});
return token;
```

And add a `fetchStart` timestamp at the start of the try block (after line 128):

```typescript
const fetchStart = Date.now();
```

For the `!response.ok` failure path (line 136-145), add before `return null`:

```typescript
shipAnalyticsLog("funnel.ws.token_failed", {
  appId: siteId,
  error: errorText.substring(0, 200),
  status: response.status,
});
return null;
```

For the `!token` path (line 151-153), add before `return null`:

```typescript
shipAnalyticsLog("funnel.ws.token_failed", {
  appId: siteId,
  error: "Token field missing from response",
});
return null;
```

For the catch block (line 157-164), add before `return null`:

```typescript
shipAnalyticsLog("funnel.ws.token_failed", {
  appId: siteId,
  error: error instanceof Error ? error.message : String(error),
});
return null;
```

- [ ] **Step 3: Write tests for the funnel events**

In `app/src/services/websocket/__tests__/ConnectionManager.test.ts`, add a new describe block. The test file already mocks `@/lib/logging` or uses `vi.mock`. Check the existing mock setup and add tests:

```typescript
describe("funnel token events", () => {
  it("emits funnel.ws.token_acquired on successful token fetch", async () => {
    // Setup: mock appFetch to return successful token response
    // Act: call connect() which triggers defaultFetchAgentToken
    // Assert: shipAnalyticsLog called with 'funnel.ws.token_acquired', { appId, durationMs: expect.any(Number) }
  });

  it("emits funnel.ws.token_failed when token fetch returns non-ok response", async () => {
    // Setup: mock appFetch to return 401
    // Act: call connect()
    // Assert: shipAnalyticsLog called with 'funnel.ws.token_failed', { appId, error: expect.any(String), status: 401 }
  });

  it("emits funnel.ws.token_failed when token fetch throws", async () => {
    // Setup: mock appFetch to throw
    // Act: call connect()
    // Assert: shipAnalyticsLog called with 'funnel.ws.token_failed', { appId, error: expect.any(String) }
  });
});
```

**Important:** Read the existing test file first to understand mock patterns, then write tests that match.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter website test "ConnectionManager"`
Expected: All tests pass including new ones

- [ ] **Step 5: Commit**

```bash
git add app/src/services/websocket/ConnectionManager.ts app/src/services/websocket/__tests__/ConnectionManager.test.ts
git commit -m "feat(funnel): add funnel.ws.token_acquired and funnel.ws.token_failed events"
```

### Task 6: Add funnel.ws.connected event

**Files:**

- Modify: `app/src/services/websocket/ConnectionManager.ts:459-491` (onAuthSuccess handler)
- Test: `app/src/services/websocket/__tests__/ConnectionManager.test.ts`

**Context:** `onAuthSuccess` is inside `authenticateSocket()` (private method). It already computes `authMs` and logs `websocket.connection.phases`. The `connectAttemptStart` timestamp is set when `connect()` begins (line 385). Use it for total duration.

- [ ] **Step 1: Add funnel event in onAuthSuccess**

In the `onAuthSuccess` handler (line 459-491), after the `this.callbacks?.onConnectionPhases?.(...)` call (line ~488) and before `this.callbacks?.onAuthenticated?.(...)` (line ~490), add:

```typescript
// Funnel event: WebSocket fully connected and authenticated
shipAnalyticsLog("funnel.ws.connected", {
  appId,
  durationMs: this.connectAttemptStart
    ? Date.now() - this.connectAttemptStart
    : undefined,
});
```

- [ ] **Step 2: Add funnel event for handshake-auth mode**

When `handshakeAuthMode` is true, authentication happens during the handshake and `onAuthSuccess` is called directly from the `onConnect` handler (not through `authenticateSocket`). Search for where `this.callbacks?.onAuthenticated?.({ socket })` is called in the handshake-auth path and add the same funnel event there.

Check the `onConnect` handler in `createAndRegisterSocket` — if it calls `onAuthenticated` directly for `handshakeAuthMode`, add the funnel event before that call too.

- [ ] **Step 3: Write test**

```typescript
it("emits funnel.ws.connected on successful WebSocket authentication", async () => {
  // Setup: mock successful token + socket connect + auth success
  // Act: connect()
  // Assert: shipAnalyticsLog called with 'funnel.ws.connected', { appId, durationMs: expect.any(Number) }
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter website test "ConnectionManager"`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add app/src/services/websocket/ConnectionManager.ts app/src/services/websocket/__tests__/ConnectionManager.test.ts
git commit -m "feat(funnel): add funnel.ws.connected event on WebSocket auth success"
```

### Task 7: Add funnel.ws.connect_failed event

**Files:**

- Modify: `app/src/services/websocket/ConnectionManager.ts` (onAuthError, handleConnectError, token null path)
- Test: `app/src/services/websocket/__tests__/ConnectionManager.test.ts`

**Context:** Connection can fail in multiple places:

1. Token is null → `onConnectionFailed` callback called (line 419)
2. Auth error from server → `onAuthError` handler (line 493)
3. Transport error → `handleConnectError` (line 844)

We need to emit `funnel.ws.connect_failed` for cases that aren't already covered by `funnel.ws.token_failed`.

- [ ] **Step 1: Add funnel event in onAuthError**

In the `onAuthError` handler (line 493-509), after the existing `logger.error('websocket.auth.error', ...)` call, add:

```typescript
shipAnalyticsLog("funnel.ws.connect_failed", {
  appId,
  error: error.message,
  reason: "auth_rejected",
});
```

- [ ] **Step 2: Add funnel event in the token-null connection failure path**

In the `connect()` method, where `!token` triggers `onConnectionFailed` (line 411-421), add before the callback call:

```typescript
shipAnalyticsLog("funnel.ws.connect_failed", {
  appId,
  error: "Failed to acquire authentication token",
  reason: "token_failed",
});
```

- [ ] **Step 3: Add funnel event for transport/reconnect terminal failures**

`handleConnectError` (line 844) does NOT have a retry-exhaustion path — Socket.IO manages retries internally. Terminal transport failures surface via two paths:

1. **`reconnect_failed` socket event** (line ~838 in `createAndRegisterSocket`): Fires when Socket.IO exhausts all reconnection attempts. Find the `onReconnectFailed` handler and add the funnel event there.

2. **`onConnectionFailed` in the handshake-auth fallback** (line ~864 inside `handleConnectError`): Fires when the fallback to handshake-auth also fails. Add the funnel event before the `onConnectionFailed` callback.

For `reconnect_failed`, find the handler in `createAndRegisterSocket` and add:

```typescript
shipAnalyticsLog("funnel.ws.connect_failed", {
  appId,
  error: "Reconnection attempts exhausted",
  reason: "transport_error",
});
```

For the handshake-auth fallback failure in `handleConnectError`, add before the `onConnectionFailed` call:

```typescript
shipAnalyticsLog("funnel.ws.connect_failed", {
  appId,
  error: error.message,
  reason: "transport_error",
});
```

**Important:** Read `handleConnectError` fully before modifying — it has three branches (handshake fallback, token expiry delegation, default passthrough). Only the handshake fallback path and the `reconnect_failed` event are terminal failures.

- [ ] **Step 4: Write tests**

```typescript
describe("funnel connection failure events", () => {
  it("emits funnel.ws.connect_failed with reason auth_rejected on auth error", async () => {
    // Assert: shipAnalyticsLog called with reason: 'auth_rejected'
  });

  it("emits funnel.ws.connect_failed with reason token_failed when token is null", async () => {
    // Assert: shipAnalyticsLog called with reason: 'token_failed'
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter website test "ConnectionManager"`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add app/src/services/websocket/ConnectionManager.ts app/src/services/websocket/__tests__/ConnectionManager.test.ts
git commit -m "feat(funnel): add funnel.ws.connect_failed event for auth/transport failures"
```

---

## Chunk 4: Verification

### Task 8: Typecheck and lint

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Run full test suites**

Run: `pnpm --filter @airo/agents test:unit && pnpm --filter website test "ConnectionManager" && pnpm --filter website test "StreamingMessageList"`
Expected: All pass

- [ ] **Step 4: Fix any issues found and commit**

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git commit -m "fix(funnel): address typecheck/lint/test issues"
```
