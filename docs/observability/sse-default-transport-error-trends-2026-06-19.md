# SSE-as-default error-trend review (2026-06-19)

Investigation of agent error trends in the ~2 days since SSE became the default chat
transport in prod (100% target set 2026-06-17 ~12:10 AEST; WS now fully drained to 0
turns). Goal: separate issues **caused by** the new transport from issues merely
**surfaced by** the change.

Data sources: Loki (`job="airo-agents",env="prod"`, datasource 650) and airobuilde ESSP
Elastic (client `client.sse.*`, warn+ only). Method/queries: `scripts/sse-rollout-check.py`
plus the windowed Loki pulls recorded below.

## Verdict

**The SSE rollout is healthy. No transport-caused reliability defect.** Server transport
success is 99.94–100% over ~8,400 turns/hr; genuine transport (blank-status) errors run
2–9/hr baseline. Everything reaching the agent completes. The interesting findings are
**measurement/observability artifacts and pre-existing robustness gaps now visible in the
SSE error stream**, not regressions in delivery.

## Error-by-status trend (1h windows, every 6h, last 54h)

| window (UTC) | dominant transport | notable |
| --- | --- | --- |
| 06-16 19:00 | WS | WS/400=51 WS/402=18 WS/blank=9 (WS baseline) |
| 06-17 01:00 | mixed | flip in progress |
| 06-17 19:00 | SSE | SSE/503=29 (infra spike around flip) |
| 06-18 19:00 | SSE | **SSE/blank=48** (one-app upstream spike, see #1) |
| 06-19 01:00 | SSE | SSE/blank=4, 503→~0 (settled) |

## Findings

### Caused by SSE: none material

The only blank-status spike (48 true-transport errors at 06-18 19:00Z) was **a single app
(`0wx9k25bvw`) emitting 42 upstream `api.godaddy.com:443` connect-timeouts** (10s undici
connect timeout). Upstream connectivity from one app — not a transport defect. Baseline the
rest of the time is 2–9 blank-status/hr.

### 1. `sse.execution.getFinalResult.failed` is ~100% false-positive noise (logging bug)

Over the last 6h, **174/174 of these events were benign**: 105 `user_stopped`, 53
`"This operation was aborted"`, 16 `server_shutdown` — **zero genuine result-fetch
failures**.

- SSE-specific (WS doesn't wrap `getFinalResult`).
- Root cause at `agents/src/server/sse/MessageExecutionService.ts:1512-1514`: an aborted
  `getFinalResult` (`controller.abort('user_stopped')` line 447, `'server_shutdown'`
  line 528) is not a network error, so it skips the soft-commit branch and lands in the
  `else` that logs `.failed` with `finishReason = 'result_fetch_failed'`.
- **`finishReason` cannot discriminate** benign aborts from true failures — it is uniformly
  `result_fetch_failed`. The only discriminator today is the `error`/abort-reason string
  (`user_stopped` / `server_shutdown` / `"This operation was aborted"` ⇒ benign).
- **Fix:** check `controller.signal.aborted` / `signal.reason` before the `else` and
  classify aborts as `finishReason: 'aborted'` (or a distinct `getFinalResult.aborted`
  event). Reserve `getFinalResult.failed` + `result_fetch_failed` for true failures so the
  dashboard / `sse-rollout-check.py` can trust the event without string-filtering.

### 2. Pre-stream paywall 402 is invisible in the SSE event stream (observability gap)

WS surfaced budget-exceeded as a terminal `ai-lib.websocket.agent.error` carrying
statusCode **402** (18→10→5→1/hr as WS drained). SSE handles the pre-stream BMS budget
capacity gate at the HTTP layer: `routes.ts:614 res.status(402).json(...); return` — with
**no Loki event** (`sse.budget.exceeded.pre_stream` and `sse.budget.precheck_failed` both
0/6h). So SSE pre-stream paywall blocks don't appear in terminal-error trends.

- **Enforcement is intact**: the user is still blocked with 402, and the in-stream
  grants-exhausted path (`agent-factory.ts` → classified 400 "All credit grants have been
  exhausted", 25–91/hr) is fully visible.
- This is a **measurement difference, low severity**: pre-stream BMS-gate block *rate* is
  under-measured on SSE. Optional fix: log a structured event on the `routes.ts:614` 402
  branch.

### 3. Stream-chunk "Type validation failed — No matching discriminator" (robustness gap)

When the upstream returns a non-standard error payload (content-filter policy block,
`internalServerException`), the AI-SDK stream parser's Zod `discriminatedUnion` over
`message_start | content_block_* | error | message_delta | message_stop | ping` cannot
match it and throws a type-validation error → the turn fails as a **blank-status transport
error** instead of a clean business error.

- Low volume (0–6/hr, 0 most hours), broad (≈3 apps).
- Lives in shared `@airo/ai-lib` / `@airo/ai-transport` stream processing → affects WS too;
  it is simply now visible in the SSE error stream.
- **Fix:** map unrecognized upstream error chunks to a clean terminal error (surface the
  upstream message + status) rather than letting union validation throw.

### 4. `"terminated"` undici mid-stream network closes (ambient baseline)

~12–20/hr, broad across 7–19 distinct apps (~1–2 each) — ambient network closes, not one
bad app, not SSE-specific. Handled by `premature_close` soft-commit when content already
streamed. Baseline noise.

### Shared business/infra (not transport)

- **400** grants-exhausted (paywall) 25–91/hr — normal business.
- **408** chunk/request timeout 1–9/hr — soft-commit territory (AIROBUILD-2079 merged;
  AIROBUILD-2557/408-UX follow-ups).
- **503/500/504** infra — spiked to ~29/hr around the 06-17 flip, declined to ~0–1/hr now.
  Transient upstream; correlated in time with the flip but not transport-attributable.

### Client side (Elastic, warn+ only)

21 hard-fail sessions/hr (connect/send/exhausted) and 11 reconnect-trouble sessions/hr —
within the flat 16–25 band observed across the whole ramp; reconnect-trouble dominated by
orphaned `/develop` tabs on deleted/idle apps. Covered by existing AIROBUILD-2628 /
AIROBUILD-2557 client-edge backlog. No new ramp-attributable client trend.

## Recommended actions

1. **Logging fix (highest value, low risk):** discriminate aborts in
   `MessageExecutionService.ts:1512` so `getFinalResult.failed` means a real failure.
   Removes ~100% false-positive noise from a metric the dashboard/check-script trust.
2. **Robustness:** handle unrecognized upstream error chunks in the stream parser
   (`@airo/ai-transport`) so content-filter / 5xx-style upstream payloads surface as clean
   business errors, not blank-status transport failures.
3. **Observability (optional):** emit a structured event on the SSE pre-stream 402 branch
   (`routes.ts:614`) to restore paywall-block visibility lost relative to WS.
4. **No rollback indicated.** Transport delivery is at parity-or-better with WS.
