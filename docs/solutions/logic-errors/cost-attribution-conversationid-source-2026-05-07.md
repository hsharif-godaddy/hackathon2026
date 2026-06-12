---
title: Cost-attribution OTel spans silently dropped for first-message sessions
date: 2026-05-07
last_updated: 2026-06-02
category: logic-errors
module: agents
problem_type: logic_error
component: service_object
symptoms:
  - "budget.report.attribution_emit_missing_conversation_id warns at ~54% of test-env budget.report.created events"
  - "Langfuse cost-attribution traces under-represent InitialAgent first-message conversations"
  - "createAgentContext emits span with conversationId: undefined; OTel SDK drops the span at emit"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [bms, cost-attribution, otel, langfuse, conversationid, initialagent, first-message, websocket]
related_components: [packages/ai-transport, agents/src/server/ai-lib-websocket-server.ts]
---

# Cost-attribution OTel spans silently dropped for first-message sessions

## Problem

The OTel cost-attribution span in `agents/src/server/ai-lib-websocket-server.ts` was emitted with `conversationId: undefined` for every InitialAgent first-message session, so the SDK silently dropped the span at emit. Langfuse received no cost-attribution trace for ~54% of test-env sessions, skewing any downstream system that trains or calibrates on that data (judge calibration, budget-category classifier, Budget Reconciliation Sync).

## Symptoms

- `budget.report.attribution_emit_missing_conversation_id` warn log fires at the `onBudgetReport` read site for ~54% of `budget.report.created` events in test env (7/13 sessions over 48h).
- Grafana Loki spot-check on any single missing session shows the warn log fires with `socketId === originalSocketId` (no migration divergence).
- Failing sessions profile to InitialAgent first-message sends or reconnect-fresh-message cases.
- Billing accounting is unaffected — BMS uses `sessionId` + `budgetId` via a separate path.

**Loki query** (via test debug-console, which proxies to Loki with `env="test"`):

```
{job="airo-agents", env="test"} |= "budget.report.attribution_emit_missing_conversation_id"
```

Cross-reference against the same-window `budget.report.created` count to compute the miss rate; the denominator is total reconciliations. Expected post-fix: single-digit miss rate, only for sessions where neither the metadata nor conversation field was populated.

## What Didn't Work

- **Socket-migration key-asymmetry hypothesis.** The initial read of the subsystem said: writes happen under `socketId` in `onMessageStart`, reads happen under `originalSocketId` in `onBudgetReport`, and these diverge when Socket.IO migrates mid-turn. A full plan was written with three implementation units (canonicalize all three cost-attribution Maps under `effectiveSocketId`, seven-hypothesis reproduction harness, orphan-session retry queue) and implementation began. About 45 minutes in, the implementing agent paused and wrote: *"I'm ~45 minutes into a code change that rests on a causal claim I can no longer defend from first principles. The plan was written from research that pattern-matched the bug shape, not from a runtime trace."* Both `socketId` at write and `originalSocketId` at read are the *same* closure-captured variable from `handleChatMessageInternal`; they should match trivially. Implementation stopped and code changes were reverted. (session history)
- **Writing with `effectiveSocketId` via the migration chain** would have added transport-layer complexity and a new field on the `onMessageStart` callback signature without addressing the real problem.
- **Trusting name-level asymmetry as evidence of runtime divergence.** The variable-name difference (`socketId` vs `originalSocketId`) and the existence of real migration plumbing elsewhere in the file (`stateManager.getEffectiveSocketId`, `ConnectionRecoveryManager`) made the hypothesis feel well-supported. A single Loki query — "for each failing session, is `socketId === originalSocketId`?" — would have killed the hypothesis in one minute. We ran that query only after the investigating agent paused. Result: all 8 failing sessions over 48h had identical socket IDs. (session history)

## Solution

One-line field-source swap at the cache-write site, plus extraction to a pure helper for testability:

```ts
// Before (agents/src/server/ai-lib-websocket-server.ts)
const sessionConversationId = typedContext?.conversation?.conversationId
if (sessionConversationId) {
  budgetReportConversationCache.set(socketId, { conversationId: sessionConversationId, createdAt: Date.now() })
}

// After
const { value: sessionConversationId, source: conversationIdSource } = selectCacheConversationId(typedContext)
if (sessionConversationId) {
  budgetReportConversationCache.set(socketId, { conversationId: sessionConversationId, createdAt: Date.now() })
  logger.debug('budget.report.cache_written', { socketId, conversationId: sessionConversationId, sourceField: conversationIdSource })
}
```

