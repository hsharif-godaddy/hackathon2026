# Design: Automation Scheduling — Run Lifecycle, Failure Modes & Resilience

**Date:** 2026-07-01  
**Status:** Implemented  
**Feature flag:** `appbuilder-automation-scheduling`

---

## Overview

Automation scheduling lets a shopper define AI jobs (SEO audit, blog post, social content, etc.) that run on a cron schedule or on demand. Airo-go (hosting control plane) owns both scheduled and manual run records and dispatches runs to the agent container. The agent executes the job, writes a summary, and posts a callback to hosting so the run record is marked as succeeded/failed.

---

## End-to-end data flow

### Scheduled run

```
Shopper UI                  BFF (Next.js)             airo-go / hosting           Agent (Node/Express)
---------                   -------------             -----------------           --------------------
Save schedule  ──POST──▶  /api/automations/{appId}  ──▶  POST …/automations  (stores cron + defnRef)
                                                          │
                                    cron fires ──────────▶  POST /api/automations/run
                                                            { runId, defnRef, scheduledSlot, … }
                                                                                        │
                                                          callback ◀──POST──────────────│
                                                          /api/hosting/v1/…/agent/callback
Shopper UI  ◀──SSE event──  automation_run_complete ◀────│
```

### Manual run

```
Shopper UI                  BFF (Next.js)             airo-go / hosting           Agent (Node/Express)
---------                   -------------             -----------------           --------------------
Click "Run Now" ──POST──▶  /api/automations/{appId}/{id}/runs  ──▶  POST …/automations/{id}/run
                                                                      (creates queued run, dispatches)
                                                          │
                                                          └──▶  POST /api/automations/run
                                                                { runId, defnRef }   (no scheduledSlot)
                                                                                        │
                                                          callback ◀──POST──────────────│
                                                          /api/hosting/v1/…/agent/callback
Shopper UI  ◀──SSE event──  automation_run_complete ◀────│
```

### Key object identities

| Name | What it is | Who sets it |
|---|---|---|
| `defnRef` | Automation ID, also the job file directory name under `.airo/jobs/` | UI (`automation.id`, stable UUID written to `index.json`) |
| `runId` | Unique ID for one dispatch attempt | airo-go / hosting, per attempt |
| `scheduledSlot` | ISO-8601 UTC timestamp of the cron minute that fired | airo-go, for cron runs only; absent for manual runs |
| `conversationId` | Shared with the main chat — automation runs reuse it | Agent memory store |
| `triggerType` | `"scheduled"` or `"manual"` | hosting run row; echoed in summary file frontmatter |

### Job definition file

```
.airo/jobs/{defnRef}/{defnRef}.md
```

Written by the BFF when a schedule is saved (or when the user manually triggers "Add" / "Run"). Frontmatter:

```markdown
---
name: SEO Optimisation
description: Analyse and improve on-page SEO
---
Review the site's pages and apply recommended SEO improvements …
```

The agent reads this file, prepends `[Automation: {name} — {description}]`, and feeds it as the conversation prompt.

---

## Request / response contract

### `POST /api/automations/run`

Auth: hosting-minted app JWT (`siteId` claim is sufficient identity).

Request body:
```json
{
  "runId": "abc123",
  "defnRef": "seo-optimisation",
  "scheduledSlot": "2026-07-07T09:00:00Z",
  "defnLocation": ".airo/jobs",
  "tokenBudget": 0,
  "timeoutSeconds": 3540
}
```

`scheduledSlot` is absent for manual (user-triggered) runs.

Synchronous responses:

| Status | Meaning | `failureClass` |
|---|---|---|
| 202 | Accepted — run is executing async | — |
| 400 | Missing `runId` or `defnRef` | — |
| 401 | JWT missing `siteId` | — |
| 403 | `appbuilder-automation-scheduling` flag disabled | `non_retryable` |
| 409 | Busy — another run is in flight, or user has open SSE | `retryable` |

### `POST /api/automations/run/:runId/cancel`

Aborts an in-flight run. Returns 202 immediately; the run loop picks up the abort signal and posts a `cancelled` callback.

---

## Manual run dispatch (UI → BFF → airo-go → agent)

When the user clicks **Run Now** on an automation that has a hosted record:

