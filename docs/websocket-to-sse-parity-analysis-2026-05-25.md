# WebSocket to SSE Parity Analysis

Date: 2026-05-25

Scope: current code and tests in this checkout after recent SSE parity PRs merged to `main` through #4094. Code and tests are the source of truth; docs are treated as potentially stale.

Goal: identify the remaining user-visible behaviors, operational guarantees, and backend capabilities that SSE must support before WebSocket can be disabled. SSE does not need to copy WebSocket-specific wire mechanics when an SSE-native design gives the same guarantee.

## Status And Impact Taxonomy

Status values:

- `Parity`: SSE and WebSocket already provide the same behavior or guarantee.
- `Partial`: SSE has most of the behavior but has a correctness, operational, or coverage gap.
- `Missing`: SSE lacks a required behavior.
- `SSE-native equivalent`: SSE intentionally differs at the protocol layer but preserves the guarantee.
- `Not needed for SSE replacement`: WebSocket-specific mechanics or inactive behavior that should not block replacement.
- `Unknown`: current code was insufficient to classify confidently.

Impact values:

- `Blocker`: should be fixed or explicitly decided before disabling WebSocket.
- `Required`: should be fixed before broad replacement, but not necessarily a hard architectural blocker.
- `Nice-to-have`: parity polish or operational improvement.
- `Cleanup`: stale, inert, or documentation cleanup.

## Executive Summary

SSE is much closer to functional replacement readiness than the original parity review indicated. Several earlier blockers have landed in recent PRs:

- Runtime extraction from the WebSocket server landed in #4085.
- Client lifecycle, reconnect, trace IDs, and pagination work landed in #4087.
- Recovery buffer capacity, loss surfacing, and event contract work landed in #4088.
- Request/context fields such as `sessionId`, `userTimezone`, and `market` landed in #4089.
- Observability parity, APM transactions, and request correlation landed in #4090.
- No-subscriber abort and app-level fanout observability landed in #4093.
- BMS client gating cleanup and SSE grant recovery predicate alignment landed in #4094.

The remaining work is narrower and should be treated as targeted correctness hardening, not a broad rebuild of the transport.

Current replacement readiness: **not ready to disable WebSocket yet**.

Primary remaining risks:

1. Buffer-loss recovery can still be marked complete after inline history load failure.
2. `stream_retry` is not ownership-guarded and can clear the wrong active client stream if a stale retry event races with a newer turn.
3. Save-worthy context attachments appear to be built after the initial SSE user/agent persistence calls, so pre-turn persistence may miss them.
4. SSE error events do not carry the same classified error metadata the client and WebSocket path support.
5. SSE payload-size validation is less complete than the WebSocket request guard.
6. `APP_NOT_FOUND` retry still rebuilds from raw options rather than a resolved outbound payload snapshot.
7. Explicit SSE execution-service shutdown/abort remains absent from server shutdown.
8. Client billing/grant mode authority is partly cleaned up, but product still needs to decide whether switchboard-only `usesBms()` is acceptable or JWT/server authority must drive the UI hooks.

## Recent PR Reconciliation

| Area | Recent PR evidence | Current classification |
|---|---|---|
| Runtime extraction | #4085 `Extract transport-agnostic agent runtime from WebSocket server` | Earlier blocker closed. |
| Client reconnect/lifecycle/pagination | #4087 `fix(sse): client lifecycle parity — reconnect, trace IDs, pagination` | Broad issue closed; remaining pagination concerns should be tested but are not a known blocker. |
| Recovery hardening and event contract | #4088 `fix(sse): recovery hardening — buffer capacity, loss surfacing, event contract` | Mostly closed; one recovery-complete failure edge remains. |
| Request/context parity | #4089 `feat(sse): SSE request/context parity (sessionId, userTimezone, market)` | Mostly closed; payload-size and resend snapshot remain. |
| Observability | #4090 `feat(sse): add observability parity (trace IDs, APM transactions, request correlation)` | Broad issue closed; structured client error metadata remains. |
| Operational semantics | #4093 `feat(sse): add no-subscriber abort timer and app-level fanout observability` | Earlier disconnect/fanout blockers closed or downgraded. |
| Billing/grants | #4045 and #4094 | Mostly closed; client mode authority still needs explicit decision. |

## Prioritized Remaining Work