The helper (extracted to its own module `agents/src/server/budget-report-conversation-id.ts` to avoid triggering SQLite initialization during test imports — see Prevention) returns `{ value, source }` so the caller logs the real source without re-deriving it by equality-check. The actual module in the repo:

```ts
import type { AgentsAppContext } from '../types/websocket-context.js'

export type CacheConversationIdSelection =
  | { value: string; source: 'metadata' | 'conversation' }
  | { value: undefined; source: 'none' }

export function selectCacheConversationId(
  context: AgentsAppContext | undefined,
): CacheConversationIdSelection {
  const fromMetadata = context?.metadata?.conversationId
  if (typeof fromMetadata === 'string' && fromMetadata.length > 0) {
    return { value: fromMetadata, source: 'metadata' }
  }

  const fromConversation = context?.conversation?.conversationId
  if (typeof fromConversation === 'string' && fromConversation.length > 0) {
    return { value: fromConversation, source: 'conversation' }
  }

  return { value: undefined, source: 'none' }
}
```

The named `CacheConversationIdSelection` discriminated-union alias lets callers destructure `{ value, source }` and narrows `value` to `string` on the `source !== 'none'` branch. The `length > 0` guard handles the typed-string-but-empty-string edge case defensively; `AgentsAppContext` declares both `metadata.conversationId` and `conversation.conversationId` as `string | undefined`, so an empty string would type-check but wouldn't be a valid conversationId.

## Why This Works

`attachConversationId` in `packages/ai-transport/src/experimental-websocket-server.ts` (line ~3207) runs inside `handleChatMessageInternal` *before* `onMessageStart` fires. It reads the conversationId from the state manager and writes it to `context.metadata.conversationId` — the server-canonical field. The pre-fix guard read `context.conversation.conversationId`, which is client-sent (typed on `AgentsAppContext.conversation.conversationId` in `packages/shared/src/websocket/context.ts`) and only populated on the *second* message in a conversation once the frontend has a prior conversationId to send. InitialAgent first-message sessions therefore always saw `conversation.conversationId === undefined` at the cache-write site and silently skipped the write.

Two diagnostic tells existed but were easy to miss: every failing session had `conversation?.conversationId` missing in the context payload, and 6/8 profiled sessions were InitialAgent. The field-source mismatch is invisible if the debugger only looks at the socket-id plumbing.

The return-shape change (`{ value, source }` instead of `string | undefined`) matters for a separate reason: the original version had callers re-derive source by `typedContext?.metadata?.conversationId === sessionConversationId ? 'metadata' : 'conversation'`. That check fails silently when both fields hold the same string (common on follow-up messages where transport copies metadata into `conversation.context`), falsely crediting `metadata` in every equal case. Returning source from the helper eliminates the re-derivation.

**Representative trace (runtime evidence).** Session `<session-id>` on app `<app-id>`, 2026-05-06 12:27 UTC, was traced end-to-end from Loki. Observations that together killed the migration hypothesis and named the real cause:

- `budget.report.created` fired with `source: "finally"` (finally-block fallback, not the primary reconciliation path) — the session had errored mid-stream.
- `ai-lib.unified-provider.budget.gocode.response` returned `status: 500` — GoCode failure.
- `funnel.initial_prompt.processing` fired at session start with `agentName: "initial"` — InitialAgent, first-message, no prior conversationId on the client side.
- Repeated `Skipping onEnd/onStart for "ai.generateText.doGenerate" (type: llm) — no conversationId (missing createAgentContext?)` events throughout — the missing-conversationId symptom wasn't just the cache-write; it manifested at the AI SDK integration layer too, because the same `typedContext?.conversation?.conversationId` source was consulted there.
- `socketId === originalSocketId` throughout — no migration ever occurred for this session.

## Prevention

- **When writing per-socket or per-message state that references `conversationId`, read from `context.metadata.conversationId` first.** It's server-canonical and populated before `onMessageStart`. `context.conversation.conversationId` is a client-sent fallback; it's absent on first messages. Use the `selectCacheConversationId` helper. It is now called from three sites: `agents/src/server/ai-lib-websocket-server.ts` (two, WS pin + cache write) and `agents/src/server/sse/context-loader.ts` (SSE transport, same resolution as WS).

