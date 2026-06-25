# Airo Care Bridge — Design Spec

**Status:** Draft
**Date:** 2026-06-23
**Owner:** starin
**Related:** [ADR DRAFT-0065 — Integrate Airo Care Support Agent into Airo App Builder](https://github.com/gdcorp-digitalcare/care-architecture/blob/Airo-AI-Builder-Integration/06-adrs/DRAFT-0065-adr-support-agent-integration.md)

---

## Summary

Add a bounded "Care Bridge" module to the agents service that takes a single support turn (one user message + a target AAB conversation), forwards it to the external Airo Care agent (`@airo-care/client`), streams Care's NDJSON response back through the existing SSE chat transport, and persists the exchange to AAB's conversation history.

This iteration is the **minimal integration touchpoint**: anonymous visitor auth only, no transfer-to-human, no idle-close lifecycle. The bridge does not know or care how a turn was classified as "support" — it only handles support turns once they are routed to it.

### Trigger: `/agent support` — integration-testing scaffolding only

For this iteration the trigger is the existing manual `/agent <id>` override: typing `/agent support\n<message>` in the chat input routes the turn to the bridge via the established override path. **This is not a production UX.** The manual override exists for QA/integration testing and will not be the way real users reach the bridge. When intent classification + automatic router routing lands (separate change, separate spec), it will resolve `agentId` to `'support'` through a different path, and this bridge will fire unchanged — the bridge's contract is "given a support turn, handle it", not "given a `/agent support` command".

## Goals

- Provide a single integration touchpoint that, when invoked for an AAB conversation:
  1. Creates a new Airo Care conversation on the first support turn for that AAB conversation.
  2. Sends subsequent support turns to the same Care conversation (sticky context).
  3. Streams Care's response chunks back to the chat window as they arrive.
- All Care-related code lives behind a single bounded module with one public interface.
- Bridge is **opt-in via env vars** — local devs without Care credentials see a clean "not configured" message, not a crash.
- Zero changes to the existing build-agent code path (`develop`, `initial`, `marketing`, etc.).
- The bridge's contract is independent of how the turn was classified — automatic intent routing can be added later without changing the bridge.

## Non-goals

- Automatic intent classification / pre-LLM routing. The `/agent support` manual override is the integration-testing trigger; production routing is a separate future change that will reach the bridge via the same `resolvedAgentId === 'support'` interception point.
- IDP token delegation (`X-Delegated-For`). Visitor-cookie auth only this iteration.
- Calling `client.closeConversation` on session end. Care idle timeout handles cleanup.
- Transfer-to-human (LiveEngage widget). Care won't trigger it in visitor mode for now.
- Persisting `careConversationId` to SQLite. In-memory only; restarts orphan Care conversations.
- A new HTTP surface (e.g. BFF `/api/auth/support-token`, agents `/internal/token/:siteId`).
- CES bundle (headless) integration on the browser side.
- Any production-facing change to the chat input or message-bar UX. The `/agent support` typing path is a developer/QA convention, not a feature.

## Architecture

### Module layout

```
agents/src/care/
├── CareBridge.ts            # Public entry — factory + interface
├── CareSessionStore.ts      # In-memory Map<aabConvId, CareSession>
├── translator.ts            # StreamMessageEvents → BridgeEvent (wire-ready)
├── identity.ts              # generateUcid()
├── errors.ts                # user-facing error-message helper
├── index.ts                 # re-exports public surface ONLY
└── __tests__/
    ├── CareBridge.test.ts
    ├── CareSessionStore.test.ts
    ├── translator.test.ts
    ├── identity.test.ts
    └── errors.test.ts
```

`index.ts` is the contract; nothing outside `agents/src/care/` imports anything but the symbols it re-exports.

### Public API

```typescript
// agents/src/care/index.ts
export { createCareBridge } from './CareBridge.js'
export type { CareBridge, SupportTurnInput, BridgeEvent } from './CareBridge.js'
```

```typescript
// agents/src/care/CareBridge.ts
import type { StreamingEvent } from '@airo/ai-transport'

// Exactly the shape eventChannel.publish() consumes.
// id/sequence/timestamp/deliveredTo/persisted are filled in by the channel.
export type BridgeEvent = Omit<
  StreamingEvent,
  'id' | 'sequence' | 'timestamp' | 'deliveredTo' | 'persisted'
>

export interface SupportTurnInput {
  aabConversationId: string
  visitorId: string                  // from AgentContext.visitorId — caller-provided, non-empty
  message: string                    // user's stripped /agent body
  abortSignal?: AbortSignal
}

export interface CareBridge {
  streamSupportTurn(input: SupportTurnInput): AsyncIterable<BridgeEvent>
}

export function createCareBridge(config: {
  baseURL: string
  executor: string                   // e.g. "v1/orchestrator-test"
}): CareBridge | null                // null when baseURL is empty
```

### Internal session state

```typescript
// agents/src/care/CareSessionStore.ts
interface CareSession {
  ucid: string                       // UUID, generated on first turn, sticky
  careConversationId?: string        // set after first successful createConversation
}
```

Keyed by `aabConversationId` only. Conversation IDs are globally-unique nanoids in AAB; no cross-app collision risk. The store tracks `lastTouched` per entry for the TTL sweep.

`visitorId` is **not** stored in the session — it is provided per turn from `AgentContext.visitorId`. The bridge re-uses the same `ucid` and `careConversationId` even if the caller's `visitorId` changes between turns (Care tolerates visitor-cookie reconnects on the same conversation).

### Wiring

In `agents/src/server/app.ts`'s `getOrCreateSSEExecutionService()`:

```typescript
import { createCareBridge } from '../care/index.js'

const careBridge = createCareBridge({
  baseURL: process.env.AIRO_CARE_BASE_URL ?? '',
  executor: process.env.AIRO_CARE_EXECUTOR ?? 'v1/orchestrator-test',
})

sseExecutionService = new MessageExecutionService({
  ...existing deps,
  careBridge,                        // new optional dep on ExecutionDeps
})
```

`careBridge` is `CareBridge | null` on `ExecutionDeps`. `null` is a valid state — `/agent support` will emit a "Care is not configured" chunk on this server.

### Intercept point

Top of `MessageExecutionService.executeUnderTrace` (currently at line 1907), after the destructure but **before** the assessment fire (line 1955):

```typescript
private async executeUnderTrace(params, turnSnapshot) {
  // ... existing destructure + sseSocketId + agentCtx setup ...

  if (resolvedAgentId === 'support') {
    return this.executeSupportUnderTrace(params, turnSnapshot)
  }

  // ... existing build path entirely unchanged ...
}
```

`resolvedAgentId === 'support'` is reliable here. Manual `/agent` override is parsed at the route layer, `resolveAgent` returns it verbatim, and `effectiveAgentId` only diverges later in the design-kit forced-install path (build-only, never reached for support).

### `executeSupportUnderTrace` flow

```
1. Setup stream state + bridge SSE subscribers → eventChannel
   (factored out of the build path into a shared private helper:
    setupStreamState(conversationId, appId, requestId, apmTransaction))

2. emitConversationStartIfFirstTurn(...)            # telemetry parity

3. Persist user message + open agent-turn slot:
     await continueConversation(convId, content, ctx)
     activeAgentMessageId = await startAgentTurn(convId, ctx)
   ctx.metadata.authType drives origin via existing getOriginFromContext.

4. Create AbortController, register in this.abortControllers
   (so this.abortControllers.get(convId)?.abort() on the next message
    cancels this support turn — same lifecycle as build).

5. Guards:
     if (!agentCtx?.visitorId)
       publish error chunk ("Support is unavailable — visitor session missing"),
       publish complete, run finalizer, return.
     if (!this.deps.careBridge)
       publish error chunk ("Care is not configured"), publish complete,
       run finalizer, return.

6. for await (const event of careBridge.streamSupportTurn({
      aabConversationId: convId,
      visitorId: agentCtx.visitorId,
      message: content,
      abortSignal: abortController.signal,
   })) {
     await this.guardedPublish(appId, convId, event,
       'sse.execution.stream_publish_failed', 'warn')
   }

7. completeConversationAndMarkPersisted({ ... })    # same finalizer as build

8. Cleanup: delete activeStreams + abortControllers entries; end APM transaction.
```

The bridge guarantees exactly one terminal `complete` event at the end of every for-await stream (happy path or thrown error). For in-stream Care `error` events, the translator maps them to a user-facing chunk; the bridge's post-loop synthetic-complete guard emits the terminal if the queue closes without a `result` event. The intercept site only emits its own terminal events on the **guard paths** (step 5) where the bridge is never invoked — in that case it publishes the error chunk + a single `complete` directly.

### Translator (inside the boundary)

`agents/src/care/translator.ts` is a pure function:

```typescript
import type { StreamMessageEvents } from '@airo-care/client'
import type { BridgeEvent } from './CareBridge.js'

export function translateCareEvent(
  event: StreamMessageEvents,
  ctx: { agentName: string; conversationId: string },
): BridgeEvent | null {
  switch (event.type) {
    case 'delta':
      return {
        type: 'chunk',
        content: event.textDelta,
        data: {},
        agentName: ctx.agentName,
        conversationId: ctx.conversationId,
      }
    case 'result':
      return {
        type: 'complete',
        content: '',
        data: { finishReason: 'stop' },
        agentName: ctx.agentName,
        conversationId: ctx.conversationId,
      }
    case 'error':
      // Translator maps the in-stream Care error to a controlled user-facing chunk.
      // Care's raw event.message is NOT interpolated — it may contain internal
      // diagnostics (IDs, stack fragments, service names) that must not render in
      // customer chat. The bridge logs care.stream.error_event with the raw fields
      // for operator visibility. The translator does NOT emit a terminal complete
      // itself — the bridge's post-loop synthetic-complete guard fires if the queue
      // closes without a result event.
      return {
        type: 'chunk',
        content: CARE_REPORTED_ERROR,   // bounded constant from errors.ts
        data: {},
        agentName: ctx.agentName,
        conversationId: ctx.conversationId,
      }
    case 'start':
    case 'progress':
    case 'heartbeat':
    case 'data':
    case 'artifact':
      return null                       // ignored this iteration
  }
}
```

### Care client lifecycle inside the bridge

```typescript
async function* streamSupportTurn(input: SupportTurnInput) {
  const session = sessionStore.getOrInit(input.aabConversationId)

  // Construct a fresh client per turn — cookie auth is per-visitor.
  // Cost is a constructor invocation; no I/O.
  const client = new AiroCareClient({
    baseURL,
    executor,
    authenticator: new CookieAuthenticator(`visitor=vid=${input.visitorId}`),
  })

  // 1. Lazy create — only on the very first support turn for this AAB conv.
  if (!session.careConversationId) {
    try {
      const { conversationId } = await client.createConversation({ ucid: session.ucid })
      sessionStore.setCareConversationId(input.aabConversationId, conversationId)
    } catch (err) {
      sessionStore.invalidate(input.aabConversationId)
      yield userFacingErrorChunk(err)
      yield terminalComplete()
      return
    }
  }

  // 2. Callback → async-iterable adapter (internal helper, ~40 lines:
  //    push/close/fail + AsyncIterator protocol + sawResult flag for the
  //    "Care closed without a result event" branch below).
  const queue = createEventQueue<StreamMessageEvents>()
  const streamPromise = client.streamMessage(
    { conversationId: session.careConversationId!, input: { role: 'user', content: input.message } },
    (event) => queue.push(event),
    { signal: input.abortSignal },
  ).then(() => queue.close())
   .catch((err) => queue.fail(err))

  // 3. Drain → translate → yield
  try {
    for await (const event of queue) {
      const translated = translateCareEvent(event, { agentName: 'support', conversationId: input.aabConversationId })
      if (translated) yield translated
    }
    // Translator only emits a terminal 'complete' on Care 'result'. If Care
    // closed the stream without a result event, emit one ourselves.
    if (!queue.sawResult) yield terminalComplete()
  } catch (err) {
    sessionStore.invalidate(input.aabConversationId)
    yield userFacingErrorChunk(err)
    yield terminalComplete()
  } finally {
    await streamPromise.catch(() => undefined)
  }
}
```

### Persistence (inherited, free)

The existing `PersistenceSubscriber` is subscribed to the event channel and captures `chunk` and `complete` events keyed by `conversationId` + the messageId opened by `startAgentTurn`. Support-turn agent responses persist into `conversation_messages` exactly like build-agent responses, with `agentName='support'`. The `origin` column is set by `AgentsMessagePersistence.getOriginFromContext()` from the JWT's `authType` — no new persistence code.

### Memory management

`CareSessionStore` runs a TTL sweep every 5 minutes:
- `lastTouched` is stamped on every `getOrInit` / `setCareConversationId`.
- Sweep removes entries idle for more than 1 hour (`SESSION_TTL_MS`).
- `createCareBridge` starts the interval; bridge teardown clears it (one shutdown handler hooked off `app.ts`).
- Sweep results logged as `care.session_store.swept` with `removed`/`remaining`/`maxAgeMs`.

## Boundaries

**Allowed imports inside `agents/src/care/`:**
- `@airo-care/client`
- `@airo/ai-transport` (StreamingEvent type only)
- `agents/src/logging`
- `node:crypto`

**Forbidden imports inside `agents/src/care/`:**
- `agents/src/server/**` (no upward coupling)
- `agents/src/database/**` (in-memory only)
- `agents/src/agents/**` (not an agent in the factory sense)
- `agents/src/tools/**`
- `express`
- `@airo/ai-lib`

**Outside `agents/src/care/`:**
The only symbols anyone imports from the bridge are those re-exported by `index.ts`. Reaching into `CareSessionStore`, `translator`, etc. directly from outside is forbidden.

## Client dependency

The bridge depends on `@airo-care/client` via the workspace catalog (`pnpm-workspace.yaml` → `catalog:` block → referenced as `"catalog:"` in `agents/package.json`). The published client at version **`1.0.1`** accepts a caller-supplied `AbortSignal` on `streamMessage` (and `signalConversation`, etc.) via a third `RequestOptions` argument:

```typescript
streamMessage(
  params: SendMessageRequest,
  handle: OnStreamEvent,
  options?: { signal?: AbortSignal },
): Promise<void>
```

Internally the SDK composes the caller's signal with its `streamTimeout` AbortController, so either firing triggers fetch abort. The bridge forwards `input.abortSignal` into this options argument; aborts propagate end-to-end and there is no orphan-fetch window after a cancellation.

## Observability

Structured logs at the bridge boundary, all under `care.*`:

| Event | When | Fields |
| --- | --- | --- |
| `care.bridge.disabled` | Factory returns null at startup | `reason` |
| `care.session.created` | First turn for an AAB convId | `aabConversationId`, `ucid` |
| `care.care_conversation.created` | After successful `createConversation` | `aabConversationId`, `careConversationId`, `ucid`, `latencyMs` |
| `care.care_conversation.create_failed` | `createConversation` throws | `aabConversationId`, `ucid`, `...errorFields(err)` |
| `care.stream.started` | About to call `streamMessage` | `aabConversationId`, `careConversationId` |
| `care.stream.event_received` | (debug) per Care event | `aabConversationId`, `eventType`, `eventId` |
| `care.stream.completed` | Translator emits terminal `complete` | `aabConversationId`, `careConversationId`, `totalEvents`, `deltaCount`, `durationMs` |
| `care.stream.errored` | Stream-mid error | `aabConversationId`, `careConversationId`, `...errorFields(err)` |
| `care.stream.aborted` | External signal fired | `aabConversationId`, `careConversationId`, `reason` |
| `care.session_store.swept` | Background TTL sweep | `removed`, `remaining`, `maxAgeMs` |
| `care.session.invalidated` | Failure invalidates a session | `aabConversationId`, `careConversationId`, `cause: 'create_failed' \| 'stream_failed'` |

No new OTel spans. Support turns run inside the existing turn span created in `runTurn`, so they appear in the same trace as the surrounding session. Care's `traceId` (returned by `AgentClientError`) is logged via `errorFields` for cross-system correlation.

## Testing

| Module | Test type | Verifies |
| --- | --- | --- |
| `CareSessionStore.test.ts` | Pure unit | `getOrInit` idempotent; `ucid` persists across reads; `invalidate` drops; `sweep` honors TTL; `lastTouched` updates. |
| `translator.test.ts` | Pure unit | Each `StreamMessageEvents` variant maps to expected `BridgeEvent` or `null`. |
| `identity.test.ts` | Pure unit | `generateUcid()` returns RFC4122-shaped UUIDs. |
| `errors.test.ts` | Pure unit | `AgentClientError` / `NetworkError` / `TimeoutError` each map to expected user-facing copy. |
| `CareBridge.test.ts` | Integration with fake `AiroCareClient` | Happy path (create → stream → translated events → complete). Second turn reuses `careConversationId`. `createConversation` failure → error chunk + complete + session invalidated. Stream-mid error → error chunk + complete + session invalidated. Abort signal → for-await terminates, terminal complete still yielded. |
| `executeSupportUnderTrace` test in `MessageExecutionService.__tests__` | Integration with fake `CareBridge` | Branch fires on `resolvedAgentId === 'support'`. Missing `visitorId` short-circuits. Missing `careBridge` dep short-circuits. Each yielded `BridgeEvent` reaches `eventChannel.publish`. Persistence calls fire (`continueConversation`, `startAgentTurn`, `completeConversation`). `this.abortControllers` lifecycle wired correctly. |

The fake `AiroCareClient` is ~30 lines: a class with `createConversation` returning a configurable response, and `streamMessage` accepting the callback and a script of events to fire (with optional inject-error / inject-abort hooks).

No automated E2E against real Care this iteration. Manual smoke-testing via `pnpm run dev` once `AIRO_CARE_BASE_URL` is set in the dev env.

## Environment configuration

| Env var | Required? | Example |
| --- | --- | --- |
| `AIRO_CARE_BASE_URL` | yes (else bridge is null) | `https://airo.care.dev-godaddy.com` |
| `AIRO_CARE_EXECUTOR` | no (default `v1/orchestrator-test`) | `v1/orchestrator-test` |

Both go through the dev-runner preflight so they auto-populate in `agents/.env` once added to `agents/.env.example`.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `@airo-care/client` future API drift | Bridge pins via the workspace catalog (`pnpm-workspace.yaml`). Version bumps land as a single catalog edit + targeted call-site update if the wire shape changes. |
| Care service down at runtime | Bridge yields user-facing error chunk + complete; session invalidated; next turn retries from scratch. AAB chat keeps functioning. |
| Agent process restart loses session map | Next `/agent support` message creates a fresh Care conversation under a new `ucid`. Previous Care conversation orphans in Care's ASM until its idle timeout. Acceptable. |
| `visitorId` absent on JWT for some token types | Bridge contract requires a non-empty `visitorId`. Intercept site short-circuits with a user-facing chunk and never calls the bridge. Add to follow-up: generate a fallback visitorId server-side for token types that don't carry one. |
| Memory leak via session map | TTL sweep every 5 min removes idle entries (>1h). `care.session_store.swept` log makes growth visible. |
| Caller aborts mid-stream | `abortSignal` is forwarded to the SDK's `streamMessage`; the underlying fetch aborts. The bridge catches the resulting AbortError in its outer catch block, branches on `abortSignal.aborted`, emits a clean terminal complete (finishReason='stop'), and does NOT invalidate the session — preserving Care context for the next turn. |

## Follow-ups (explicitly deferred)

- Intent classification → automatic routing. Replaces the `/agent support` manual-override trigger as the production entry point; the bridge itself does not change.
- IDP token delegation (BFF `/api/auth/support-token` + agents `/internal/token/:siteId` + `X-Delegated-For` to Care).
- `client.closeConversation` lifecycle wired to `ConversationLifecycleStore` close hooks (resolved / disconnected / timeout reasons).
- Transfer-to-human (LiveEngage widget).
- Persist `careConversationId` to SQLite so it survives agent restarts.
- CES bundle integration on the AAB BFF / browser side.
- `/diagnostics/care` route for inspecting the in-memory session map.

## Open questions

None blocking. The single soft assumption is that `process.env.AIRO_CARE_BASE_URL` is the right place to put the URL config rather than threading it through the `local-control-plane` or Switchboard. If we want runtime-tunable routing later, a Switchboard flag can be added without changing the bridge surface.
