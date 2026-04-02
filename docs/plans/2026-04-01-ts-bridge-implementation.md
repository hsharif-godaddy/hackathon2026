---
status: active
---

# TS Bridge Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the TypeScript bridge server that exposes existing TS tools over a Unix socket REST API, allowing the Go agent to call legacy tools without rewriting them.

**Reference:** Design doc at `docs/plans/2026-03-06-go-agent-design.md`, Phase 1 plan at `docs/plans/2026-03-06-go-agent-implementation.md` (Task 8).

---

## Background

The Go agent has 5 native tools: `readFile`, `directoryListing`, `grepSearch`, `terminalCommand`, `str_replace_based_edit_tool`. The DevelopAgent needs ~20 more tools that already exist in TypeScript. Rather than rewrite them all, the ts-bridge exposes them over a Unix socket so the Go agent can call them via its existing `toolbridge.BridgeTool` client.

### Protocol (matches existing Go client)

```
Go Agent ──── POST /tools/{name} ────▶ TS Bridge (Unix socket)
         ◀── 200 OK, NDJSON stream
         ◀── {"chunk": "result text here"}

Go Agent ──── GET /tools ────────────▶ TS Bridge
         ◀── 200 OK, JSON array of {name, description, input_schema}
```

### Tools to Bridge (DevelopAgent minus native Go tools)

| Tool                  | Complexity  | Notes                                        |
| --------------------- | ----------- | -------------------------------------------- |
| `todoList`            | Simple      | SQLite read/write                            |
| `setProjectName`      | Simple      | SQLite update                                |
| `colorScheme`         | Simple      | Color generation                             |
| `fontTheme`           | Simple      | Font selection                               |
| `qrCode`              | Simple      | QR generation                                |
| `rebuildPageSelector` | Simple      | Page selection                               |
| `suggestedResponse`   | Simple      | Response generation (stopAfter tool)         |
| `serverRestart`       | Medium      | DevSupervisor socket                         |
| `viewLogs`            | Medium      | DevSupervisor socket, streaming              |
| `publishClient`       | Medium      | Publish service HTTP                         |
| `publishStatus`       | Medium      | Publish service HTTP, streaming              |
| `media`               | Medium-High | Getty/KB external calls                      |
| `websiteScraper`      | Medium-High | External HTTP, screenshots                   |
| `skill`               | High        | Stateful per-conversation skill registration |
| `requestSecrets`      | High        | Secrets flow (stopAfter tool)                |
| `oauthConnect`        | High        | OAuth state machine                          |
| `domainPurchase`      | High        | External purchase flow                       |
| `handoff`             | Special     | Agent handoff (stopAfter tool)               |

**Phase 1 scope:** All tools listed above. The "High" complexity tools still use the same `createTool()` interface — the complexity is in the TS implementation, not the bridge. The bridge just calls `execute(input, context)` uniformly.

---

## Task 1: Package Scaffolding

**Files:**

- Create: `ts-bridge/package.json`
- Create: `ts-bridge/tsconfig.json`
- Modify: `pnpm-workspace.yaml` (add `ts-bridge` to packages list)

**Step 1: Create package.json**