1. **Blocker: buffer-loss recovery can silently mask data loss**
   - Server emits `replay_complete` even when inline history recovery failed: [`agents/src/server/sse/routes.ts`](../agents/src/server/sse/routes.ts#L237), [`agents/src/server/sse/routes.ts`](../agents/src/server/sse/routes.ts#L310).
   - Client triggers fallback `loadHistory()` but still marks history complete on `replay_complete` when loss recovery is active: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L765), [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L775).
   - Impact: user can see an empty or incomplete conversation with no surfaced recovery failure.

2. **Blocker / Required: stale `stream_retry` is not ownership-guarded**
   - `ActiveStream` carries `requestId`: [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1173).
   - Terminal events include `requestId`: [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1628), [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1751).
   - `stream_retry` publishes directly without request ownership metadata: [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1350).
   - Client clears the current stream unconditionally: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L442).
   - Impact: a stale retry event can clear a newer active stream if it races with stop/new-message flows.

3. **Required: save-worthy context attachments may miss pre-turn persistence**
   - SSE `persistenceContext` is created before attachments are built: [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1157).
   - `continueConversation()` and `startAgentTurn()` run before `buildContextAttachments()`: [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1185), [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1227).
   - Persistence explicitly saves only `context.contextAttachments` with `persistence === 'save'`: [`agents/src/server/conversation-persistence.ts`](../agents/src/server/conversation-persistence.ts#L280).
   - Impact: history/UI may lose save-worthy user-message attachment metadata even though execution receives it.

4. **Required: SSE error events lack classified metadata**
   - SSE classifies errors but terminal error event data omits `errorType`, `statusCode`, retry metadata, and sanitized diagnostics: [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1731), [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1744).
   - SSE client already consumes `errorType` and `statusCode` if present: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L508).
   - WebSocket includes classified metadata in its error payload: [`packages/ai-transport/src/experimental-websocket-server.ts`](../packages/ai-transport/src/experimental-websocket-server.ts#L2460).
   - Impact: UI and retry handling cannot reliably distinguish `APP_NOT_FOUND`, `BUDGET_EXCEEDED`, retryable upstream failures, and generic upstream errors from SSE server context.

5. **Required: request payload-size guard is weaker than WebSocket**
   - SSE validates only `content.length`: [`agents/src/server/sse/routes.ts`](../agents/src/server/sse/routes.ts#L480).
   - WebSocket validates message plus context attachment payload length: [`packages/ai-transport/src/experimental-websocket-server.ts`](../packages/ai-transport/src/experimental-websocket-server.ts#L2040).
   - Impact: oversized referenced files/context payloads can take a different path under SSE than WebSocket.

6. **Required: `APP_NOT_FOUND` resend should reuse resolved outbound payload**
   - SSE caches raw `SendMessageOptions`: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L949).
   - Initial send resolves defaults and outbound fields before calling transport: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L955), [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L961).
   - Retry rebuilds a partial payload manually: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L533), [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L547).
   - Impact: retry can drift from the initial outbound request as new fields are added.

