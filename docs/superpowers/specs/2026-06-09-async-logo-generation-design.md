# Async Logo Generation — Design Spec

- **Date:** 2026-06-09
- **Status:** Approved design, pending implementation plan
- **Scope:** AiroAppBuilder (AAB) only — `generate_logo` already hard-errors for PaaS (`agents/src/skills/media-logo/tools/index.ts:395-403`), and the whole delivery layer (WebSocket push, preview iframe, chat renderer) is AAB-UI.
- **Author:** brainstormed via codebase analysis (see "Analysis provenance" at end)

## 1. Problem

`logoService.generate()` (`agents/src/services/LogoService.ts`) is a single synchronous HTTP `POST /api/logo/create` call that blocks **30–240s**. Today both logo entry points (`generate_logo`, `set_venture_logo`) `await` it inline, so the agent's turn stalls for the full duration before the user gets any feedback and before the logo appears on the site.

We want the agent to **kick off logo generation in the background and continue immediately**, using an animated shimmer placeholder on the website/chat until the real logo is ready. On completion the media slots + chat card + website preview update in place. Failures auto-retry (transient) and are surfaced. The user can cancel mid-way and revert. The agent always knows the current logo status.

## 2. Goals / Non-goals

**Goals**
- Non-blocking logo generation; agent proceeds with a usable placeholder.
- Shimmer placeholder usable on the **live website preview** (not just chat) for the requested layouts.
- In-place completion: slot update → preview refresh + chat card swap, no new chat message.
- Supersede, auto-retry-transient, cancel-with-revert, durable status the agent can recall.
- Extensive logging at every step for debuggability.

**Non-goals**
- PaaS support (out of scope; tool already errors there).
- A UI "Generate Logo" button outside chat / a BFF route (logo is agent-triggered only).
- A REST status-poll endpoint (delivery is covered by WS + SSE + slot-backed images + per-turn status injection).
- Changing the upstream logo API contract.

## 3. Decisions (resolved with stakeholder)

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | Async architecture | Mirror the existing **video async pattern**: durable workspace file `.airo/logo.json` + fire-and-forget background worker + `emitToApp`(WS) + SSE push + new client `LogoHandler`. **No polling loop** (single upstream call) and **no REST endpoint**. |
| 2 | Tool contract | `generate_logo` returns immediately with a `started` ack; the 240s blocking timeout is removed from the tool. |
| 3 | Placeholder hosting | One static animated `airo-logo-shimmer.svg` written once under `/airo-assets/uploads/`; **only the requested layouts'** slots are pre-created and pointed at it. |
| 4 | Concurrency | **Supersede** via a per-job `jobId` token. A late-completing superseded job is dropped before it writes slots. |
| 5 | Failure | **Auto-retry transient** (timeout/abort/5xx/network) ~2× with backoff; **surface hard errors** (402 budget, other 4xx) immediately. |
| 6 | Regeneration UX | **Show the shimmer** while regenerating; **snapshot the full prior slot** first so it can be restored. |
| 7 | Fresh-failure / cancel revert | Regeneration → **restore snapshot**; fresh logo (no prior) → **remove the placeholder slot**. |
| 8 | Cancel trigger | **UI Cancel button** on the "Generating logo…" card → **`cancel_logo_generation` socket event** (mirrors existing `stop_generation`) → abort in-flight job + flip token + revert + emit. |
| 9 | Agent awareness | A **context provider** injects `.airo/logo.json` status into the agent's ambient context each turn (durable file = source of truth, avoiding the memory-context 5-min cache staleness issue). |

## 4. Architecture overview

The reference implementation is the **video launch feature**:
`agents/src/tools/video-generation-tool.ts` (durable `.airo/video.json`, non-blocking `startGeneration`, `emitVideoEvent` → `emitToApp` + SSE), `agents/src/server/ai-lib-websocket-server.ts:3345-3392` (`emitToApp` + `isAppEligibleForEmit` tenant check), client `app/src/hooks/websocket/handlers/VideoHandler.ts` + `app/src/hooks/shared/videoNotification.ts`.

Logo differs from video in one simplifying way: the upstream logo API is a **single blocking call that returns all requested layouts at once**, so there is **no external job to poll**. The background worker simply runs the (retrying) call, then writes the slots and emits. One job → multiple slots.