```json
{
  "name": "@airo/ts-bridge",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/server.ts",
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@airo/agents": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

Key decisions:

- `tsx` for running TypeScript directly (no build step needed for dev)
- `@airo/agents` as workspace dependency to import existing tools
- No Express — use Node's built-in `http` module to keep it minimal

**Step 2: Create tsconfig.json**

Extend from root or agents tsconfig. Target ESNext, module NodeNext.

**Step 3: Add to pnpm-workspace.yaml**

Add `"ts-bridge"` to the packages array.

**Step 4: Run `pnpm install` to link workspace dependency**

**Step 5: Verify the workspace resolves — `pnpm --filter @airo/ts-bridge exec -- node -e "console.log('ok')"`**

**Step 6: Commit**

```bash
git add ts-bridge/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(ts-bridge): scaffold package with workspace dependency on @airo/agents"
```

---

## Task 2: Tool Discovery Endpoint

**Files:**

- Create: `ts-bridge/src/server.ts`
- Create: `ts-bridge/src/tool-registry.ts`

**Step 1: Implement tool registry**

```typescript
// ts-bridge/src/tool-registry.ts
// Imports allAILibTools from @airo/agents, filters to DevelopAgent tools,
// excludes native Go tools, and provides:
//   getToolDescriptors(): Array<{name, description, input_schema}>
//   getTool(name): Tool | undefined
```

- Import `allAILibTools` from `@airo/agents` (the central registry at `agents/src/tools/ai-lib-tools/index.ts`)
- Filter to only DevelopAgent tools (hardcoded allowlist matching `agents/src/agents/develop-agent.ts` lines 219-268)
- Exclude the 5 native Go tools: `readFile`, `directoryListing`, `grepSearch`, `terminalCommand`, `str_replace_based_edit_tool`
- Convert Zod schemas to JSON Schema using `zod-to-json-schema` for the descriptor response

**Important:** The AI SDK `Tool` type wraps the Zod schema in `zodSchema()`. To extract JSON schema, use `zod-to-json-schema` on the underlying Zod type, or use the AI SDK's `jsonSchema` helper if it exposes one. Investigate which approach works at implementation time.

**Step 2: Implement minimal HTTP server**

```typescript
// ts-bridge/src/server.ts
// Node http.createServer listening on Unix socket
// Routes:
//   GET  /tools      → JSON array of tool descriptors
//   GET  /health     → {"status":"ok"}
//   POST /tools/:name → (Task 3)
```

- Socket path from `TS_BRIDGE_SOCKET_PATH` env var (default: `/tmp/ts-bridge.sock`)
- Remove stale socket file on startup
- Graceful shutdown: close server on SIGTERM/SIGINT, remove socket file

**Step 3: Test manually**

```bash
TS_BRIDGE_SOCKET_PATH=/tmp/ts-bridge-test.sock pnpm --filter @airo/ts-bridge start &
curl --unix-socket /tmp/ts-bridge-test.sock http://localhost/tools | jq .
curl --unix-socket /tmp/ts-bridge-test.sock http://localhost/health
```

Verify the response matches the shape expected by `toolbridge.DiscoverToolsWithClient` in Go:

```json
[{"name": "todoList", "description": "...", "input_schema": {...}}, ...]
```

**Step 4: Commit**

```bash
git add ts-bridge/src/
git commit -m "feat(ts-bridge): tool discovery endpoint with GET /tools and GET /health"
```

---

## Task 3: Tool Execution Endpoint

**Files:**

- Modify: `ts-bridge/src/server.ts` (add POST route)
- Create: `ts-bridge/src/executor.ts`

**Step 1: Define request/response protocol**

Request body:

```json
{
  "input": { "path": "src/index.ts", "startLine": 1 },
  "context": {
    "appId": "abc-123",
    "sessionId": "sess-1",
    "conversationId": "conv-1",
    "userId": "user-1"
  }
}
```

Response: NDJSON stream (one JSON object per line):

```
{"chunk": "1\t import React from 'react'\n2\t ..."}
```

Or on error:

```
{"error": "File not found: src/index.ts"}
```

**Step 2: Implement executor**

```typescript
// ts-bridge/src/executor.ts
// executeTool(toolName, input, bridgeContext): AsyncGenerator<NdjsonLine>
//
// 1. Look up tool from registry
// 2. Construct AgentContext from bridgeContext
//    - context.metadata.appId = bridgeContext.appId
//    - context.sessionId = bridgeContext.sessionId
//    - etc.
// 3. Call tool.execute(input, context)
// 4. Yield result as {chunk: JSON.stringify(result)}
// 5. On error, yield {error: message}
```

The key insight: `createTool()` tools are called as `execute(input, context)` where context is an `AgentContext`. The bridge constructs this from the request body's `context` field.

**Step 3: Wire into HTTP server**

```typescript
// POST /tools/:name handler
// 1. Parse URL to extract tool name
// 2. Read and parse request body
// 3. Call executeTool()
// 4. Write NDJSON lines to response with content-type: application/x-ndjson
// 5. End response
```

Set response headers:

```
Content-Type: application/x-ndjson
Transfer-Encoding: chunked
```

**Step 4: Handle non-streaming tools (majority)**

Most tools return a single result from `execute()`. Wrap the result:

```typescript
const result = await tool.execute(input, agentContext);
res.write(
  JSON.stringify({
    chunk: typeof result === "string" ? result : JSON.stringify(result),
  }) + "\n",
);
res.end();
```

**Step 5: Handle errors gracefully**

```typescript
try {
  const result = await tool.execute(input, agentContext)
  res.write(JSON.stringify({ chunk: ... }) + '\n')
} catch (err) {
  res.write(JSON.stringify({ error: err.message }) + '\n')
}
res.end()
```

**Step 6: Commit**

```bash
git add ts-bridge/src/
git commit -m "feat(ts-bridge): tool execution endpoint with POST /tools/:name and NDJSON response"
```

---

## Task 4: Update Go Client for Context Passing

**Files:**

- Modify: `go-agent/internal/toolbridge/bridge.go`
- Modify: `go-agent/internal/toolbridge/bridge_test.go`

**Step 1: Update Execute to send context**

The current Go client sends raw `input` as the request body. Update to wrap it:

```go
type bridgeRequest struct {
    Input   json.RawMessage `json:"input"`
    Context *bridgeContext   `json:"context,omitempty"`
}

