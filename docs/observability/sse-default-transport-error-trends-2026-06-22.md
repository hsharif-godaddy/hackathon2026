# SSE-as-default error-trend review (2026-06-22)

Follow-up to [`sse-default-transport-error-trends-2026-06-19.md`](./sse-default-transport-error-trends-2026-06-19.md),
~5 days into SSE being the default chat transport in prod (WS fully drained to 0 turns).
Goal unchanged: separate issues **caused by** the new transport from issues merely
**surfaced by** it, and verify the three observability fixes that landed off the 06-19
review (#5253, #5249) are working.

Data sources: Loki (`job="airo-agents",env="prod"`, datasource 650) and airobuilde ESSP
Elastic (`client.sse.*`, warn+ only). Queries: `scripts/sse-rollout-check.py` (now updated)
plus 1h-window Loki pulls (Loki 502s on scans wider than ~3h, so trends are sampled 1h
windows).

## Verdict

**Still healthy. No transport-caused reliability defect.** SSE transport success is
99.90% over ~3k–5k turns/hr; genuine transport (blank-status) errors run 3–15/hr baseline
and are not trending. The three 06-19 fixes are deployed and working. One **new gap** found
(SSE terminal-error log drops the classified status/errorType — fixed in this branch) and
the discriminator-stream error is now **root-caused** from prod data.

## Status of the 06-19 findings

| # | 06-19 finding | Status now |
| --- | --- | --- |
| 1 | `getFinalResult.failed` ~100% false-positive (benign aborts) | **FIXED** (#5253). Aborts split to `getFinalResult.aborted` (28–37/hr). `getFinalResult.failed` now genuine: **0–2/hr**. Metric is trustworthy. |
| 2 | Pre-stream paywall 402 invisible on SSE | **FIXED** (#5253). `sse.budget.exceeded.pre_stream` now firing, stable **28–52/hr**. Pre-stream paywall-block rate is visible again. |
| 3 | Stream-chunk "No matching discriminator" → blank-status | **Partially fixed** (#5249): client now gets a 502 + friendly resend message instead of a blank error. **But the server log still records it blank** (new finding below), so it stays invisible in Loki. Root cause now identified. |
| — | "terminated" undici mid-stream closes | Unchanged ambient baseline, soft-commit handled. |

## New finding: SSE terminal-error log drops classified status/errorType

`classifyTurnError` assigns `STREAM_TYPE_VALIDATION` / `statusCode: 502` to the malformed
upstream-chunk error, and `MessageExecutionService` writes those to the **client wire
event** (so the user-facing fix works). But the **`sse.execution.error` log line**
(`MessageExecutionService.ts:2738`) took `statusCode` from `analyzeStreamError`, which has
no statusCode for a `TypeValidationError`, and never logged `errorType` at all. So these
errors log as **blank-status with no errorType** — invisible to Loki, the dashboard, and
`sse-rollout-check.py`.

The WS path (`experimental-websocket-server.ts:2639`) already logged `errorType` + the
classified `statusCode`. So the two transports were inconsistent — the anti-pattern
`packages/ai-transport/CLAUDE.md` calls out. Now that WS is drained, `STREAM_TYPE_VALIDATION`
appears nowhere in server logs despite #5249.

**Fix (this branch):** log `errorType` and fall back to the classified `statusCode` on the
SSE terminal-error log (prefers the analyzed upstream status when present, so existing
400/408/503/504 capture is unchanged). After deploy, these surface as
`sse.execution.error / 502 / STREAM_TYPE_VALIDATION` in Loki.

## Root cause of the discriminator-stream error (from captured `validationValue`)

#5249's `validationValue` field captured the offending chunk in prod. It is **proxy
leakage**, not schema/version skew: the GoCode/LiteLLM proxy forwards AWS Bedrock exception
envelopes as a chunk shaped `{"error":{"message":"...","type":"None","param":"None","code":"400"}}`,
which has no top-level `type` matching the Anthropic stream `discriminatedUnion`. Two
payloads seen:

- **`internalServerException`** ("The system encountered an unexpected error… Try your
  request again.") — **dominant** (≈1:1 with the discriminator count in sampled hours).
- **`Output blocked by content filtering policy`** (`validationException`) — minority.

Volume: "No matching discriminator" strings run 3–9/hr with one spike to 48/hr; the string
appears ~3× per failure across log lines, so real terminal failures are ~1–3 turns/hr
(spike ~16). Broad, low, intermittent.

**Implication / recommendation:** the dominant cause (`internalServerException`) is a
**transient, retryable** Bedrock error, but `classifyTurnError` marks `STREAM_TYPE_VALIDATION`
as `isRetryable: false` and tells the user to resend manually. #5249 explicitly deferred
this pending prod data — the data is now in. Consider making the error retryable (or at
least the `internalServerException` sub-case), and/or normalizing these envelopes upstream
in the GoCode/LiteLLM proxy so they arrive as a clean Anthropic `error` event.

## Error-by-status trend (1h windows, sampled, last ~48h)

| window | 400 (paywall/business) | 503 (infra) | blank (transport) | 408/504 |
| --- | --- | --- | --- | --- |
| now      | 146 | 7  | 6  | 2 |
| −12h     | 114 | 10 | 6  | 13/1 |
| −30h     | 247 | 15 | 7  | 9 |
| −48h     | 293 | 28 | 15 | 2 |

400 grants-exhausted dominates (normal business). 503 infra transient. Blank-status
transport flat at 6–15/hr — no regression. Plus pre-stream paywall 28–52/hr now visible
(separate gate from the in-stream 400).

## Client side (Elastic, warn+ only)

Within the flat 16–25/hr band from the whole ramp: hard-fail (connect/send/exhausted) 8–20
sessions/hr, reconnect-trouble 2–3 sessions (orphaned `/develop` tabs on deleted/idle apps).
No new ramp-attributable client trend. Covered by existing AIROBUILD-2628 / 2557 backlog.

## Actions

1. **Done (this branch):** log classified `statusCode`/`errorType` on `sse.execution.error`
   so `STREAM_TYPE_VALIDATION`/502 is observable; updated `sse-rollout-check.py` with a
   diagnostics block (pre-stream paywall, genuine-vs-benign getFinalResult, discriminator
   count) and a WS-drained verdict path.
2. **Recommended:** revisit `STREAM_TYPE_VALIDATION` retryability now that the dominant
   cause is a transient Bedrock `internalServerException`; consider upstream normalization in
   the GoCode/LiteLLM proxy.
3. **No rollback indicated.** Transport delivery remains at parity-or-better.
