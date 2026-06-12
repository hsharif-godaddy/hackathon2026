# Sub-Agent Orchestration: Background Jobs, Reliable Parallelism, and Re-Entry

Status: Implemented (v1) — see "Implementation status" below
Date: 2026-06-11
Supersedes: PR #4807 (sub-agent re-entry / in-memory session cache) — its cache/transcript/staleness logic is folded into the job registry described here.

## Implementation status (v1)

Shipped on `jeichorn/sub-agent-parallelism`:
- Conversation-scoped `SubAgentJobRegistry` + `SubAgentJobRegistryManager` singleton, keyed by `conversationId` (`agents/src/agents/sub-agent-job-registry.ts`); FIFO concurrency cap (4), session TTL (5 min), LRU over 20 sessions and 50 conversations.
- Non-blocking `runAgent` (returns `{ jobId }`) + `awaitAgents([jobId])` join tool (`run-agent.ts`); registered in the tool map and the deep-build orchestrator; orchestrator `maxSteps` raised 50 → 100.
- Re-entry via `continue` / `fromJobId` with mtime staleness warnings and graceful cold-run fallback; transcript capture/truncation ported from #4807.
- Abort plumbing: per-job `AbortController` threaded to `streamGenerate`; **user-stop and recovery-timeout abort in-flight jobs** via a new `onStreamAbort(conversationId, reason)` hook in `@airo/ai-transport` (WS) and direct calls in the SSE `stop()` / no-subscriber paths (Lifecycle §4).
- Both transports populate `conversationId` (WS `attachConversationId`; SSE `executionContext.metadata`).

**Deferred to a follow-up (not in v1):**
- **Auto-inject / server-initiated wake turns** — see "Deferred: auto-inject". Needs a new `injectTurn` primitive; not required for the three core scenarios.
- **WS event-channel replay for sub-agent progress (I1)** — v1 emits `subagent_event`/`debug_turn_stats` through the raw socket emitter, so live progress during a disconnect window is dropped (jobs still complete and are collectable via `awaitAgents`; SSE already routes through the event channel). Routing WS sub-agent events through the buffered `conversation-event-channel` so they replay on reconnect is a follow-up.

## Problem

The current sub-agent system has three coupled deficiencies, all rooted in one design choice: **`runAgent` is a blocking tool that `await`s the sub-agent to completion before returning to the orchestrator** (`agents/src/tools/ai-lib-tools/run-agent.ts`).