type bridgeContext struct {
    AppID          string `json:"appId"`
    SessionID      string `json:"sessionId,omitempty"`
    ConversationID string `json:"conversationId,omitempty"`
    UserID         string `json:"userId,omitempty"`
}
```

Extract context from the Go `context.Context` via `tool.ScopeFrom(ctx)`:

```go
func (t *BridgeTool) Execute(ctx context.Context, input json.RawMessage, output tool.OutputStream) error {
    reqBody := bridgeRequest{Input: input}
    if scope, err := tool.ScopeFrom(ctx); err == nil {
        reqBody.Context = &bridgeContext{
            AppID: scope.AppID,
            // SessionID, etc. — may need to extend RequestScope
        }
    }
    // ... marshal reqBody and send
}
```

**Step 2: Extend RequestScope if needed**

Check if `RequestScope` needs `SessionID`, `ConversationID`, `UserID` fields. These are available in the session/transport layer and should be threaded through.

**Step 3: Update tests**

Update the mock HTTP server in `bridge_test.go` to expect the new request envelope format.

**Step 4: Commit**

```bash
git add go-agent/internal/toolbridge/
git commit -m "feat(go-agent): pass request context through ts-bridge protocol"
```

---

## Task 5: Database Initialization in Bridge

**Files:**

- Create: `ts-bridge/src/db.ts`
- Modify: `ts-bridge/src/server.ts`

**Step 1: Initialize the agents SQLite database**

Most TS tools use repositories (`AppRepository`, `MemoryRepository`, etc.) that are initialized at module import time in the agents package. The bridge process needs access to the same database.

Investigate how the agents package initializes its database connection:

- Check `agents/src/database/` for initialization patterns
- The bridge process should use the same `AGENTS_DB_PATH` or equivalent env var
- The bridge must NOT create tables or migrate — it shares the DB with the Go agent

**Step 2: Ensure repository singletons initialize correctly**

When `@airo/agents` tools are imported, repository modules may auto-initialize. Verify:

- The DB file path is configurable via env var
- No conflicting writes (Go agent and TS bridge both access the DB — SQLite WAL mode handles this)
- No startup migrations that could conflict

**Step 3: Test with a real DB**

Create a test SQLite DB, insert a test app record, set the DB path env var, start the bridge, and call a tool that requires DB access (e.g., `todoList`).

**Step 4: Commit**

```bash
git add ts-bridge/src/
git commit -m "feat(ts-bridge): database initialization for shared SQLite access"
```

---

## Task 6: Integration Test — Go Agent ↔ TS Bridge

**Files:**

- Create: `ts-bridge/src/__tests__/integration.test.ts`
- Modify: `go-agent/internal/toolbridge/bridge_test.go` (add integration test tag)

**Step 1: TS-side integration test**

Start the bridge server on a temp Unix socket, call `GET /tools` to discover tools, then `POST /tools/todoList` with a test appId and verify the NDJSON response.

**Step 2: Go-side integration test (build tag: integration)**

If feasible, start the TS bridge as a subprocess from the Go test, then run `DiscoverTools` and `Execute` against it. Use a build tag so it doesn't run in regular `make test`.

**Step 3: Manual end-to-end verification**

Start both the Go agent and TS bridge, connect via WebSocket, send a message that triggers a bridged tool, and verify the tool executes and the response streams back.

**Step 4: Commit**

```bash
git add ts-bridge/src/__tests__/ go-agent/internal/toolbridge/
git commit -m "test(ts-bridge): integration tests for Go agent ↔ TS bridge communication"
```

---

## Task 7: Process Lifecycle — Bridge Startup from Go Agent

**Files:**

- Create: `go-agent/internal/toolbridge/process.go`
- Create: `go-agent/internal/toolbridge/process_test.go`
- Modify: `go-agent/cmd/agent/main.go`

**Step 1: Implement bridge process manager**

```go
// go-agent/internal/toolbridge/process.go
// BridgeProcess manages the lifecycle of the TS bridge subprocess.
//
// Start(): spawns `node ts-bridge/dist/server.js` (or `tsx ts-bridge/src/server.ts`)
//   - Sets TS_BRIDGE_SOCKET_PATH env var
//   - Waits for socket file to appear (with timeout)
//   - Calls GET /health to verify bridge is ready
//
// Stop(): sends SIGTERM, waits for graceful shutdown, then SIGKILL if needed
//
// Healthy(): calls GET /health
```

**Step 2: Wire into main.go**

On startup:

1. Start the TS bridge process
2. Wait for it to be healthy
3. Call `DiscoverTools` to register bridge tools
4. Register bridge tools in the tool registry (lower precedence than native Go tools)

On shutdown:

1. Stop accepting new WebSocket connections
2. Wait for active runs to complete
3. Stop the TS bridge process

**Step 3: Handle bridge crashes**

If the bridge process exits unexpectedly, log an error. Optionally restart it (simple retry with backoff). Bridge tool calls during downtime should return a clear error.

**Step 4: Commit**

```bash
git add go-agent/internal/toolbridge/ go-agent/cmd/agent/
git commit -m "feat(go-agent): TS bridge process lifecycle management"
```

---

## Task 8: Dev Workflow Integration

**Files:**

- Modify: `go-agent/Makefile` (add bridge targets)
- Modify: root `package.json` or `turbo.json` if needed

**Step 1: Add Makefile targets**

```makefile
# Start the TS bridge for local dev
bridge:
	cd ../ts-bridge && pnpm start