7. **Required: explicit SSE shutdown lifecycle**
   - App owns a singleton `sseExecutionService`: [`agents/src/server/app.ts`](../agents/src/server/app.ts#L227), [`agents/src/server/app.ts`](../agents/src/server/app.ts#L237).
   - Shutdown explicitly closes WebSocket but has no equivalent SSE execution-service abort/cleanup call: [`agents/src/server/app.ts`](../agents/src/server/app.ts#L759), [`agents/src/server/app.ts`](../agents/src/server/app.ts#L800).
   - Impact: process shutdown can leave active SSE execution cleanup dependent on HTTP server close or process exit rather than an explicit transport lifecycle.

8. **Decision required: client billing/grant mode authority**
   - `usesBms()` is documented as client-side switchboard gating only, not the full server decision: [`app/src/hooks/usesBms.ts`](../app/src/hooks/usesBms.ts#L3).
   - `useBudgetUpdate()` and `useGrantContext()` still gate on `usesBms()`: [`app/src/hooks/useBudgetUpdate.ts`](../app/src/hooks/useBudgetUpdate.ts#L35), [`app/src/hooks/useGrantContext.ts`](../app/src/hooks/useGrantContext.ts#L59).
   - Impact: if server/JWT authority can disagree with switchboard, the client may subscribe to the wrong grant/budget behavior. If product accepts switchboard-only UI gating, document that decision and keep this as cleanup.

## Full Parity Matrix

### Area 1: Client Transport And Hooks

| Capability / behavior | WebSocket implementation evidence | SSE implementation evidence | Status | Replacement impact | Recommended change | Suggested tests |
|---|---|---|---|---|---|---|
| Transport selection | `useChatTransport` selects WS or SSE by flag: [`app/src/hooks/useChatTransport.ts`](../app/src/hooks/useChatTransport.ts) | Same hook selects `useSSEChat` when SSE flag is enabled. | Parity | Required | Keep WebSocket fallback until remaining blockers are fixed. | Flag on/off hook selection; disabled unused transport does not initialize. |
| Connect/auth model | WebSocket authenticates over Socket.IO. | SSE uses authenticated HTTP/EventSource requests. | SSE-native equivalent | Required | Do not port socket `authenticate` events. | 401 refresh, reconnect, auth-negative route tests. |
| Send message path | WebSocket builds a `chat_message` payload. | SSE posts to `/messages`: [`app/src/services/transport/SSETransport.ts`](../app/src/services/transport/SSETransport.ts#L250). | Partial | Required | Preserve effective payload fields and store resolved outbound snapshot for retry. | Initial send and `APP_NOT_FOUND` retry send identical resolved metadata. |
| Stop generation | WebSocket emits `stop_generation`. | SSE posts `/stop` and locally finalizes if needed: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L1012). | SSE-native equivalent | Required | Keep HTTP stop endpoint. | Stop route, local finalization, server abort. |
| Reconnect/archive restore | WebSocket and #4087-style SSE lifecycle now clear cache/messages/history state. | Current SSE reconnect clears cache, messages, and history flags: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L1022). | Parity | Required | Keep targeted regression coverage for stale cursor/loading state. | Reconnect clears messages, pagination, loading-more, dynamic API cache. |
| History pagination after reconnect | WebSocket resets history state during reconnect. | SSE clears messages and history flags; `setHistoryLoadingMore(false)` is used in history completion paths: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L812). | Partial | Required | Add explicit reconnect test for `nextCursor` and `historyLoadingMore`; fix if failing. | Stale `nextCursor` and loading-more do not survive reconnect. |
| Complete trace attribution | WebSocket stores complete trace IDs. | #4090/#4087 added SSE trace/request correlation; current complete event extracts `requestId`: [`app/src/hooks/useSSEChat.ts`](../app/src/hooks/useSSEChat.ts#L460). | Parity | Required | Keep tests; no new gap found. | Complete event updates trace/request attribution store. |
| Error handling | WebSocket receives structured error metadata. | SSE client handles metadata if present, but server omits key fields. | Partial | Required | Add classified metadata to SSE error events. | `APP_NOT_FOUND`, `BUDGET_EXCEEDED`, retryable upstream, generic upstream. |
| Event allowlist | WebSocket handler registration follows socket events. | SSE hard-codes event list in transport. | Parity | Required | #4088 added event-contract work; keep it as a replacement gate. | Server event union matches client allowlist or explicit ignore list. |
| Catch-up ACK mechanics | WebSocket supports catch-up/recovery ACKs. | SSE uses `Last-Event-Id`, replay, and dedupe. | Not needed for SSE replacement | Cleanup | Do not port WebSocket ACK mechanics. | Assert SSE replay works without ACK protocol. |

### Area 2: Server Transport

| Capability / behavior | WebSocket implementation evidence | SSE implementation evidence | Status | Replacement impact | Recommended change | Suggested tests |
|---|---|---|---|---|---|---|
| Runtime bootstrap | Historically initialized inside WebSocket server. | #4085 extracted runtime; SSE has lazy `MessageExecutionService` creation in `app.ts`: [`agents/src/server/app.ts`](../agents/src/server/app.ts#L237). | Parity | Required | Keep boot test with WebSocket disabled. | Start with WS disabled; stream and message endpoints work. |
| Auth and tenant isolation | WebSocket validates authenticated socket/app ownership. | SSE routes use auth, app ownership, and conversation ownership middleware. | SSE-native equivalent | Required | Keep HTTP auth and ownership checks. | 401/403 for stream, messages, stop, actions, grants. |
| Stream startup and replay | WebSocket has socket recovery/catch-up. | SSE parses `Last-Event-Id`, emits `recovery_status`, replays, drains live events, emits `replay_complete`: [`agents/src/server/sse/routes.ts`](../agents/src/server/sse/routes.ts#L260). | SSE-native equivalent | Required | Keep SSE-native replay model. | Initial, delta, lost-buffer, completed-stream reload. |
| Recovery failure behavior | WebSocket recovery does not silently complete after data loss. | SSE can currently complete recovery after inline history failure. | Partial | Blocker | Gate completion on fallback success or surface visible recovery error. | Loss plus history DB failure does not mark complete empty. |
| Recovery buffer sizing | WebSocket had larger capacity. | #4088 added buffer capacity hardening. | Parity | Required | Keep capacity configuration and overflow tests. | Cursor behind buffer head triggers loss handling. |
| Disconnect semantics | WebSocket has cleanup/recovery expiry. | #4093 added no-subscriber abort timer and fanout observability. | Parity | Required | Keep reconnect-cancels-abort and expiry-aborts tests. | Close stream, reconnect before timer, timer expiry abort. |
| Stop/cancellation | WebSocket aborts current turn. | SSE `POST /stop` aborts and publishes `user_stopped`: [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L339). | SSE-native equivalent | Required | No wire-protocol port needed. | Stop idempotency and immediate terminal event. |
| Client actions | WebSocket action service uses socket. | SSE publishes `client_action` and resolves via `/actions`. | SSE-native equivalent | Required | Keep HTTP action-result path. | Success, error, unknown request, auth-negative tests. |
| Shutdown lifecycle | WebSocket close is explicit in server shutdown. | SSE execution-service shutdown is not explicit. | Missing | Required | Add `MessageExecutionService.shutdown()` and call it from server shutdown. | Active SSE execution aborts/cleans up on shutdown. |

### Area 3: Shared Transport Core

| Capability / behavior | WebSocket implementation evidence | SSE implementation evidence | Status | Replacement impact | Recommended change | Suggested tests |
|---|---|---|---|---|---|---|
| Event sequencing/buffering | Shared `ConversationEventChannel` sequences and buffers events. | SSE uses the same channel. | Parity | Required | Keep shared event channel. | Existing channel/recovery tests. |
| Stream part processing | Shared `StreamPartProcessor` normalizes AI SDK parts. | SSE uses shared processing path through `MessageExecutionService`. | Parity | Required | Keep logic shared. | Cross-transport fixture for chunks, tools, errors. |
| Execution loop | WebSocket and SSE use shared loop/handoff primitives after extraction. | SSE `MessageExecutionService` calls shared execution logic. | Parity | Required | Keep transport-neutral loop. | Handoff, validation retry, continuation. |
| Coalescing/backpressure | WebSocket subscriber coalesces. | SSE subscriber/writer coalesces and handles stream write failures. | SSE-native equivalent | Required | Keep SSE-native writer/backlog behavior. | Slow client, serialization failure, replay dedupe. |
| `stream_retry` event | WebSocket retry event belongs to current socket turn. | SSE publishes retry without active owner/request metadata. | Partial | Blocker / Required | Add ownership-guarded publish and client request correlation. | Superseded retry cannot affect new turn. |
| Event type contract | Server event union is shared. | SSE client allowlist is fixed but #4088 added contract coverage. | Parity | Required | Keep contract tests mandatory. | New server event fails unless handled or ignored. |

### Area 4: Recovery, Replay, And Persistence

| Capability / behavior | WebSocket implementation evidence | SSE implementation evidence | Status | Replacement impact | Recommended change | Suggested tests |
|---|---|---|---|---|---|---|
| Persisted history load | WebSocket loads history over socket. | SSE uses HTTP history and inline recovery history. | SSE-native equivalent | Required | Keep HTTP history model. | Initial load, pagination, reload after completed stream. |
| `Last-Event-Id` recovery | WebSocket uses socket recovery IDs/ACKs. | SSE uses native `Last-Event-Id`. | SSE-native equivalent | Required | Do not port WebSocket ACKs. | Reconnect from known sequence, duplicate suppression. |
| Buffer loss fallback | WebSocket has recovery/catch-up semantics. | SSE detects loss and attempts DB history, but can complete after failure. | Partial | Blocker | Treat loss plus failed history as incomplete until fallback success or visible failure. | DB failure plus replay complete cannot silently finish. |
| Persisted-event filtering | Shared recovery plan filters persisted completed-turn events. | SSE uses shared recovery plan. | Parity | Required | Keep filtering tests. | Persisted completed events suppressed; unpersisted terminal tail replayed. |
| Context attachment persistence | WebSocket builds context before persistence. | SSE builds attachments after pre-turn persistence. | Partial | Required | Build save-worthy attachments before `continueConversation()` / `startAgentTurn()`. | Save-worthy attachments persisted; ephemeral not persisted. |
| Validation continuation persistence | WebSocket persists validation continuation metadata. | SSE passes `messageMetadata` for validation messages: [`agents/src/server/sse/MessageExecutionService.ts`](../agents/src/server/sse/MessageExecutionService.ts#L1470). | Parity | Required | No gap found. | Validation message persisted with expected metadata. |

### Area 5: Request And Context Parity

| Capability / behavior | WebSocket implementation evidence | SSE implementation evidence | Status | Replacement impact | Recommended change | Suggested tests |
|---|---|---|---|---|---|---|
| `sessionId`, timezone, market | WebSocket includes execution metadata. | #4089 added SSE parity for these fields. | Parity | Required | Keep tests. | Route forwards `userTimezone`; retry preserves `market`. |
| Template/model/profile | WebSocket sends resolved payload. | SSE resolves defaults before send. | Parity | Required | Store resolved outbound snapshot for retry. | `APP_NOT_FOUND` retry uses same model/profile as first send. |
| AI edit contexts/assets/todo/build errors | WebSocket shared builder supports these. | SSE forwards and builds context attachments server-side. | Parity for execution; Partial for persistence | Required | Keep execution parity; fix pre-turn persistence attachment timing. | Execution context and persisted history assertions. |
| Payload-size guard | WebSocket checks message plus context attachments. | SSE checks only content length. | Partial | Required | Add total payload validation for context attachments/custom context/build error/selected assets metadata. | Oversized referenced file returns deterministic 400/413 before execution. |
| Repo/token handling | Not a chat transport wire requirement. | SSE should not add repo tokens to chat payloads. | Not needed for SSE replacement | Cleanup | Keep repo/token handling in existing REST/config paths. | Existing dual-product git config tests. |

### Area 6: Billing, Grants, And Budget Behavior

| Capability / behavior | WebSocket implementation evidence | SSE implementation evidence | Status | Replacement impact | Recommended change | Suggested tests |
|---|---|---|---|---|---|---|
| BMS precheck | WebSocket prechecks before execution. | SSE prechecks before execution. | Parity | Required | Keep route tests. | 402, accepted path, tamper-resistant body fields. |
| BMS reconciliation and update | WebSocket files report and emits `budget_update`. | SSE reconciles before terminal event and publishes `budget_update`. | Parity | Required | Keep ordering tests. | Success, conflict, failure, user-abort attribution. |
| Legacy grant context | WebSocket sends grant context over socket. | SSE uses HTTP grant context endpoint and request-refresh events. | SSE-native equivalent | Required | Keep HTTP model. | Grant set, request refresh, no BMS mode emissions. |
| Mid-stream grant recovery | WebSocket has grant advancement/retry logic. | SSE uses shared recovery logic and emits `stream_retry`. | Partial | Blocker / Required | Keep recovery, but guard retry event ownership. | Retry with no non-idempotent tools; stale retry ignored. |
| Client BMS/grants gating | WebSocket/SSE share hooks. | #4094 centralized `usesBms()`, but it is still switchboard-only. | Partial / Decision required | Required if JWT authority is required | Decide whether UI should follow JWT/server authority. If yes, wire token-authoritative mode into hooks. | Token vs switchboard disagreement tests. |
| `budget_status` | Server can emit status. | Client behavior is not central replacement requirement. | Not needed for SSE replacement | Cleanup | Keep or mark intentionally ignored. | Contract test documents ignore behavior. |

### Area 7: Observability And Operational Behavior

| Capability / behavior | WebSocket implementation evidence | SSE implementation evidence | Status | Replacement impact | Recommended change | Suggested tests |
|---|---|---|---|---|---|---|
| Structured logs | WebSocket logs connection/message lifecycle. | SSE logs stream, recovery, execution, budget, and lifecycle events. | Parity | Required | Keep correlation fields. | Log field snapshots for success/error/recovery. |
| Request correlation/APM | WebSocket has message boundary instrumentation. | #4090 added SSE request correlation and APM transactions. | Parity | Required | Keep observability tests. | Success, abort, provider error, budget error labels. |
| Debug turn stats | WebSocket emits debug stats. | SSE event and client dispatch exist. | Parity | Nice-to-have | Keep debug drawer regression coverage. | `airo:debug-turn-stats` dispatch test. |
| Structured client errors | WebSocket sends classified metadata. | SSE server omits classified metadata in terminal error payload. | Partial | Required | Add error metadata to SSE event data. | Client handles classified SSE errors identically to WS. |
| No-subscriber operations | WebSocket has cleanup/expiry behavior. | #4093 added no-subscriber abort timer. | Parity | Required | Keep timer/fanout observability tests. | No-subscriber timer starts, cancels, aborts. |
| Shutdown operations | WebSocket close is explicit. | SSE active execution cleanup on shutdown is not explicit. | Missing | Required | Add SSE shutdown/abort path. | Server shutdown aborts active execution and clears registries. |

### Area 8: Tests, Docs, And Replacement Readiness

| Capability / behavior | WebSocket implementation evidence | SSE implementation evidence | Status | Replacement impact | Recommended change | Suggested tests |
|---|---|---|---|---|---|---|
| Server route coverage | WebSocket server tests exist. | SSE route tests cover stream, replay, messages, stop, actions, grants. | Parity | Required | Add tests for remaining recovery and payload-size gaps. | Buffer-loss failure, oversized context, auth-negative actions/stop. |
| Hook coverage | WebSocket hook/controller tests exist. | `useSSEChat` tests cover many recovery/lifecycle paths. | Partial | Required | Add stale retry, fallback failure, resend snapshot tests. | Current blocker/regression suite. |
| Shared transport coverage | Shared package tests cover channel/recovery/subscribers. | SSE depends on same shared code. | Parity | Required | Keep full `@airo/ai-transport` suite as replacement gate. | Full package suite. |
| Docs | Older docs may describe WebSocket as primary. | This doc is current as of post-#4094 code. | Partial | Cleanup | Update/remove stale WebSocket-primary docs in final removal PR. | Docs grep for stale flag/protocol claims. |
| Replacement flag | Flag still permits fallback. | SSE can be selected while WebSocket remains available. | Partial | Required | Keep fallback until blockers close; then canary SSE-default before removal. | SSE-default canary with no Socket.IO connection. |

## Explicit Non-Goals And WebSocket-Only Mechanics

| Mechanic | Classification | Reason |
|---|---|---|
| Socket `authenticate` event | Not needed for SSE replacement | SSE uses authenticated HTTP requests and EventSource open/reopen behavior. |
| Socket `tokenRefresh` event | Not needed for SSE replacement | SSE refreshes through HTTP/token plumbing and reconnect. |
| `recovery_ack` / `catchup_ack` | Not needed for SSE replacement | SSE equivalent is `Last-Event-Id`, server replay, and client dedupe. |
| Socket IDs as durable user-visible identity | Not needed for SSE replacement | SSE should use conversation/session keys plus HTTP auth. |
| Socket.IO ping/upgrade/volatile emit semantics | Not needed for SSE replacement | Browser/EventSource reconnect plus explicit HTTP actions are the native model. |
| WebSocket wire names | Not needed for SSE replacement | Preserve behavior and guarantees, not wire protocol shape. |
| Inert `budget_status` UI behavior | Cleanup | Not currently a replacement blocker unless product wants visible reconciling state. |

## Recommended Implementation Sequence

1. **PR A: recovery correctness blocker**
   - Prevent `replay_complete` from marking history/recovery complete after `lossDetected && historyLoadFailed` until fallback HTTP history succeeds.
   - Surface a recovery error if fallback fails.
   - Tests: inline history failure plus fallback success; inline history failure plus fallback failure; completed-stream reload path remains unchanged.

2. **PR B: guarded `stream_retry` blocker**
   - Route `publishStreamRetry` through an active-stream ownership checked helper.
   - Include `requestId` or equivalent stream owner metadata.
   - Client ignores stale `stream_retry` not matching the current active stream/request.
   - Tests: superseded turn cannot clear a newer active stream; valid retry still clears partial UI.

3. **PR C: persistence-context attachment parity**
   - Build save-worthy context attachments before pre-turn persistence.
   - Attach them to `persistenceContext` for `continueConversation()` and relevant `startAgentTurn()` calls.
   - Tests: save-worthy attachments persist; ephemeral attachments do not; execution context still receives all required attachments.

4. **PR D: structured SSE error metadata**
   - Add `errorType`, `statusCode`, retry metadata, and sanitized diagnostics to SSE terminal error event data.
   - Keep sensitive internal details sanitized consistently with the WebSocket contract.
   - Tests: `APP_NOT_FOUND`, `BUDGET_EXCEEDED`, retryable upstream, generic upstream.

5. **PR E: request guard and resend fidelity**
   - Add total request payload validation comparable to WebSocket.
   - Store and reuse the resolved outbound SSE send payload for `APP_NOT_FOUND` retry.
   - Tests: oversized referenced files/context rejected; retry payload exactly matches initial resolved payload except expected retry metadata.

6. **PR F: explicit SSE shutdown lifecycle**
   - Add `MessageExecutionService.shutdown()` or equivalent abort/cleanup API.
   - Call it from `agents/src/server/app.ts` shutdown before closing database/process resources.
   - Tests: active execution aborts; action registries, subscribers, timers, and APM transaction cleanup run.

7. **PR G: billing authority decision or cleanup**
   - If JWT/server authority must drive UI mode, wire that value into `useGrantContext()` and `useBudgetUpdate()`.
   - If switchboard-only client gating is accepted, document that product decision and keep #4094 behavior.
   - Tests: token-vs-switchboard disagreement cases if JWT authority is required.

8. **PR H: final replacement-readiness pass**
   - Run full targeted test plan.
   - Update stale docs.
   - Canary SSE-default with WebSocket fallback still present.
   - Disable/remove WebSocket only after canary evidence and rollback path are accepted.

## Test Plan Before Disabling WebSocket

1. `useSSEChat`: buffer-loss with inline history failure, fallback success, fallback failure, and no silent complete.
2. `useSSEChat`: stale `stream_retry` ignored; current retry accepted.
3. `useSSEChat`: `APP_NOT_FOUND` resend uses resolved outbound payload snapshot.
4. `useSSEChat`: reconnect clears messages, history completion, pagination cursor, and loading-more state.
5. `SSETransport`: event allowlist contract, auth refresh, `Last-Event-Id`, cooldown/reconnect, and bad payload handling.
6. SSE routes: stream replay, lost-buffer recovery, history DB failure, oversized context payload, stop/actions/grants auth-negative cases.
7. `MessageExecutionService`: success/error/abort terminal ordering, guarded retry, context persistence, BMS report ordering, user-stop attribution, shutdown abort.
8. Shared `@airo/ai-transport`: event channel, recovery plan, subscribers, coalescing, stream processor, budget recovery.
9. Billing/grants: BMS happy path, 402, conflict/refreshRequired, legacy grant refresh/retry, BMS-vs-grants mode decision cases.
10. Observability: request ID and trace/APM labels across success, abort, provider error, budget error, recovery failure.
11. Integration/browser: SSE flag on, no Socket.IO connection, initial prompt, tool calls, stop, reload during active turn, archive restore, history pagination.
12. Docs/replacement: grep docs for stale WebSocket-primary claims; document non-goals and rollback procedure.

## Performance And Operations Benchmarks

These are not functional parity blockers by themselves, but they should be part of replacement signoff because SSE changes connection shape, buffering, and replay behavior.

| Metric | Suggested threshold | Method |
|---|---|---|
| Time to first token | SSE no worse than WebSocket by more than 50 ms p95 in the same environment. | Measure from `POST /messages` to first `chunk` event. |
| Streaming throughput | SSE at least 95% of WebSocket event throughput under representative load. | Run the same synthetic agent stream over both transports and compare events/sec and client render cadence. |
| Recovery latency | Reconnect to first replayed event under 500 ms p95 while buffer is intact. | Disconnect mid-turn, reconnect with `Last-Event-Id`, measure first replayed event. |
| Memory per idle connection | SSE no more than 1.2x WebSocket at target concurrent idle connections. | Compare RSS/heap after a fixed number of idle connections and active streams. |
| Buffer overflow behavior | Loss detection always leads to history replay or visible retry/error state. | Force cursor behind buffer head and validate `lossDetected` plus recovery UX. |
| Reconnect storm resistance | No unbounded EventSource opens or token-refresh loops during rapid focus/network churn. | Trigger rapid reconnects and verify cooldown/guards/log volume. |