- **Keep precedence-decision helpers in their own module, not in the integration file they're consumed from.** The helper was originally inlined in `agents/src/server/ai-lib-websocket-server.ts` and re-exported for tests. That forced the test suite to import the full WebSocket server module, which instantiates `AppRepository()` at top level and triggers SQLite initialization — 2160ms import cost for 2ms of actual test work. Extracting to `agents/src/server/budget-report-conversation-id.ts` dropped test collection from ~2160ms to ~18ms (120×). When a test imports from a file that instantiates infrastructure at top level, the test pays for it. (session history)

- **Return attribution explicitly from precedence helpers; don't re-derive it by equality.** The `{ value, source }` shape is the regression-resistant variant. A caller that re-derives source via `X === Y` silently breaks when both fields legitimately carry the same value — which is normal on any system that copies canonical values forward as a backup.

- **Test the call-site and the helper.** The helper gets 7 pure-function unit tests covering precedence + edge cases. But the actual call-site (the `.set(socketId, {...})` block inside a closure in `onMessageStart`) is untested. A future refactor that swaps the helper-call for a re-inlined read will pass the helper tests and break the call-site. Consider an integration test against the real cache map, or pull the call-site itself into a second testable helper.

- **When an observed fault pattern suggests a diagnosis, trace at least one failing session end-to-end before committing to a plan.** The socket-migration hypothesis matched the plan research output and an earlier Copilot review's pattern-match, but 6/8 failing sessions had `socketId === originalSocketId` in Loki. A 30-second Loki check would have redirected the investigation before a full plan was written. (session history)

- **Audit grep for future reviewers.** The same "guard on client-sent field where a server-populated field exists" pattern may appear elsewhere in the WebSocket message lifecycle. Run the following across `agents/src/server/` and `packages/` to find cache-write sites with the same shape:

  ```bash
  # Guarded writes reading the client-sent conversation field directly
  grep -rn "context?.conversation?.conversationId\|typedContext?.conversation?.conversationId" agents/src packages/ai-transport packages/ai-lib
  # Any read of `conversation.conversationId` not paired with a metadata fallback
  grep -rn "conversation\.conversationId" agents/src/server | grep -v "metadata\.conversationId"
  ```

  Any guarded write (`if (x) { cache.set(...) }`) where `x` is a client-sent field is suspect. Prefer `selectCacheConversationId()` or an analogous helper over inlined reads.

- **Related sub-bug, same class (FIXED).** `processBudgetReport` in `agents/src/server/budget-report-handler.ts` previously set `executionData.noValueDelivered` only inside `if (steps && steps.length > 0)`, so sub-second user-initiated Stops before any step emits fell through to the `default` attribution branch instead of `user_aborted`. It now forces `executionData.noValueDelivered = true` on the empty-steps branch (`analyzeExecution` is skipped when steps are empty, so `noValueDelivered` is never derived otherwise), reaching the `user_aborted` attribution path. Still open: `checkCorrelationIdRace` returns early when `steps.length === 0`, so abort-triggered BMS 409s (GoCode PATCH arriving after report filed) remain invisible to the race-detection monitoring added in May 2026. See `docs/solutions/runtime-errors/bms-session-409-race-on-abort.md`.

## Related Issues

- PR #3506: https://github.com/gdcorp-partners/airo-app-builder/pull/3506
- Deferred follow-up: orphan-session BMS reconciliation retry (separate PR). The investigation harness for hypothesized socket-migration races was descoped after the revised root-cause narrative showed it unnecessary.
- Agents CLAUDE.md Observability section now documents `metadata.conversationId` as the canonical source and points at the helper.
- Cross-reference: [`docs/solutions/logic-errors/websocket-onmessagestart-context-metadata-timing-2026-04-13.md`](websocket-onmessagestart-context-metadata-timing-2026-04-13.md) documents the inverse case — `metadata.budgetServiceEnabled` being read before `contextProvider` populates it, with the resolution being to read JWT claims directly instead. Same file (`ai-lib-websocket-server.ts`), same `onMessageStart` lifecycle, opposite resolution direction. Together these two docs describe the authoritative-source map: for `conversationId`, prefer `context.metadata` because `attachConversationId` populates it pre-`onMessageStart`; for `budgetServiceEnabled`, prefer JWT claims because `contextProvider` populates `context.metadata` *after* `onMessageStart`. The rule is not "always prefer metadata" — it is "know which code path populates each field at which lifecycle step, and read from the one guaranteed to have fired."