1. `AutomationsPanel.handleRun` checks `scheduleByDefnRef[automation.id]` — if a hosted record exists, calls `triggerRun(defnRef)`.
2. `useAutomations.triggerRun` calls `POST /api/automations/{appId}/{hostedId}/runs` (BFF).
3. BFF proxies to airo-go `POST …/automations/{hostedId}/run`.
4. airo-go creates a run row (`trigger_type: manual`, `scheduled_slot: NULL`), dispatches immediately to the agent.
5. Agent receives `POST /api/automations/run` with no `scheduledSlot` — same code path as scheduled runs.
6. Agent executes, writes `manual_{runId}_{convId}_summary.md`, posts callback.
7. Hosting marks run succeeded/failed — appears in `GET …/automations/{id}/runs` with `triggeredBy: "manual"`.

**Fallback:** Automations without a hosted record (not yet saved to airo-go) still fall back to the legacy SSE direct dispatch (`airo-automation-run` custom event → `ChatPane`).

**UI busy guard:** If the agent is streaming or a chat turn is loading, `handleRun` shows a warning growl and does not call the API. If the agent returns 409 (background run or SSE open), the growl message also says "Only 1 automation can run at a time".

---

## Async execution flow (post-202)

```
runAutomation()
  │
  ├── [L3] scheduledSlot present?
  │     └── readRunFile(slotSummaryRef)
  │           ├── found → re-post existing result, return  [idempotency short-circuit]
  │           └── not found → continue
  │
  ├── readJobDefinition() → .airo/jobs/{defnRef}/{defnRef}.md
  │     └── not found → postCallback(failed, non_retryable, job_not_found), return
  │
  ├── getOrCreateConversation() → conversationId
  │
  ├── getOrCreateSSEExecutionServiceForAutomation()
  │     └── null → postCallback(failed, retryable, agent_not_ready), return
  │
  ├── executionService.execute(…)   ← full agent loop, tool calls, LLM, workspace writes
  │     └── throws / aborts → reportAbortedRun()
  │
  ├── readRunFile(runSummaryRef)
  │     scheduled: .airo/jobs/{defnRef}/runs/scheduled_{slot}_summary.md
  │     manual:    .airo/jobs/{defnRef}/runs/manual_{runId}_{convId}_summary.md
  │     └── undefined → postCallback(failed, non_retryable, summary_missing), return
  │
  ├── [L3] scheduledSlot present?
  │     └── writeRunFile(slotSummaryRef, content)   [idempotency marker]
  │
  ├── SSE → sendToApp(automation_run_complete, succeeded)
  └── postCallback(succeeded) ← with L2 retry + HMAC signing
```

---

## Run summary file naming

MES writes the summary file at a predictable path based on trigger type:

| Trigger | Path |
|---|---|
| Cron (with `scheduledSlot`) | `.airo/jobs/{defnRef}/runs/scheduled_{slot}_summary.md` |
| Cron (no `scheduledSlot`, fallback) | `.airo/jobs/{defnRef}/runs/scheduled_{runId}_{convId}_summary.md` |
| Manual (via hosting dispatch) | `.airo/jobs/{defnRef}/runs/manual_{runId}_{convId}_summary.md` |
| Legacy SSE direct (no `runId`) | `.airo/jobs/{defnRef}/runs/manual_{timestamp}_{convId}_summary.md` |

Frontmatter written to every summary file:

```markdown
---
automationId: seo-optimisation
triggerType: scheduled | manual
runId: abc123          # present when dispatched by hosting
scheduledSlot: ...     # present for cron runs only
conversationId: conv-xyz
timestamp: 2026-07-07T09:04:00.000Z
status: completed | failed
---
```

---

## Callback auth — HMAC signing

The agent signs every callback request with an HMAC to satisfy the hosting route's auth requirement:

```
Authorization: sso-jwt <S2S awsiam token>
X-Airo-Event-Sig: base64url(HMAC-SHA256(signing_key, canonical))
```

**Canonical string:** `appId + "\n" + runId + "\n" + status`

**Signing key:** read from Nomad alloc config at `__event_signing_key` (same key used by the lifecycle events client for `POST …/agent/v1/apps/{appId}/events`).

If the signing key is absent (local dev / misconfiguration), the agent logs `automations.callback.no_signing_key` and sends the request without the HMAC header.

---

## Failure scenarios

### 1. Job file not found (`job_not_found`)

**What happens:** Agent receives a `defnRef` (e.g. `seo-optimisation`) but `.airo/jobs/seo-optimisation/seo-optimisation.md` does not exist on the persistent volume (`/app`).

**Cause:** User deleted the automation without deleting the hosted schedule; or the volume was lost/reset; or the file was never written (bug in the UI save flow before the "write on schedule save" fix was deployed).

