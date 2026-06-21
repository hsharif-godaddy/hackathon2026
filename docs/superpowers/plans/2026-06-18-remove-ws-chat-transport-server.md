# Remove WebSocket Chat Transport — Server Side (AIROBUILD-2632) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the server-side Socket.IO WebSocket chat transport so SSE is the only streaming + out-of-band push path, leaving the SSE server fully intact.

**Architecture:** The WS chat server (`agents/src/server/ai-lib-websocket-server.ts` + `packages/ai-transport/src/experimental-websocket-server.ts` and its WS-only collaborators) runs in parallel with the SSE server. Out-of-band server→client pushes (logo, video, wizard step, OAuth, media caption, debug stats) are **already dual-emitted** to both Socket.IO and SSE at every site except `media.ts` (WS-only) and the WS chat server itself. Since the client WS stack was deleted in AIROBUILD-2631, the Socket.IO server already has **zero connected clients** — every WS emit is a no-op in production today. This plan removes the dead Socket.IO leg from each dual-emit site, restores the one missing SSE leg (media captions), then deletes the WS chat server, its WS-only collaborators in `@airo/ai-transport`, the `socket.io`/`ws` dependencies, and updates docs.

**Tech Stack:** TypeScript, Node, Express, Socket.IO (being removed), pnpm workspace + Turborepo, Vitest.

**Stacked PR:** This branch (`airobuild-2632-delete-server-ws-stack`) is stacked on PR #5168 (AIROBUILD-2631). **MERGE HOLD:** 2632 is the documented point-of-no-return. Do NOT merge until Dan confirms a full SSE bake in prod (was ~93% on 2026-06-17). The PR body must state this hold prominently.

---

## Verified Coupling Map (read before starting)