# Run Go agent + TS bridge together
dev: bridge-bg build
	./dist/go-agent

bridge-bg:
	cd ../ts-bridge && TS_BRIDGE_SOCKET_PATH=/tmp/ts-bridge.sock pnpm start &
```

**Step 2: Document in go-agent/README.md**

Add a section explaining how to run the Go agent with the TS bridge locally.

**Step 3: Commit**

```bash
git add go-agent/Makefile go-agent/README.md
git commit -m "feat(go-agent): dev workflow for running with TS bridge"
```

---

## Task Summary

| Task | Description                                 | Key Risk                               |
| ---- | ------------------------------------------- | -------------------------------------- |
| 1    | Package scaffolding                         | Workspace resolution with @airo/agents |
| 2    | Tool discovery endpoint (GET /tools)        | Zod → JSON Schema conversion           |
| 3    | Tool execution endpoint (POST /tools/:name) | Context construction for AgentContext  |
| 4    | Update Go client for context passing        | RequestScope threading                 |
| 5    | Database initialization                     | Shared SQLite access patterns          |
| 6    | Integration tests                           | Cross-process test orchestration       |
| 7    | Process lifecycle management                | Bridge startup/health/crash handling   |
| 8    | Dev workflow integration                    | Ergonomic local development            |

### Dependency Graph

```
Task 1 (scaffolding)
  ├──▶ Task 2 (discovery)
  │      └──▶ Task 3 (execution)
  │             ├──▶ Task 5 (database)
  │             └──▶ Task 6 (integration tests)
  ├──▶ Task 4 (Go client update) ──▶ Task 6
  └──▶ Task 7 (process lifecycle) ──▶ Task 8 (dev workflow)
```

Tasks 2 and 4 can be done in parallel. Task 7 can start after Task 1.

### Open Questions to Resolve During Implementation

1. **Schema extraction:** How to get JSON Schema from `zodSchema()`-wrapped tools? May need `zod-to-json-schema` or the AI SDK may expose a helper.
2. **Import side effects:** Importing `allAILibTools` from `@airo/agents` may trigger module-level initialization (DB connections, logger setup). Test this early in Task 2.
3. **SessionID/ConversationID threading:** The Go `RequestScope` currently has AppID, AppRoot, SupervisorAddr. May need to extend it for the bridge context.
4. **Build vs tsx:** For production, should the bridge be built with `tsc` first or run directly with `tsx`? `tsx` is simpler for dev; built JS is better for production Docker images.