**Agent action:**
- Logs `automations.run.job_not_found` (warn)
- Posts callback: `{ status: failed, failureClass: non_retryable, reasonCode: job_not_found }`

**Hosting behaviour:** `non_retryable` → marks run as `failed_permanent`, no further dispatches for this runId. Hosting's own retry logic will dispatch a new runId on the next scheduled cron tick.

**Fix deployed:** BFF now writes the job file when saving a schedule. `handleAddRecommended` and `handleRunRecommended` also use the stable `automation.id` as `defnRef` instead of a random UUID.

---

### 2. Agent execution service not initialised (`agent_not_ready`)

**What happens:** `getOrCreateSSEExecutionServiceForAutomation()` returns `null` — the execution service singleton hasn't been created yet (agent process just started, still booting).

**Cause:** Hosting dispatched a run within seconds of the agent container starting.

**Agent action:**
- Posts callback: `{ status: failed, failureClass: retryable, reasonCode: agent_not_ready }`

**Hosting behaviour:** `retryable` → hosting retries with exponential backoff. By the time of the next attempt the agent will be fully initialised.

---

### 3. Agent process crash / OOM during execution

**What happens:** The Node process dies mid-run. No callback is ever sent.

**Hosting behaviour:** Hosting has its own `max_attempts` (default 3) and `next_attempt_at` window. When the previous run's callback never arrives within the reconcile window, hosting re-dispatches with a new `runId`.

**Resilience (L3):** If the run had already written the slot summary before crashing, the next attempt finds the slot file, skips re-execution, and posts the success callback. If it crashed before the summary was written, the re-dispatch runs the job again from scratch — correct behaviour.

---

### 4. Tool call failure (non-fatal, internal to execute())

**What happens:** A tool (e.g. `workspace.files.write`, `git commit`, external API) throws inside the agent loop. The agent loop (`MessageExecutionService.execute`) has its own error handling per tool — typically it emits the error as a chat message and continues to the next step. The run may complete with partial output.

**Summary file outcome:** If the run completes (even partially), `MessageExecutionService` writes the summary file. The agent reads it and posts `succeeded`.

**Observability:** The tool error is recorded in the conversation history. The summary content reflects whatever the agent produced up to and after the failure.

---

### 5. Tool call failure (fatal — throws out of execute())

**What happens:** An unhandled exception propagates out of `executionService.execute()`.

**Agent action:**
- Caught by the `catch` block in `runAutomation`
- Logs `automations.run.error` (error level)
- Calls `reportAbortedRun()` → posts callback: `{ status: failed, failureClass: non_retryable, reasonCode: execution_error }`

**Hosting behaviour:** `non_retryable` → `failed_permanent`. No retry for this runId.

**Note:** Most agent errors are handled internally and do not propagate out of `execute()`. A bare throw reaching this catch indicates a truly unexpected condition (OOM-adjacent, programming error, etc.).

---

### 6. Run timeout (`agent_timeout`)

**What happens:** The job runs longer than `timeoutSeconds` (default 3540s = 59 min). The timeout fires `controller.abort('timeout')`.

**Agent action:**
- `execute()` receives the abort signal and terminates early
- `signal.aborted` is true; `reportAbortedRun` is called
- Posts callback: `{ status: failed, failureClass: retryable, reasonCode: agent_timeout }`

**Hosting behaviour:** `retryable` → hosting may retry. The retry will re-run the entire job (no partial resumption).

**Why retryable:** A timeout usually means the job was too long for one attempt, not that it's fundamentally broken. The next attempt may succeed with a more focused prompt or faster LLM response times.

---

### 7. User cancel

**What happens:** User calls `POST /api/automations/run/:runId/cancel` while a run is in flight.

**Agent action:**
- `controller.abort('user_cancel')`
- `reportAbortedRun` posts: `{ status: cancelled }` (no `failureClass`)

**Hosting behaviour:** `cancelled` → terminal state, no retry.

---

### 8. Summary file missing after successful execute() (`summary_missing`)

**What happens:** `execute()` completes without throwing, but reading the expected summary file returns nothing.

**Possible causes:**
- The agent flag `appbuilder-automations` was off for this shopper, so `MessageExecutionService` skipped writing the file (flag mismatch — the run flag and the summary-write flag were previously different; now aligned to the same `appbuilder-automation-scheduling` flag).
- Disk write failed silently inside `MessageExecutionService`.
- The `conversationId` was different from what the agent computed for the filename.