1. **Parallelism is implicit and model-dependent.** The AI SDK is not at fault — `ToolLoopAgent` correctly runs the tool calls *within a single assistant step* concurrently (`Promise.all` in `ai`'s `executeTools`), and *across* steps sequentially. The fault is the blocking `await`: two sub-agents overlap only when the orchestrator emits both `runAgent` calls in one assistant message. `prompts/deep-build/core.md:67` instructs the model to batch calls. When model behavior drifts (dispatch one, wait, dispatch the next), parallelism silently degrades to sequential. This is the regression that motivated this work.

2. **No background execution.** Because dispatch blocks, the orchestrator cannot do anything while a sub-agent runs — including hold an interactive conversation. The target scenario "build the design system *while* interviewing the customer about their business" is inexpressible.

3. **No re-entry.** Each `runAgent` constructs a fresh `SubAgentRunner` and discards it. A follow-up edit ("fix the contrast") re-runs a cold sub-agent that re-reads every file and rebuilds context (~120s, ~60–80k tokens for a one-token change). PR #4807 attacked this in isolation with a standalone session cache.

All three share a missing primitive: **a conversation-scoped registry that owns sub-agent runs across the boundaries of a single tool call and a single turn.**

## Goals

- Parallelism that does not depend on the model batching tool calls.
- Background sub-agents that run concurrently with foreground conversation (including interactive takeover).
- Fast re-entry into a prior sub-agent's context for follow-up edits.
- One coherent mechanism for all three, working on both the WebSocket (AAB) and SSE (PaaS) transports.

## Non-Goals (v1)

- **Auto-inject / server-initiated wake turns.** Deferred to v2 (see "Deferred: auto-inject"). v1 collects exclusively via the explicit `awaitAgents` tool. The three target scenarios all work without auto-inject (see Use-case mapping).
- **Nested dispatch.** Sub-agents (`builder`, `design`, …) do not get `runAgent`; only the orchestrator dispatches. Verified: `agents/src/agents/sub-agents/*.ts` tool sets exclude `runAgent`. The registry is flat, single-level per conversation. Nesting (jobs with `parentJobId`) is a future extension.
- **Persisting jobs across process restart.** Jobs are in-memory; lost on restart. In-flight work is restartable. Re-entry degrades gracefully to a cold run when its cached session is gone (see Lifecycle §7).

## Architecture

### Sub-Agent Job Registry (conversation-scoped, transport-agnostic)

One registry instance per `conversationId`, living in the agents process, independent of transport (WS or SSE). It owns every sub-agent run — in-flight and completed — and the cached sessions for re-entry.

```
SubAgentJobRegistry  (per conversationId)
├── jobs: Map<jobId, Job>
│     Job = {
│       id, agent, title,
│       status: 'queued' | 'running' | 'success' | 'error' | 'aborted',
│       promise: Promise<SubAgentResult>,
│       result?, error?,
│       abort: AbortController,
│       startedAt, finishedAt?,
│       emit,                     // conversation event-channel emitter (NOT a raw socket)
│     }
└── sessions: Map<jobId, CachedSession>   // re-entry (folds in #4807)
      CachedSession = { agent, messages, filesRead, filesWritten, lastUsed }
```

Bounds:
- `MAX_CONCURRENT_JOBS = 4` per conversation (in-flight cap; see Lifecycle §6).
- `MAX_SESSIONS = 20` cached sessions (LRU, from #4807).
- `SESSION_TTL_MS = 5 min` inactivity TTL on cached sessions (from #4807).
- `MAX_TRANSCRIPT_TOKENS = 150_000` before truncation (from #4807).

Registry lookup uses `conversationId` from `context.metadata.conversationId` (populated on the WS path by `attachConversationId`; the SSE path must populate the same field — see Affected components). `conversationId` is stable across turns (`setupPersistence` reuses the active conversation), which is the prerequisite that lets external completion callbacks find the right registry.

### Non-blocking dispatch

`runAgent` constructs the `SubAgentRunner`, starts `execute()`, registers the `Job` (storing the promise — **not** awaiting it), and returns `{ jobId, status }` synchronously. The orchestrator's tool loop continues immediately.

Parallelism then falls out regardless of batching: whether the model dispatches three jobs in one step or across three steps, all three promises are already running. The original bug is structurally impossible.

### Event delivery via the conversation event channel

Sub-agent progress (`subagent_event`, `debug_turn_stats`) is emitted through the **conversation event channel** (`packages/ai-transport/src/conversation-event-channel.ts`), keyed by `conversationId`, **not** through a raw `socket.emit` captured at dispatch time. The event channel already buffers events with a TTL equal to the recovery window, so a detached job's progress survives a brief disconnect/reconnect and replays to the new socket. This replaces the current `context.metadata.eventEmitter` (raw socket wrapper) for sub-agent events.

### Collection — `awaitAgents` (v1)

`awaitAgents([jobId…])` is a normal blocking tool that awaits the registry promises and returns each job's `{ jobId, agent, status, summary, artifacts, error }`. It blocks only at this join point. This is the synchronization barrier ("don't start the pages phase until design + brief are both done"). It resolves transparently for jobs that are still `queued` behind the concurrency cap — the promise settles once the job dequeues, runs, and finishes.

### Tool surface

| Tool | Blocking? | Purpose |
|------|-----------|---------|
| `runAgent(agent, title, task, inputs, continue?, fromJobId?)` | No | Dispatch one job (detached). Returns `{ jobId, status }`. `continue:true` → re-entry from a cached session (see §7). |
| `awaitAgents(jobIds[])` | Yes (at join) | Block for those jobs; return per-job results/status/errors. |
| `checkAgents()` | No | Non-blocking snapshot of all jobs' statuses (poll). **Optional** — ship only if needed (see Open questions). |

The `runAgents` batch idea is **dropped** — it would reintroduce "parallelism via one call." Interactive mode (`mode:'interactive'`) is unchanged and remains a separate takeover path (not a background job).

### Use-case mapping (all work in v1 without auto-inject)

- **Parallel build phase:** `runAgent`×3 → `awaitAgents([all three])`.
- **Build-while-interview:** `runAgent(design)` (detached) → `runAgent(interview, mode:'interactive')` (foreground takeover). When the interview finishes, `interactiveSubAgentManager.handleReturn` calls `switchAgent(socketId, parentAgentName, summary)` (`interactive-sub-agent-manager.ts:86`), which **starts a fresh parent orchestrator turn**. The parent then calls `awaitAgents([design])` (likely already done). No server-initiated wake required.
- **Follow-up tweak:** `runAgent(design, continue:true, fromJobId:'d1', task:'fix contrast')` → fast re-entry.

## Lifecycle

1. **Turn ends with jobs in-flight.** The detached promise is held by the registry, not the ended `streamGenerate`, so it keeps running. v1 surfacing: the orchestrator collects via `awaitAgents` within the same turn, or on the next turn (e.g., interview-return, or the user's next message). If the orchestrator ends a turn with uncollected jobs and nothing resumes it, those results wait in the registry until the next turn — acceptable for v1; the v2 auto-inject backstop closes this gap.

2. **Interactive takeover.** The interview owns the chat stream while it runs; the detached design job streams progress through the event channel (separate from the chat stream, unaffected by takeover). Parent resumes via `handleReturn` → `switchAgent` (above). In v1 there is no competing server-initiated turn to coordinate, so the v1 design sidesteps the idle/interactive-detection complexity entirely (that complexity returns only with v2 auto-inject).

3. **Disconnect — tied to the recovery window, NOT the raw disconnect event.** The transport keeps the orchestrator stream alive for `STREAM_RECOVERY_WINDOW` (2 min, `experimental-websocket-server.ts:538`) to allow reconnection. Aborting jobs on the raw `disconnect` event would regress this load-bearing feature. Instead: registry lifetime tracks the recovery window. On disconnect, jobs keep running and emit through the buffered event channel; on reconnect within the window they replay. Only at recovery-timeout expiry (the same callback that aborts the orchestrator stream) does the registry abort in-flight jobs and clear. SSE has no equivalent long-lived stream recovery; its registry is cleared when the SSE request/connection terminates (see Affected components).

4. **Cancellation (stop button).** User stop aborts all in-flight jobs for the conversation via their `AbortController`s. Requires threading a signal through `SubAgentRunner.execute({ signal })` → `streamGenerate({ abortSignal })`. `streamGenerate` already accepts and forwards `abortSignal` (`agent-factory.ts:1123,1310`); `SubAgentRunner.execute` currently passes only `{ executionContext }` (`sub-agent-runner.ts:159`) and needs the signal added.

5. **Error surfacing — contract change.** Today, when a sub-agent fails, `run-agent.ts` `throw`s from the tool function; the AI SDK catches it and hands the orchestrator a `tool-error` message (it does not abort the turn — the model already sees the failure as tool-error content). Under detached dispatch the tool returns *before* the job finishes, so it cannot surface the failure that way. Failures instead surface at the **join**: `awaitAgents` returns `{ status:'error', error }` per job (structured, not thrown). This is a deliberate change in *how* the model sees the error (structured join result vs. tool-error part) and must be reflected in `core.md`.

6. **Concurrency cap — queue FIFO.** Cap in-flight jobs at `MAX_CONCURRENT_JOBS = 4` per conversation. `runAgent` past the cap registers a `status:'queued'` job that starts when a slot frees. Because running jobs are bounded and always settle, queued jobs always drain, so `awaitAgents([queuedJob])` cannot deadlock on the cap. The one residual hazard — a *second concurrent orchestrator turn* filling all slots so a queued job from the first turn starves — is prevented by `queueMessage` serialization (per socket, only one turn runs at a time) and is structurally absent in v1 since there are no server-initiated turns.

7. **Re-entry keying — refinement over #4807, with graceful fallback.** #4807 keys cached sessions by `(conversationId, agent)`, assuming one run per agent type — which breaks when parallel same-type agents run (3 builders: whose transcript wins?). Resolution: **cached sessions are keyed by the completed `jobId`.** `runAgent(continue:true)` takes `fromJobId` to reference a specific prior run; when omitted and exactly one completed job of that agent type exists, it resolves to that one, otherwise it errors asking for `fromJobId`. **If the referenced session is absent** (TTL expiry, LRU eviction, or process restart — the jobId is in conversation history but not in the in-memory registry), `continue` **falls back to a cold run** and notes it in the result, rather than failing. Staleness detection (mtime-based `filesRead`/`filesWritten`) and turn-boundary transcript truncation from #4807 are preserved, now on the registry's `CachedSession`.

## Budget and observability for detached jobs

- **Budget accounting.** Sub-agent token usage is emitted at job completion. Because a detached job can finish *after* the dispatching orchestrator turn's `onBudgetReport` has already fired, its cost will not appear in that turn's budget report. v1 attributes detached-job cost to the conversation at job-completion time (best-effort, out-of-band) and documents that per-turn budget reports may undercount work still in flight. Tightening this (e.g., holding the budget report open until jobs settle) is out of scope for v1.
- **Tracing.** Each job's trace context is captured at dispatch. A job that outlives its dispatching turn will trace under that turn's `conversationId`/trace, which is acceptable (the conversationId is stable) but means the span can appear to belong to an earlier turn. Noted, not solved, in v1.

## What carries over from #4807

Reused as-is, relocated onto the registry:
- Transcript extraction from AI SDK `steps[last].response.messages` (verified in #4807's spike).
- Turn-boundary truncation at `MAX_TRANSCRIPT_TOKENS` (preserves tool-call/result pairing).
- mtime-based staleness detection over `filesRead` / `filesWritten`.
- TTL + LRU bounds on cached sessions.

Changed:
- Cache key `(conversationId, agent)` → **`jobId`**, with cold-run fallback (§7).
- Standalone `sub-agent-session-cache.ts` + `sub-agent-transcript.ts` → registry owns the cache map; transcript/staleness helpers stay as pure functions.
- `continueExecution()` still creates a fresh `AgentWrapper` and replays `messages` (#4807's no-reuse decision stands).

## Affected components

- **New:** `agents/src/agents/sub-agent-job-registry.ts` — registry (jobs + sessions + FIFO concurrency queue + bounds), transport-agnostic, keyed by `conversationId`.
- **Rewrite:** `agents/src/tools/ai-lib-tools/run-agent.ts` — non-blocking dispatch; add `awaitAgents` (and optional `checkAgents`) tools; `continue`/`fromJobId` re-entry; emit via event channel.
- **Modify:** `agents/src/agents/sub-agent-runner.ts` — thread `AbortSignal` into `execute`/`streamGenerate`; capture transcript + file access on completion (#4807).
- **Keep (pure helpers):** `sub-agent-transcript.ts` (extraction/truncation/staleness).
- **Modify:** `agents/src/server/ai-lib-websocket-server.ts` — registry create/lookup per conversation; tie abort+clear to the recovery-timeout callback (not the disconnect event); route sub-agent events through the event channel.
- **Modify:** `agents/src/server/sse/MessageExecutionService.ts:1697,1738` — populate `conversationId` for registry lookup; register/clear the registry on SSE connection lifecycle (clear on request/connection end; no 2-min recovery window).
- **Modify:** `agents/src/agents/deep-build-agent.ts:60` — raise orchestrator `maxSteps` (50 → ~100) so multi-phase dispatch + `awaitAgents` coordination steps don't exhaust the loop.
- **Modify:** `agents/src/prompts/deep-build/core.md` — replace "multiple calls in one response run concurrently" with the dispatch → `awaitAgents` contract; document background + re-entry patterns and the structured-error-at-join contract.

## Deferred: auto-inject (v2)

Auto-inject would let a job that finishes while the conversation is idle push a fresh orchestrator turn with a synthetic prompt ("background job d1 finished …"), so the orchestrator never has to remember to join. It is deferred because it requires a **new server primitive that does not exist today**: a public `injectTurn(socketId, message)` that runs the real user-message turn path. `handleChatMessageInternal` is `private` and takes a real Socket.IO `socket` (it makes direct `socket.emit` calls with ACK callbacks — `experimental-websocket-server.ts` ~701/723/2137), so it cannot be driven from a `conversationId` + string alone. v2 must design that primitive and the idle/interactive gating (idle = state manager says no active stream AND `interactiveSubAgentManager.hasActiveSession` is false), then wire job-completion → `queueMessage(injectTurn)`.

## Risks

- **Recovery-window coupling (v1's main integration risk).** Registry lifetime must hook the recovery-timeout callback, not the disconnect event. Getting this wrong either regresses reconnection (aborting too early) or leaks jobs/memory (never aborting). Mitigation: single ownership in the same code path that already aborts the orchestrator stream at timeout.
- **SSE lifecycle parity.** SSE lacks the WS recovery window; its registry teardown is on connection end. Mitigation: explicit SSE lifecycle wiring in `MessageExecutionService.ts`; test both transports.
- **Orchestrator forgets to join (v1).** With explicit `awaitAgents` only, a turn could end leaving jobs uncollected. Mitigation: `core.md` makes "dispatch → await before depending on results" explicit; results persist in the registry for the next turn. v2 auto-inject removes the gap entirely.
- **Budget undercount.** Detached-job cost can land after the turn's budget report (documented limitation above).
- **Token blowout.** Detached dispatch lowers spawn cost. Mitigation: `MAX_CONCURRENT_JOBS` + FIFO queue + usage emission per job.

## Testing

- **Unit (registry):** non-blocking dispatch returns immediately; FIFO cap queues correctly and drains; abort propagates; re-entry resolves `fromJobId`; ambiguous `continue` errors; absent session → cold-run fallback; TTL/LRU eviction.
- **Unit (runner):** transcript capture from steps; staleness mtime comparison; truncation preserves tool-call/result pairing; abort signal honored mid-stream.
- **Integration (WS):** dispatch 3 jobs across separate steps → assert overlapping execution windows; `awaitAgents` returns all. Background design + interactive interview → both progress concurrently; design collected on interview-return turn. Follow-up `continue:true` → fewer tool calls than cold run.
- **Integration (SSE):** same dispatch/await flow on the SSE path; registry cleared on connection end.
- **Lifecycle:** disconnect during recovery window → jobs survive + events replay on reconnect; recovery-timeout expiry → jobs aborted + registry cleared; stop button aborts; failed job → structured error at join (not thrown).
- **Budget:** detached-job usage is emitted at completion even after the dispatching turn ended.

## Open questions

- Auto-inject batching (v2): coalesce multiple near-simultaneous completions into one wake turn, or one per job? (Lean: coalesce.)
- `checkAgents()` necessity: ship `awaitAgents` first; add `checkAgents` only if the orchestrator needs non-blocking status.
- Should v1 raise the orchestrator `maxSteps` to exactly 100, or measure a typical multi-phase build first and set it from data? (Lean: bump to 100 now, revisit with telemetry.)