```
generate_logo tool (agent turn)
  ├─ mint jobId, write .airo/logo.json (queued)        ── supersedes any prior job
  ├─ ensure shimmer asset; pre-create requested slots  ── snapshot prior slot(s)
  ├─ register AbortController in in-memory job registry
  ├─ fire LogoGenerationService.run(jobId) (detached)  ── .catch(log)
  └─ return { started:true, jobId, slots, status:'queued' }   ← agent continues

LogoGenerationService.run(jobId)  [background]
  ├─ status → generating
  ├─ logoService.generate(signal)  with transient retry ×2
  ├─ supersede guard: re-read .airo/logo.json; if jobId != current → drop
  ├─ saveLogoToSlots() → status completed
  └─ emit { type:'logo', status:'completed', slots }  (WS + SSE)

cancel_logo_generation { appId, jobId }  [WS handler]
  ├─ abort the registered controller
  ├─ flip token (status cancelled), revert slots (restore snapshot / remove fresh)
  └─ emit { type:'logo', status:'cancelled', slots }

client LogoHandler (type:'logo')
  ├─ completed → RELOAD_MEDIA_SLOT per slot (preview swap) + store completion (appId/jobId)
  ├─ failed/cancelled → toast + store flag (card reverts/errors)
  └─ chat card reads completion store → swaps shimmer → grid in place
```

## 5. Data model

### 5.1 `.airo/logo.json` (durable job state, workspace file)

```jsonc
{
  "jobId": "uuid",                  // generation/supersede token
  "status": "queued|generating|completed|failed|cancelled",
  "prompt": "palette-suffixed prompt",
  "layouts": ["horizontal"],        // exactly the requested layouts
  "slots": ["logo/horizontal"],     // slot paths this job owns (derived from layouts)
  "referenceUrl": "https://…",      // optional (edits)
  "isRegeneration": true,           // were any target slots already a real logo?
  "previousSlots": {                // snapshot for revert; only for slots that held a real logo
    "logo/horizontal": { /* full MediaSlot: currentUrl, alternatives, *UrlMap, logoSourceMap, createdAt, userModified */ }
  },
  "attempt": 0,
  "sessionId": "…",                 // from upstream response (on success)
  "logoId": "…",
  "error": "…",                     // on failure
  "createdAt": "ISO",               // never mutated after creation
  "updatedAt": "ISO"                // bumped on every status write
}
```