**Agent action:**
- Logs `automations.run.summary_missing` (warn)
- SSE: `automation_run_complete` with `status: failed, error: 'Run summary file missing'`
- Callback: `{ status: failed, failureClass: non_retryable, reasonCode: summary_missing }`

---

### 9. Callback delivery failure (transient network / 5xx)

**What happens:** The `fetch` to `MGMT_AIRO_BASE_URL/api/hosting/v1/apps/{appId}/agent/callback` fails with a network error or a 503.

**Agent action (L2 — retry with backoff):**
- Attempt 0 immediately
- Attempt 1 after 1s
- Attempt 2 after 2s
- Attempt 3 after 4s
- Total window: ≤ 7s

If all 4 attempts fail:
- Logs `automations.callback.failed_all_attempts` (error)
- The run record stays `dispatched` in hosting until hosting's reconcile window expires, then hosting re-dispatches

**Resilience (L3):** On the re-dispatch the agent finds the slot summary file, skips re-execution, and re-posts the success callback. The job is not run twice.

---

### 10. Callback delivery failure (4xx — auth or bad payload)

**What happens:** Hosting returns 400, 401, 403, 404, etc.

**Agent action:** Does **not** retry (4xx is non-retryable — retrying the same request will get the same error). Logs `automations.callback.http_error` at attempt 0 and breaks immediately.

**Diagnosis:**
- **401** — most likely the `X-Airo-Event-Sig` HMAC header is missing or the signing key (`__event_signing_key` in Nomad alloc config) is not set. Check `automations.callback.no_signing_key` in logs.
- **404** — check `MGMT_AIRO_BASE_URL` env var; verify the callback route is registered in the control plane.
- **405** — path is wrong (should be `/api/hosting/v1/…`, not `/hosting/v1/…`).

---

### 11. S2S auth disabled

**What happens:** `isS2SAuthEnabled()` returns false (local dev or env misconfiguration).

**Agent action:** Logs `automations.callback.s2s_disabled` (warn) and returns without posting. The run completes on the agent side but hosting never gets the callback.

**Local dev:** The local control plane stub at `POST /api/hosting/v1/apps/{appId}/agent/callback` accepts any payload and returns 200, so this path is only hit in environments where S2S is explicitly disabled.

---

### 12. User is active in the app (SSE connection open)

**What happens:** The user has an open SSE connection to the app at dispatch time.

**Agent action:** Returns 409 retryable immediately without starting the run.

**Hosting behaviour:** Retries after backoff. Once the user closes the tab/navigates away, the SSE registry is empty and the next retry proceeds.

**For manual runs:** The UI `isBusy` check prevents calling `triggerRun` while SSE is streaming/loading. However if a background scheduled run is in flight (no SSE), the agent 409 surfaces as a warning growl: "Only 1 automation can run at a time."

**Rationale:** Prevents the automation from injecting messages into the conversation while the user is mid-turn, which would cause confusing interleaving.

---

### 13. Concurrent automation run already in flight

**What happens:** airo-go dispatches two runs in quick succession to the same agent (e.g. race between a cron fire and a manual trigger).

**Agent action:** The second `POST /run` returns 409 retryable. The first run proceeds normally.

**In-memory state:** `activeAutomationRuns` (a `Set<string>` of appIds) gates concurrent runs within the same process. Cleared in `.finally()` after the run completes.

---

### 14. Scheduling flag disabled at dispatch time

**What happens:** `appbuilder-automation-scheduling` is turned off in Switchboard after a schedule was already registered. Hosting dispatches a run.

**Agent action:** Returns 403 `non_retryable` immediately.

**Hosting behaviour:** `failed_permanent`. No further retries for this runId. Future cron ticks will also 403 until the flag is re-enabled.

---

## Resilience layers summary

| Layer | What it covers | Implementation |
|---|---|---|
| L1 | Correct callback URL + auth | `MGMT_AIRO_BASE_URL/api/hosting/v1/apps/{appId}/agent/callback` with S2S awsiam token + HMAC |
| L2 | Transient callback failures | 3 retries with 1s/2s/4s backoff in `postCallback` |
| L3 | Agent crash after success / hosting re-dispatch | Slot-keyed summary file check before execution (scheduled runs only) |

### L3 slot idempotency in detail

**Slot file path:** `.airo/jobs/{defnRef}/runs/scheduled_{slot}_summary.md`
where `{slot}` is the `scheduledSlot` ISO timestamp with colons replaced by dashes, e.g. `2026-07-07T09-04-00Z_summary.md`.