**WS-only files to DELETE (no surviving importers after Tasks 1–5):**
- `agents/src/server/ai-lib-websocket-server.ts` (3492 lines; exports `setupAILibWebSocketServer`, `getWebSocketServerInfo`, `getSocketIO`, `isAppEligibleForEmit`, `emitToApp`)
- `agents/src/server/debug-stats-emit.ts` (WS-only `maybeEmitDebugTurnStats`)
- `packages/ai-transport/src/experimental-websocket-server.ts`
- `packages/ai-transport/src/subscribers/websocket-subscriber.ts`
- `packages/ai-transport/src/connection-recovery-manager.ts` (WS-only despite the name; only the WS server + each other import it; SSE's only reference is a comment)
- `packages/ai-transport/src/connection-state-manager.ts` (WS-only; same)

**WS-only TEST files to DELETE:**
- `agents/src/server/__tests__/websocket-budget-integration.test.ts`
- `agents/src/server/__tests__/ai-lib-websocket-server.pinned-context.test.ts`
- `packages/ai-transport/src/__tests__/experimental-websocket-server.test.ts`
- `packages/ai-transport/src/__tests__/websocket-message-size-limit.test.ts`
- `packages/ai-transport/src/__tests__/websocket-duplicate-events-bug.test.ts`
- `packages/ai-transport/src/__tests__/evals-socket-diagnostics.test.ts` (imports `WebSocketServer`)
- `packages/ai-transport/src/__tests__/connection-recovery-manager.test.ts`
- `packages/ai-transport/src/__tests__/connection-state-manager.test.ts`
- `packages/ai-transport/src/subscribers/__tests__/websocket-subscriber.test.ts`

**SHARED — MUST PRESERVE:** `interfaces.ts` (defines `MessageProvider`, `ContextProvider`, `ConversationPersistence`, `ConversationPersistenceWithCleanup`, `ConversationMessage`, `PersistenceStreamingEvent`, `ConversationContext`), `conversation-event-channel.ts`, `agent-execution-loop.ts`, `stream-part-processor.ts`, all `subscribers/` except `websocket-subscriber.ts`, `recovery-plan.ts`, `agent-command-parser.ts`, `event-coalescer.ts`, and the entire `agents/src/server/sse/` tree.

**Key fact:** `experimental-websocket-server.ts` re-exports the 7 shared types FROM `./interfaces.js` (lines 4273–4281). `index.ts` currently pulls them through the WS file. On deletion, `index.ts` must re-point those 7 type exports to `./interfaces.js` directly.

**SSE out-of-band API (already exists):** `getSSERegistry()` from `agents/src/server/sse/registry-singleton.js` returns `EventStreamRegistry | null`; methods `sendToApp(appId, type, data)` and `sendEvent(appId, type, data)`, plus `getConversationsByApp(appId)` used with `getEventChannel().publish(convId, event)`.

---

## Task 1: Remove the Socket.IO leg from dual-emit out-of-band sites

**Files (each already has a live SSE leg — keep it, remove only the WS leg):**
- Modify: `agents/src/server/oauth-emit.ts`
- Modify: `agents/src/tools/video-generation-tool.ts`
- Modify: `agents/src/tools/ai-lib-tools/set-wizard-step.ts`
- Modify: `agents/src/server/routes/design-kit.ts`
- Modify: `agents/src/services/logo/LogoGenerationService.ts`

- [ ] **Step 1: oauth-emit.ts** — remove `import { emitToApp } from './ai-lib-websocket-server.js'`, delete the `const wsDelivered = emitToApp(appId, 'oauth:result', payload)` line, keep `getSSERegistry()?.sendToApp(appId, 'oauth_result', data)`, and drop `wsDelivered` from the `oauth-emit.delivered` log. Reword the top comment (lines 7–14) to describe SSE-only delivery.

- [ ] **Step 2: video-generation-tool.ts** — in `emitVideoEvent` (~line 624): remove `import { emitToApp }` (line 21), delete `const wsDelivered = emitToApp(appId, 'message', payload)` and the `video-generation.websocket.emit` log block, keep the `this.sseRegistry.sendEvent(appId, 'video', eventData)` block. Remove now-unused `payload` if it becomes dead. Update the `// WS delivery is scoped...` comment to describe SSE.

- [ ] **Step 3: set-wizard-step.ts** — remove `import { emitToApp }` (line 9) and the entire WS `try { emitToApp(...) } catch {...}` block (~lines 64–71). Keep the SSE block (`getSSERegistry()` + `getEventChannel()` + `publish`). Remove the comment lines that reference Socket.IO.

- [ ] **Step 4: design-kit.ts** — remove `import { emitToApp }` (line 19) and the `try { emitToApp(...) } catch {...}` line (~215). Keep the SSE block. Update the comment.

- [ ] **Step 5: LogoGenerationService.ts** — in `emitLogoEvent` (~line 395): remove `import { emitToApp }` (line 5), delete `const wsDelivered = emitToApp(...)` and the `logo.emit.ws` log, keep `sse.sendToApp(appId, 'logo', eventData)`. Collapse the `if (sse) {...} else if (wsDelivered === 0) {...}` to just the SSE branch (and keep a `logo.emit.no_targets` warn when `getSSERegistry()` is null).

- [ ] **Step 6: typecheck + lint**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint`
Expected: PASS (no unused-import or undefined-symbol errors).

- [ ] **Step 7: targeted tests**

Run: `pnpm --filter @airo/agents test:unit "oauth-emit" "video" "set-wizard-step" "design-kit" "logo"`
Expected: PASS. Fix any test that mocked `emitToApp` (drop the mock; assert the SSE call instead).

- [ ] **Step 8: Commit**

```bash
git add agents/src/server/oauth-emit.ts agents/src/tools/video-generation-tool.ts agents/src/tools/ai-lib-tools/set-wizard-step.ts agents/src/server/routes/design-kit.ts agents/src/services/logo/LogoGenerationService.ts
git commit -m "refactor(chat): drop Socket.IO leg from dual-emit out-of-band pushes (AIROBUILD-2632)"
```

---

## Task 2: Restore SSE delivery for media captions (the one WS-only out-of-band site)

**File:** Modify `agents/src/server/routes/media.ts`

**Context:** `captionAsync` pushes `media_caption` ONLY via `emitToApp` (lines 72 and 95). There is no SSE leg, so post-2631 media captions reach no client. Restore delivery over SSE by mirroring the logo pattern.

- [ ] **Step 1: Verify the client/SSE pipeline accepts `media_caption`.**

Run: `grep -rn "media_caption" app/src agents/src/server/sse`
Decision: if the SSE transport/client already maps `media_caption` (or maps arbitrary `type` values through the event channel as logo does), proceed to Step 2 using `sendToApp`. If `media_caption` is genuinely unhandled client-side, this is out of 2632 scope — leave the call removed, add a `route.media.caption.no_sse_delivery` debug log, and note it in the PR + summary for a follow-up.

- [ ] **Step 2: Replace both WS emits with SSE delivery.** Remove `import { emitToApp } from '../ai-lib-websocket-server.js'` (line 40). Add `import { getSSERegistry } from '../sse/registry-singleton.js'` (match existing import style). Replace each `emitToApp(appId, 'message', { type: 'media_caption', content: '', data: {...} })` with `getSSERegistry()?.sendToApp(appId, 'media_caption', { appId, slotName, caption })`. Update the module-eval comment (lines ~111–115) about not pulling the websocket-server module graph — `registry-singleton.js` has no such coupling, so the dynamic-import workaround for `logoGenerationService` can be reassessed (leave the dynamic import if it still avoids unrelated coupling; only the `emitToApp` rationale is removed).

- [ ] **Step 3: typecheck + lint + tests**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint && pnpm --filter @airo/agents test:unit "media"`
Expected: PASS. Update `media.ts` route tests that asserted `emitToApp`.

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/routes/media.ts agents/src/server/routes/__tests__ 2>/dev/null
git commit -m "fix(media): deliver media_caption over SSE instead of dead Socket.IO leg (AIROBUILD-2632)"
```

---

## Task 3: Delete the WS-only debug-stats emitter

**Files:**
- Delete: `agents/src/server/debug-stats-emit.ts`
- Modify: `agents/src/tools/ai-lib-tools/run-agent.ts`
- Modify: `agents/src/server/routes/video.test.ts` (mocks `getSocketIO`)

**Context:** `maybeEmitDebugTurnStats` delivers only over Socket.IO. `run-agent.ts` (lines 104–110) already dual-emits: `maybeEmitDebugTurnStats(statsInput)` (WS) AND `emitter.emit('debug_turn_stats', computeDebugTurnStats(statsInput))` (SSE). The SSE leg covers sub-agent stats. The only other caller is the WS server (deleted in Task 5).

- [ ] **Step 1:** In `run-agent.ts`, remove `import { maybeEmitDebugTurnStats } from '../../server/debug-stats-emit.js'` (line 8) and the `// WS path` comment + `maybeEmitDebugTurnStats(statsInput)` call (lines ~103–105). Keep the `if (emitter) { ... emitter.emit('debug_turn_stats', payload) }` SSE block.

- [ ] **Step 2:** Delete `agents/src/server/debug-stats-emit.ts`.

- [ ] **Step 3:** In `video.test.ts`, remove the `getSocketIO: vi.fn(...)` mock entry (line ~61) if it referenced the WS server module; adjust the mock of `ai-lib-websocket-server.js` (that module is deleted in Task 5 — if this test mocks it, the mock must be removed or re-pointed). Re-run after Task 5 too.

- [ ] **Step 4: Verify no other importers.**

Run: `grep -rn "maybeEmitDebugTurnStats\|debug-stats-emit" agents/src --include='*.ts'`
Expected: only matches inside the (about-to-be-deleted) WS server, if any.

- [ ] **Step 5: typecheck + lint + test**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint && pnpm --filter @airo/agents test:unit "run-agent"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agents/src/tools/ai-lib-tools/run-agent.ts agents/src/server/routes/video.test.ts
git rm agents/src/server/debug-stats-emit.ts
git commit -m "refactor(chat): delete WS-only debug-stats emitter, keep SSE path (AIROBUILD-2632)"
```

---

## Task 4: Remove WS server wiring from agents app.ts

**File:** Modify `agents/src/server/app.ts`

- [ ] **Step 1: Read the file** around the WS anchors so edits are exact: lines 185–230 (import + `wsServer` decl), 678–710 (Phase-3 init), 750–760 (info strings), 825–855 (shutdown + git-hook await).

- [ ] **Step 2: Remove the import** (line 189): `import { setupAILibWebSocketServer, getWebSocketServerInfo } from './ai-lib-websocket-server.js';`

- [ ] **Step 3: Remove the `wsServer` declaration** (line 226): `let wsServer: Awaited<ReturnType<typeof setupAILibWebSocketServer>>['wsServer'] | null = null;`

- [ ] **Step 4: Remove the Phase-3 WS init block** (lines 681–706): the `server.websocket.init.begin/success` logs, `const websocketSetup = await setupAILibWebSocketServer(server)`, `wsServer = websocketSetup.wsServer`, the `getWebSocketServerInfo()` call + `server.websocket.info` log, and the `server.websocket.connection.info` log. **Keep** the assessment-agent pre-warm and `startPeriodicMemoryLogging()` lines that sit between them — only the WS lines are removed.

- [ ] **Step 5: Remove the shutdown block** (lines 829–846): the entire `if (wsServer) { ... }` block. Update the following comment (lines 848–850) — `wsServer.close()` no longer fires disconnect events, so the git-hook await note must be reworded (SSE finalization is handled elsewhere; keep the `getGitHookService()` await but fix its rationale comment).

- [ ] **Step 6: Update info strings.** Line ~413 `websocketChat: \`${wsScheme}://...\`` and line ~758 `websocket: 'WS /ws/{id} - ...'` describe a WS endpoint that no longer exists — remove these fields from their response/log objects. Fix the stale comments at lines 232 and 278 that reference `ai-lib-websocket-server.ts`.

- [ ] **Step 7: typecheck + lint + build**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint && pnpm --filter @airo/agents build`
Expected: PASS. (`ai-lib-websocket-server.ts` still exists at this point but has no importers; build is green.)

- [ ] **Step 8: Commit**

```bash
git add agents/src/server/app.ts
git commit -m "refactor(chat): stop instantiating the Socket.IO server (AIROBUILD-2632)"
```

---

## Task 5: Delete the agents WS chat server module + tests

**Files:**
- Delete: `agents/src/server/ai-lib-websocket-server.ts`
- Delete: `agents/src/server/__tests__/websocket-budget-integration.test.ts`
- Delete: `agents/src/server/__tests__/ai-lib-websocket-server.pinned-context.test.ts`

- [ ] **Step 1: Confirm zero importers remain.**

Run: `grep -rn "ai-lib-websocket-server" agents/src --include='*.ts' | grep -v '__tests__'`
Expected: NO results (all references removed in Tasks 1–4). If any remain, fix them before deleting.

- [ ] **Step 2: Delete the files.**

```bash
git rm agents/src/server/ai-lib-websocket-server.ts agents/src/server/__tests__/websocket-budget-integration.test.ts agents/src/server/__tests__/ai-lib-websocket-server.pinned-context.test.ts
```

- [ ] **Step 3: typecheck + lint + build + unit tests**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint && pnpm --filter @airo/agents build && pnpm --filter @airo/agents test:unit`
Expected: PASS (excluding the 2 pre-existing Brisbane-TZ-flaky `common.test.ts formatDate` failures noted in project memory).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(chat): delete agents Socket.IO chat server + WS-only tests (AIROBUILD-2632)"
```

---

## Task 6: Collapse ai-transport — re-point shared types, drop WS exports, delete WS source + tests (atomic)

**Files:**
- Modify: `packages/ai-transport/src/index.ts`
- Delete: `packages/ai-transport/src/experimental-websocket-server.ts`
- Delete: `packages/ai-transport/src/subscribers/websocket-subscriber.ts`
- Delete: `packages/ai-transport/src/connection-recovery-manager.ts`
- Delete: `packages/ai-transport/src/connection-state-manager.ts`
- Delete: the 7 WS-only test files listed in the Coupling Map.

**This must be one commit** — `index.ts` exporting from a deleted file (or a deleted file still exported) breaks the build mid-way.

- [ ] **Step 1: Edit `index.ts`.**
  - Remove the `WebSocketServer, createWebSocketServer, createSingleAgentFactory, createSingleAgentWebSocketServer, restoreBudgetMetadata` value-export block (lines ~2–8).
  - Re-point the shared **type** block: change `} from './experimental-websocket-server.js'` (line 19) to `} from './interfaces.js'`, and **drop `WebSocketConfig` and `ChatMessage`** from that block (they are WS-only; the remaining 7 types are defined in `interfaces.ts`).
  - Remove the `WebSocketSubscriber` value export and the `WebSocketMessage, IsDisconnectedFn` type export block.
  - Remove the `ConnectionStateManager` value export + its type block (`ConnectionState, ConnectionStateData, CreateConnectionParams, TransitionParams, ConnectionStateManagerConfig, StateManagerLogger`).
  - Remove the `ConnectionRecoveryManager` value export + its type block (`RecoveryMode, RecoveryContext, ConnectionRecoveryManagerConfig, ConnectionRecoveryManagerDependencies, RecoveryManagerLogger`).
  - **Keep:** `SSESubscriber`, `BaseEventSubscriber`, `PersistenceSubscriber`, `APMSubscriber`, `EventCoalescer`, `computeRecoveryPlan`/`recovery-plan` types, `parseAgentCommand`, and all other shared exports.

- [ ] **Step 2: Delete the WS source files.**

```bash
git rm packages/ai-transport/src/experimental-websocket-server.ts packages/ai-transport/src/subscribers/websocket-subscriber.ts packages/ai-transport/src/connection-recovery-manager.ts packages/ai-transport/src/connection-state-manager.ts
```

- [ ] **Step 3: Delete the WS-only tests.**

```bash
git rm packages/ai-transport/src/__tests__/experimental-websocket-server.test.ts packages/ai-transport/src/__tests__/websocket-message-size-limit.test.ts packages/ai-transport/src/__tests__/websocket-duplicate-events-bug.test.ts packages/ai-transport/src/__tests__/evals-socket-diagnostics.test.ts packages/ai-transport/src/__tests__/connection-recovery-manager.test.ts packages/ai-transport/src/__tests__/connection-state-manager.test.ts packages/ai-transport/src/subscribers/__tests__/websocket-subscriber.test.ts
```

- [ ] **Step 4: Check for stragglers.**

Run: `grep -rn "experimental-websocket-server\|websocket-subscriber\|connection-recovery-manager\|connection-state-manager\|WebSocketServer\|WebSocketSubscriber\|ConnectionRecoveryManager\|ConnectionStateManager" packages/ai-transport/src agents/src --include='*.ts' | grep -v '__tests__'`
Expected: only comment matches (cleaned in Task 7), no live imports. `noop-persistence.ts` has a JSDoc mention of `createWebSocketServer` — that is comment-only (Task 7).

- [ ] **Step 5: build + typecheck + test both packages**

Run: `pnpm --filter @airo/ai-transport build && pnpm --filter @airo/ai-transport typecheck && pnpm --filter @airo/ai-transport test && pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-transport/src/index.ts
git commit -m "refactor(ai-transport): drop WS server, subscriber, and connection managers; SSE-only exports (AIROBUILD-2632)"
```

---

## Task 7: Clean WS references from shared-file comments

**Files (comment-only edits — no logic change):**
- Modify: `packages/ai-transport/src/subscribers/event-coalescer.ts` (lines ~5, ~183 reference `WebSocketMessage`)
- Modify: `packages/ai-transport/src/conversation-event-channel.ts` (line ~404 JSDoc `new WebSocketSubscriber(socket)`)
- Modify: `packages/ai-transport/src/noop-persistence.ts` (line ~17 JSDoc `import { createWebSocketServer }`)

- [ ] **Step 1:** Reword each comment to be transport-neutral / SSE-based. In `conversation-event-channel.ts` change the `channel.subscribe('conv_123', new WebSocketSubscriber(socket))` example to use `SSESubscriber`. In `noop-persistence.ts` change the example import to a surviving export (e.g. `createSSEWriter` or drop the example). In `event-coalescer.ts` reword the `WebSocketMessage`/`StreamingEvent` duck-typing comment to reference only `StreamingEvent` (the coalescer stays generic — do NOT change its types).

- [ ] **Step 2: build + typecheck**

Run: `pnpm --filter @airo/ai-transport build && pnpm --filter @airo/ai-transport typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ai-transport/src/subscribers/event-coalescer.ts packages/ai-transport/src/conversation-event-channel.ts packages/ai-transport/src/noop-persistence.ts
git commit -m "docs(ai-transport): remove WS references from shared-file comments (AIROBUILD-2632)"
```

---

## Task 8: Remove socket.io and ws dependencies

**Files:**
- Modify: `agents/package.json`
- Modify: `packages/ai-transport/package.json`
- Modify: `pnpm-lock.yaml` (regenerated)

- [ ] **Step 1: Confirm `ws` has no remaining direct usage.**

Run: `grep -rn "from 'ws'\|require('ws')\|from \"ws\"" agents/src packages/ai-transport/src --include='*.ts'`
Expected: NO results. If any appear, leave `ws` in that package's deps and note it.

- [ ] **Step 2: Remove `"socket.io": "catalog:"` from both `package.json` files. Remove `"ws": "catalog:"` from both ONLY if Step 1 was clean.** Do not touch the `catalog:` entry in `pnpm-workspace.yaml` (other packages may use these).

Run: `grep -rln "from 'socket.io'\|from \"socket.io\"" agents/src packages/ai-transport/src --include='*.ts'` → expected NO results (confirms socket.io removal is safe).

- [ ] **Step 3: Reinstall to update the lockfile.**

Run (from worktree; the `.direnv/bin/pnpm` wrapper pins WORKSPACE_ROOT — use the real binary): `$REAL_PNPM install` (or `corepack pnpm install` if `$REAL_PNPM` is unset).
Expected: lockfile updates, `socket.io`/`ws` removed from the two packages' resolved deps.

- [ ] **Step 4: build both packages**

Run: `pnpm --filter @airo/agents build && pnpm --filter @airo/ai-transport build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/package.json packages/ai-transport/package.json pnpm-lock.yaml
git commit -m "chore: drop socket.io and ws dependencies (AIROBUILD-2632)"
```

---

## Task 9: Update docs + project memory

**Files:**
- Modify: `agents/CLAUDE.md`
- Modify: `packages/ai-transport/CLAUDE.md`
- Modify: `CLAUDE.md` (root)
- Update memory: `project_ws_transport_removal.md` + `MEMORY.md` pointer

- [ ] **Step 1: `agents/CLAUDE.md`** — header line: "WebSocket streaming" → "SSE streaming". Remove/replace the **WebSocket security** bullet (`src/server/ai-lib-websocket-server.ts`) with the SSE equivalent (JWT validation + per-message appId validation now live on the SSE routes/middleware — point to `src/server/sse/routes.ts` + `middleware/app-ownership.ts`). Rewrite the **Agent Selection Flow** intro (`ai-lib-websocket-server.ts → experimental-websocket-server.ts`) to reference the SSE path (`src/server/sse/MessageExecutionService.ts`). In **ai-lib & Shared Types**, remove the `experimental-websocket-server.ts` / "WebSocket server" bullets. Fix the **conversationId** observability note: `attachConversationId` lived in the deleted WS file — re-point to the SSE path's conversationId population and keep `selectCacheConversationId()` as the canonical helper (verify the SSE path's equivalent population point and cite it).

- [ ] **Step 2: `packages/ai-transport/CLAUDE.md`** — "Transport-agnostic infrastructure shared by the WebSocket and SSE servers" → "infrastructure for the SSE server". Remove the two-adapter (`experimental-websocket-server.ts` + SSE) framing. Remove the `WebSocketSubscriber` table row and the WS entries from any exports table. **Remove the server-side SSE/WS parity rule** (the rule deferred from AIROBUILD-2631) and the reviewer-checklist line about "tool-lifecycle change made in only one transport".

- [ ] **Step 3: root `CLAUDE.md`** — services table: `@airo/ai-transport` note "Transport-agnostic shared code for WS + SSE servers" → "Shared server code for the SSE transport (loop, processor, events)". Scan for any other server-side WS references and update.

- [ ] **Step 4: Update memory** — set `project_ws_transport_removal.md` to record 2632 implemented (prep, merge held pending bake) on this branch, and update the `MEMORY.md` one-line pointer.

- [ ] **Step 5: Commit**

```bash
git add agents/CLAUDE.md packages/ai-transport/CLAUDE.md CLAUDE.md
git commit -m "docs: update server docs for SSE-only transport (AIROBUILD-2632)"
```

---

## Task 10: Final verification + open stacked PR (merge held)

- [ ] **Step 1: Full gates on both packages.**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint && pnpm --filter @airo/agents build && pnpm --filter @airo/agents test:unit && pnpm --filter @airo/ai-transport typecheck && pnpm --filter @airo/ai-transport lint && pnpm --filter @airo/ai-transport build && pnpm --filter @airo/ai-transport test`
Expected: PASS (excluding the 2 known Brisbane-TZ `common.test.ts formatDate` flakes).