`createdAt` is set once; `updatedAt` bumped on every write (matches video's invariant). The file is the single source of truth for status, supersede checks, restart rediscovery, and the agent context provider.

### 5.2 Slot marker fields (manifest `MediaSlot`)

Pre-created/regenerating logo slots carry a transient marker so the renderer/website can distinguish a placeholder from a real logo:
- `pendingJobId: string` — set when the slot is showing the shimmer / mid-regeneration; cleared on completion, cancel, or failure.

`currentUrl` for a pre-created (fresh) slot = `/airo-assets/uploads/airo-logo-shimmer.svg`. For a regenerating slot we **also** swap `currentUrl` to the shimmer (decision #6) but keep `previousSlots` in `.airo/logo.json` for restore.

## 6. Component design

### 6.1 `generate_logo` tool refactor — `agents/src/skills/media-logo/tools/index.ts`

Replace the inline `await logoService.generate()` + `saveLogoToSlots()` (current lines ~430-492) with a non-blocking kickoff:

1. Resolve app context, palette-suffixed prompt, and `referenceUrl` auto-resolution — **unchanged** (existing lines ~95-235).
2. Derive `slots` from `layout` only (`'all'` → all three; otherwise the single requested slot). Uses existing `LOGO_SLOT_PATHS` (`index.ts:72-76`).
3. Mint `jobId` (uuid). Read `.airo/logo.json`: if an in-flight job exists, this call **supersedes** it (log + abort its controller).
4. Ensure the shimmer asset exists (§6.2). For each target slot: snapshot the prior slot into `previousSlots` if it currently holds a real logo (`pendingJobId` absent and `currentUrl` not the shimmer), then `setSlot()` → `currentUrl = shimmer`, `pendingJobId = jobId`, `mediaType:'logo'`.
5. Write `.airo/logo.json` (`queued`). Register `{ jobId, controller }` in the in-memory job registry keyed by `appId`.
6. Fire `logoGenerationService.run({ appId, jobId, … })` detached with `.catch(err => logger.error('logo.worker.unhandled', …))`.
7. Return `{ text: <i18n "started" message>, structuredContent: { started:true, jobId, slots, status:'queued' } }`. **Remove** the 240s `config.timeout` on the tool (it no longer blocks).

The tool remains non-stop-after; the agent continues and can place `/airo-assets/images/logo/<slot>` immediately.

### 6.2 Shimmer asset + slot pre-creation

- **Asset:** a single committed animated SVG (CSS/SMIL shimmer), written **idempotently** into the uploads dir on first need so the Go resolver serves it from disk (the resolver rejects inline-SVG/`data:`/empty `currentUrl` with HTTP 500 — `dev-supervisor/internal/proxy/http/image_slots.go:232-238`; only allowlisted HTTPS hosts or `/airo-assets/uploads/*` are served). Path served at `/airo-assets/uploads/airo-logo-shimmer.svg`. Shared by all slots → **no per-job cleanup**. Writer logs `asset_written` vs `asset_exists`.
- **Pre-creation scoped to requested layouts only** (decision #3 + stakeholder note). A horizontal-only job never creates/touches `logo/primary` or `logo/vertical`.

### 6.3 `LogoGenerationService` (new) — background worker

New module `agents/src/services/LogoGenerationService.ts` (or `agents/src/tools/logo-generation-job.ts`), plus an in-memory registry:

```ts
// keyed by appId; one active logo job per app (supersede semantics)
const inFlight = new Map<string, { jobId: string; controller: AbortController }>()
```

`run({ appId, jobId, input })`:
1. Set status `generating`.
2. `await logoService.generate({ …input, signal })` with retry: transient (`TimeoutError`/`AbortError`-from-timeout/5xx/network) → up to 2 retries with backoff (e.g. 1s, 3s); `BudgetExceededError`(402)/other 4xx → no retry. A cancel-driven `AbortError` is **not** retried — it routes to the cancel/revert path.
3. **Supersede guard:** re-read `.airo/logo.json`; if `jobId !== current.jobId` → drop (no slot write, no emit), log `superseded_drop`.
4. Success → `saveLogoToSlots()` (existing merge logic, `index.ts:243-329`) for the requested layouts; clear `pendingJobId`; status `completed` (+ `sessionId`, `logoId`); de-register from `inFlight`.
5. Emit completion (§6.5).
6. Final failure → status `failed` + `error`; revert slots (§6.6 — restore snapshot or remove fresh); de-register; emit failure.

`logoService.generate()` already accepts the upstream timeout; extend it (§6.4) to also honor an **external** `AbortSignal` for prompt cancellation.

### 6.4 `LogoService.generate()` AbortSignal extension — `agents/src/services/LogoService.ts`

Add an optional `signal?: AbortSignal` to `GenerateLogoInput`. Combine with the existing timeout: `signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), input.signal].filter(Boolean))`. The existing `DOMException` `TimeoutError`/`AbortError` handling (lines 186-199) distinguishes timeout vs external abort (caller passes which controller fired). Core logic otherwise unchanged.

### 6.5 Completion / status push

Mirror `emitVideoEvent` (`video-generation-tool.ts:626-643`) with **dual transport**:
- WS: `emitToApp(appId, 'message', { type:'logo', content:'', data:{ status, jobId, slots, appId, error? } })`.
- SSE: `sseRegistry.sendEvent(appId, 'logo', { status, jobId, slots, appId, error? })` (iterates `getConversationsByApp(appId)`).

`emitToApp` already enforces tenant isolation via `isAppEligibleForEmit` (authenticated socket + app match). Statuses emitted: `completed`, `failed`, `cancelled`. Events are fire-and-forget; the durable file + slot-backed images make reconnects self-healing (no recovery-channel buffering needed).

### 6.6 Cancel + revert

- **Client:** Cancel button on the "Generating logo…" card → streaming controller emits `socket.emit('cancel_logo_generation', { appId, jobId })`.
- **Server handler** (in `agents/src/server/ai-lib-websocket-server.ts`, beside `stop_generation`): validate `appId` ownership (existing per-message validation), look up `inFlight.get(appId)`; if present and `jobId` matches: `controller.abort()`, set `.airo/logo.json` `cancelled`, **revert slots** (see helper), clear `pendingJobId`, de-register, emit `{ type:'logo', status:'cancelled', slots }`. If no in-flight job → log `cancel.not_found` (idempotent no-op).
- **Revert helper** (shared by cancel and final-failure paths):
  - *Regeneration* (a `previousSlots` snapshot exists for the slot): `setSlot()` to restore the full prior `MediaSlot`.
  - *Fresh placeholder* (no snapshot): **delete the manifest entry** for the slot so the resolver returns 404 ("slot not found") rather than 500 on an empty `currentUrl`. `MediaManifestService` exposes `setSlot`/`updateSlot`/`importSlot`/`updateSlotWithUpload` but **no confirmed delete** — implementation must add a `removeSlot(appId, slotPath)` method (atomic read-modify-write + git commit, same pattern as `setSlot`) rather than writing an empty/invalid `currentUrl`.

### 6.7 `set_venture_logo` status-awareness — `index.ts:505-562`

Before reading `logo/horizontal` + `logo/primary`, check `.airo/logo.json`: if a job is in flight (`queued`/`generating`), return `structuredContent: { pending:true }` (i18n "logo still generating") so the agent waits rather than pushing shimmer URLs to the dashboard. When slots are ready, behavior is unchanged (`{ horizontalUrl, squareUrl }`). No async generation needed (it doesn't generate).

### 6.8 Agent status context provider (new)

A lightweight provider reads `.airo/logo.json` and injects one ambient line per turn (e.g. "Logo generation: in progress (started 35s ago)" / "completed" / "failed: <reason>" / "cancelled"), wired like `buildMemoryContextMessage` (`agents/src/server/context-builders.ts:254-276`) with `insertionOrder:'after_history'`. Reading the durable file each turn avoids the memory-context cache (`memory-context-provider.ts`, 5-min TTL not invalidated by background writes). The tool's own rediscovery on the next `generate_logo` call handles the "already completed/cached" case.

### 6.9 Client `LogoHandler` + notification

- New `app/src/hooks/websocket/handlers/LogoHandler.ts` (`readonly type = 'logo'`) → `handleLogoNotification`. Register in `app/src/services/websocket/TransportSupervisor.ts` (`setupEventHandlers`, beside `VideoHandler` at ~line 427) and export from `app/src/hooks/websocket/handlers/index.ts`. SSE parity in the SSE client path.
- New `app/src/hooks/shared/logoNotification.ts` (mirror `videoNotification.ts`): on `completed` → for each slot, `postMessageToIframe({ type:'RELOAD_MEDIA_SLOT', slotPath })` (preview swap) and write `{ jobId, slots, status }` to a completion store keyed by `appId`; on `failed`/`cancelled` → Growl toast (i18n) + store flag.

### 6.10 Chat renderer — `LogoGeneratorToolRenderer.tsx` / `LogoGridWidget.tsx`

Today the placeholder keys on `toolStatus`. Because the tool now completes immediately with `started:true` (logos not yet ready):
- Show the shimmer/"Generating logos…" state when `structuredContent.started === true` **and** the completion store has no matching `jobId` yet.
- On matching completion in the store → swap **in place** to the grid, sourced from the slot URLs (`/airo-assets/images/logo/<slot>`), not from the tool result (which no longer carries URLs). Keyed by `jobId` from the `started` ack.
- Render a **Cancel button** during the pending state → emits `cancel_logo_generation`. On `cancelled`/`failed` store flag → card reverts to prior/empty + shows the error/cancel message.

## 7. End-to-end flows

- **Happy:** kickoff → shimmer slots → `started` ack → agent continues → worker generates (retry transient) → supersede-guard ok → `saveLogoToSlots` → `completed` → WS/SSE → `LogoHandler` reloads slots + stores completion → card swaps to grid; preview shows the logo.
- **Supersede:** second `generate_logo` mints a new `jobId`, aborts the prior controller, overwrites `.airo/logo.json`. The old job, if it returns, fails the supersede guard and drops silently.
- **Retry:** transient upstream error → backoff retry (≤2) with `attempt` bumped in the file; exhausted → failure path.
- **Failure:** `failed` + error in file; fresh slot removed / regeneration restored; WS/SSE `failed`; card shows error + retry offer (agent-driven); agent context shows failed next turn.
- **Cancel:** Cancel button → socket event → abort + revert + `cancelled` emit → card/preview revert to "what was there".
- **Restart / reconnect:** process restart mid-job → lazy rediscovery (next `generate_logo` call, plus optional startup sweep) marks a stale `generating` (`updatedAt` > 5 min) job `failed`. WS drop mid-job → SSE and/or slot-backed images reconcile; the agent's next turn reads fresh status from the file.

## 8. Logging plan (debuggability — emphasized requirement)

Convention: `logger.<level>("logo.<operation>.<lifecycle>", { camelCaseFields })`, consistent with the existing `logo.generate.*` events in `LogoService.ts`. Always include `appId` + `jobId` where available so logs can be filtered per app/job in Grafana Loki (`{job="airo-agents"} |= "\"jobId\":\"<id>\""`).

**Agents — kickoff & slots**
| Event | Level | Fields |
|---|---|---|
| `logo.async.kickoff` | info | appId, jobId, layouts, slots, hasReference, isRegeneration |
| `logo.async.superseded_previous` | warn | appId, previousJobId, newJobId |
| `logo.shimmer.asset_written` / `logo.shimmer.asset_exists` | info/debug | appId, path |
| `logo.slots.precreate` | info | appId, jobId, slots |
| `logo.slots.snapshot` | debug | appId, jobId, slot |
| `logo.metadata.write` | debug | appId, jobId, status, attempt |
| `logo.async.return_ack` | info | appId, jobId, slots |

**Agents — background worker**
| Event | Level | Fields |
|---|---|---|
| `logo.worker.begin` | info | appId, jobId, attempt |
| `logo.worker.retry` | warn | appId, jobId, attempt, reason, delayMs |
| `logo.worker.superseded_drop` | warn | appId, jobId, currentJobId |
| `logo.worker.slots_saved` | info | appId, jobId, slots, savedSlots, droppedLayouts |
| `logo.worker.complete` | info | appId, jobId, sessionId, logoId, durationMs |
| `logo.worker.budget_exceeded` | warn | appId, jobId |
| `logo.worker.failed` | error | appId, jobId, attempt, errorKind, error |
| `logo.worker.unhandled` | error | appId, jobId, error (detached `.catch`) |

**Agents — emit**
| Event | Level | Fields |
|---|---|---|
| `logo.emit.ws` | info | appId, jobId, status, socketCount |
| `logo.emit.sse` | debug | appId, jobId, status, conversationCount |
| `logo.emit.no_targets` | warn | appId, jobId, status |

**Agents — cancel / revert / status**
| Event | Level | Fields |
|---|---|---|
| `logo.cancel.received` | info | appId, jobId |
| `logo.cancel.aborted` | info | appId, jobId |
| `logo.cancel.not_found` | warn | appId, jobId |
| `logo.revert.restore` | info | appId, jobId, slots |
| `logo.revert.remove_placeholder` | info | appId, jobId, slots |
| `logo.cancel.complete` | info | appId, jobId |
| `logo.status.rediscover_stale` | warn | appId, jobId, ageMs |
| `logo.status.context_inject` | debug | appId, status, jobId |
| `logo.set_venture.pending` | info | appId, jobId |

**App (client)** — via the app logger (and console for dev):
| Event | Level | Fields |
|---|---|---|
| `logo.client.event_received` | info | appId, jobId, status |
| `logo.client.preview_reload` | debug | appId, slotPath |
| `logo.client.completion_stored` | debug | appId, jobId, slots |
| `logo.client.cancel_clicked` | info | appId, jobId |
| `logo.client.unknown_event` | warn | appId, raw |

## 9. Error-handling matrix

| Condition | Detection | Handling |
|---|---|---|
| Transient upstream (timeout/5xx/network) | exception kind in worker | retry ≤2 w/ backoff; then failure path |
| Budget exceeded (402) | `BudgetExceededError` | no retry; `failed` + i18n budget message; revert |
| Empty/invalid upstream response | existing `LogoService` throws | `failed`; revert |
| Slot save partial failure | `saveLogoToSlots` `failedLayouts` | log `slots_saved` w/ `droppedLayouts`; complete for saved slots; surface partial state |
| Superseded job returns | supersede guard | drop silently (`superseded_drop`) |
| User cancel | abort signal | `cancelled`; revert |
| Process restart mid-job | stale `generating` on rediscovery | mark `failed` (`rediscover_stale`) |
| WS disconnected at completion | n/a | SSE + slot-backed images + next-turn status reconcile |

## 10. Testing plan

- **Agents unit (`generate-logo.test.ts`):** rewrite "output shape" → assert `{ started:true, jobId, slots, status:'queued' }`; assert only-requested-layout slots pre-created with shimmer + `pendingJobId`; snapshot taken for regeneration. New `LogoGenerationService` tests (mock `logoService`): transient retry, supersede-drop guard, completion `saveLogoToSlots` + emit, failure revert (fresh remove vs snapshot restore), budget no-retry, cancel/abort revert.
- **Agents unit (`set-venture-logo.test.ts`):** add `pending:true` path when a job is in flight; existing ready-path assertions unchanged.
- **Agents unit:** `.airo/logo.json` read/write/rediscovery; shimmer-asset idempotent writer; context-provider injection string per status; `cancel_logo_generation` handler (ownership, abort, revert, idempotent not-found).
- **App unit:** `LogoHandler`/`handleLogoNotification` (completed → RELOAD_MEDIA_SLOT per slot + store; failed/cancelled → toast + flag); `LogoGeneratorToolRenderer` started-ack placeholder, in-place swap from completion store, Cancel button emits event; completion store keyed by appId/jobId.
- **E2E (`tests/regression/develop-media.spec.ts`):** un-skip + update the logo-grid spec for the async flow (placeholder → completion → slot swap → Brand Book). Audit `data-testid`s on `LogoGridWidget`/`LogoGeneratorToolRenderer` and add ones for the placeholder + Cancel button; update selectors per CLAUDE.md E2E rule.

## 11. i18n

New `@airo-app-builder/aab` keys (created at i18n.int.gdcorp.tools before commit — pre-commit validates): logo generation started, generating, ready, failed (+ retry offer), retrying, budget-exceeded, cancelled/reverted, "logo still generating" (set_venture). Exact key names finalized during implementation.

## 12. Security / tenant isolation

- `cancel_logo_generation` handler reuses the WebSocket's per-message `appId` ownership validation (`agents/CLAUDE.md` tenant isolation).
- `emitToApp` already gates on `isAppEligibleForEmit` (authenticated socket + app match).
- `.airo/logo.json` and slot writes go through `mediaManifestService`/workspace APIs scoped by `app.path` (`findById`) — no cross-tenant access.

## 13. Rejected alternatives

- **New SQLite `logo_generation_jobs` table + client polling** — more infrastructure, divergent from the established media-async pattern; the durable file already survives restarts.
- **In-memory promise + memory-KV status** — lost on restart; memory-context 5-min cache isn't invalidated by background writes, so the agent could report stale status.
- **Inline-SVG/`data:` shimmer in the slot** — rejected by the Go resolver (HTTP 500).
- **REST `routes/logo.ts` to start generation** — unneeded; logo is triggered inside the agent loop on the live socket (unlike video's UI-button launch feature).
- **DELETE endpoint for cancel** — socket event chosen instead (mirrors `stop_generation`, no new REST/BFF surface). Revisit if debug-console visibility is wanted.

## 14. Open risks

- Process restart during the 30–240s window loses the in-memory `AbortController`; rediscovery marks the job failed (window is small but real). Acceptable.
- `saveLogoToSlots` stale variant-map keys accumulate on repeated regenerations (pre-existing behavior, not introduced here).
- A shimmer SVG served as a file must return the correct `image/svg+xml` content-type from the resolver/disk path — verify during implementation.

## Analysis provenance

Design grounded in three fan-out codebase analyses (21 agent investigations): the media-slot/manifest system (`MediaManifestService.ts`), the chat logo renderer (`LogoGeneratorToolRenderer.tsx`/`LogoGridWidget.tsx`), preview refresh (`PreviewPane.tsx` + `RELOAD_MEDIA_SLOT`), background-task lifecycle (`ProjectImportService`, one-process-per-app), the **video async precedent** (`video-generation-tool.ts`, `routes/video.ts`, `VideoHandler.ts`), the dev-supervisor image resolver constraints (`image_slots.go`), trigger paths (video UI-button vs agent tool; logo agent-only), and cancellation affordances (`stop_generation`, video metadata-deletion).