**Pre-check:** At the start of `runAutomation`, if `scheduledSlot` is present, the agent reads the slot file. If it exists (a prior attempt succeeded), the agent re-posts the existing content as `succeeded` under the new `runId` and returns. `execute()` is never called — the job runs at most once per cron slot.

**Post-write:** After a successful fresh run, the agent writes the slot file as a copy of the run summary. The write happens only after confirming the run summary exists, so a crashed run never leaves a false-positive.

**Manual runs:** `scheduledSlot` is absent → no slot check, no slot write. Manual runs are always fully executed.

---

## UI — Run history view

The automations panel shows run history per automation with two levels:

- **Preview (3 runs):** shown inline in the card's "Recent runs" accordion when expanded.
- **Full history (up to 20 runs):** clicking "View all runs →" slides the entire automations panel left and replaces it with a `RunsHistoryView` for that automation. "← Back" reverses the transition.

Both scheduled and manual runs appear in the same list (sourced from `GET …/automations/{id}/runs`), distinguished by the `triggeredBy` field (`scheduled` / `manual`).

---

## Files changed

| File | Change |
|---|---|
| `agents/src/server/routes/automations.ts` | Core run lifecycle, L2 retry, L3 idempotency, HMAC signing on callback |
| `agents/src/server/routes/__tests__/automations.test.ts` | Guards, async callbacks, retry, idempotency tests; mock for `getNomadAllocConfigValue` |
| `agents/src/server/app.ts` | Mounts `automationsRouter`; automation execution service factory |
| `agents/src/server/sse/MessageExecutionService.ts` | Writes run summary file; `manual_` prefix for hosted manual runs; `triggerType` frontmatter fixed |
| `app/src/hooks/useAutomations.ts` | `triggerRun(defnRef)` — calls BFF `POST …/runs` for manual dispatch |
| `app/src/hooks/useAutomationRuns.ts` | `fetch(limit?)` accepts limit; exports `PREVIEW_RUNS_LIMIT=3`, `ALL_RUNS_LIMIT=20` |
| `app/src/services/automation-files.ts` | Job file CRUD; `create(id?)` accepts caller-provided ID |
| `app/src/app/[market]/develop/components/automations/AutomationsPanel.tsx` | `handleRun` branches on hosted vs unhosted; `triggerRun` path with 409-aware error handling; slide-in `RunsHistoryView` |
| `app/src/app/[market]/develop/components/automations/AutomationCard.tsx` | Preview runs accordion (3 runs) + "View all runs" button; `onViewAllRuns` prop |
| `app/src/app/[market]/develop/components/automations/RunsHistoryView.tsx` | Full run history panel (up to 20 runs) with slide-in transition |
| `app/src/app/api/automations/[appId]/[automationId]/runs/route.ts` | Added `POST` handler — proxies to airo-go `POST …/automations/{id}/run` |
| `app/src/app/api/auth/token/route.ts` | BFF token endpoint |
| `app/src/lib/jwt-config.ts` | JWT config for automation tokens |
| `local-control-plane/internal/api/automations.go` | LCP stubs: agent callback + `TriggerAutomationRun` |
| `local-control-plane/internal/api/router.go` | Registers LCP callback + manual run trigger routes |

---

## Observability — log events

| Event | Level | When |
|---|---|---|
| `automations.run.received` | info | Dispatch accepted (post-202) |
| `automations.run.flag_disabled` | info | Flag off, returning 403 |
| `automations.run.busy_automation` | info | 409 — run in flight |
| `automations.run.user_active` | info | 409 — SSE open |
| `automations.run.slot_already_done` | info | L3 short-circuit, re-posting existing result |
| `automations.run.job_not_found` | warn | Job file missing |
| `automations.run.read_job_failed` | warn | I/O error reading job file |
| `automations.run.summary_missing` | warn | execute() succeeded but summary not found |
| `automations.run.slot_summary_write_failed` | warn | L3 slot file write failed (non-fatal) |
| `automations.run.error` | error | Unhandled exception in runAutomation |
| `automations.cancel.wrong_owner` | warn | Cancel targeting another app's run |
| `automations.callback.s2s_disabled` | warn | S2S auth off, callback skipped |
| `automations.callback.no_signing_key` | warn | HMAC signing key absent — callback sent without signature |
| `automations.callback.http_error` | warn | Non-2xx from hosting callback (per attempt) |
| `automations.callback.fetch_error` | warn | Network error on callback fetch (per attempt) |
| `automations.callback.sent` | info | Callback delivered successfully |
| `automations.callback.failed_all_attempts` | error | All 4 callback attempts exhausted |