- [ ] **Step 2: Confirm no live WS references survive.**

Run: `grep -rn "socket\.io\|Socket\.IO\|experimental-websocket-server\|ai-lib-websocket-server\|WebSocketSubscriber\|createWebSocketServer" agents/src packages/ai-transport/src --include='*.ts' | grep -v '__tests__'`
Expected: zero (or only intentional historical mentions in comments, justified inline).

- [ ] **Step 3: Push + open PR stacked on 2631.**

```bash
git push -u origin airobuild-2632-delete-server-ws-stack
gh pr create --base airobuild-2631-delete-client-ws-stack --title "AIROBUILD-2632: delete the server WebSocket stack (SSE-only)" --body "<summary + MERGE HOLD notice: do not merge until full SSE bake in prod is confirmed>"
```

The PR body MUST: (a) state the merge hold and the bake gate prominently at the top; (b) summarize the de-dual-emit + deletion; (c) flag the media-caption SSE delivery change; (d) note this is stacked on PR #5168.

- [ ] **Step 4:** Manual AC smoke test before any merge (separate from CI): on a real app, confirm out-of-band SSE pushes (logo, video, wizard step, OAuth, media caption) and the chat turn round-trip still work over SSE with the WS server gone.

---

## Self-Review Notes

- **Ordering keeps every commit green:** out-of-band sites (T1–T3) → app.ts stops instantiation (T4) → delete agents WS module once unimported (T5) → delete ai-transport WS once agents no longer imports it (T6).
- **media.ts** is the only behavior change beyond pure deletion (it currently delivers to zero clients; T2 restores SSE delivery). Flagged for the PR and gated on a client-handling check.
- **No trapped shared symbols:** the 7 shared types are defined in `interfaces.ts`; `index.ts` re-point is the only export surgery. `connection-recovery-manager`/`connection-state-manager` are WS-only (SSE references are comments). `emitToApp`/`getSocketIO`/`maybeEmitDebugTurnStats` all have live SSE equivalents.
- **Deferred to nothing** — 2633 (collapse remaining abstractions) is now largely subsumed; any residual two-adapter naming cleanup not reachable here stays in 2633.
