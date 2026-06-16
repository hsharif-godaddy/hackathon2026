# Production Issue Investigation: "request timeout" in chat (app hb3qylxofz)

**Date:** 2026-06-16
**Environment:** test → Loki label `env="dev"`, `job="airo-agents"`
**Reported symptom:** Users see "request timeout" errors in the chat for app `hb3qylxofz`.

## Executive Summary

- **Root cause:** The **upstream model proxy** (GoCode / `OPENAI_BASE_URL`, LiteLLM-style gateway) enforces a **~300-second (5-minute) request timeout**. When a model turn streams slowly and crosses ~5 min, the proxy returns **HTTP 408 with body `request timeout`**, which the AI SDK surfaces as `AI_APICallError: Request Timeout` and the agent emits as `sse.execution.error` → the user sees "request timeout" in chat.
- **Not an app-code regression.** The client-side undici timeout is *deliberately* set to **600s** (`packages/ai-lib/src/providers/unified-provider.ts:21`) specifically so the client is *not* the limiting factor. The limiter is upstream.
- **Trigger:** Slow / stalled generation — the failing turn read only **43 chunks in 308s** (extended thinking, large context, or proxy congestion). In the same window an `assessment_agent.classify` call also ran ~306s, suggesting the proxy was degraded/slow at that moment.
- **Impact:** Fleet-wide and recurring at low frequency: **84 distinct apps / 91 events over 7 days** in dev. `hb3qylxofz` had **1** occurrence (2026-06-15 23:19 UTC). Daily counts 9–22/day, **27 today** (partial day) — slightly elevated.
- **Recoverable:** The session reconnected (`sse.recovery.replayed`, `http.request.success`) ~25 min later; the error is disruptive but not a permanent break.

## Evidence

### The failing event (conversation `0f743c84-1c29-40b9-b6ca-ff7e461800d6`)

```
ev=sse.execution.error  (2026-06-15T23:19:20Z)
data: {
  responseBody: "request timeout",
  isNetworkError: false,          // <-- a real HTTP response, not a client abort
  statusCode: 408,
  chunksRead: 43,
  streamElapsedMs: 308224,        // ~308s
  errorClass: "AI_APICallError",
  error: "Request Timeout",
  app_id: "hb3qylxofz",
  stack: "AI_APICallError: Request Timeout
            at @ai-sdk/provider-utils .../index.mjs:2567   (postToApi)"
}
container.image.tag: pi-559777b-ext-4d8e976  (build-date 2026-06-08)
```

### Turn timeline (UTC)

```
23:14:09  conversation.continue / agent_turn.start   (turn begins)
23:17:01  assessment_agent.classify.complete  durationMs=306191   (~306s — also slow!)
23:19:17  stream.chunk.slow_gap  streamElapsedMs=308223  chunksRead=43
23:19:20  sse.execution.error    statusCode=408  "request timeout"
23:45:08  sse.recovery.replayed / http.request.success   (session recovers)
```

Two independent model calls both hitting ~306–308s ⇒ a shared ~5-min ceiling, consistent with an upstream gateway timeout rather than anything turn-specific.

### Timeout signature across the fleet (7d, dev)

`streamElapsedMs` for all 408 events: **min 304298 / median 306110 / max 947775** ms.
The tight cluster at **304–306s** is the signature of a hard ~300s upstream timeout (the 947775ms outlier is a separate/longer case, likely measured across retries).

### Code state (this repo is not the limiter)

`packages/ai-lib/src/providers/unified-provider.ts:15-21`
```ts
// Extend undici timeouts for LLM streaming — long generations can pause for
// minutes between chunks (e.g. extended thinking). The default 300s undici
// bodyTimeout/headersTimeout can fire before the AI SDK's application-layer
// timeout ...
const llmDispatcher = new Agent({ bodyTimeout: 600_000, headersTimeout: 600_000 })
```
Client allows 10 min; the 408 arrives at ~5 min ⇒ the cap is enforced **upstream of this process**.

## Impact Analysis

| Metric | Value |
|---|---|
| Distinct apps affected (7d, dev) | **84** |
| Total 408 timeout events (7d, dev) | **91–103** |
| `hb3qylxofz` occurrences | **1** (2026-06-15 23:19 UTC) |
| Per-day | 06-09: 12, 06-10: 9, 06-11: 22, 06-12: 19, 06-13: 14, **06-16: 27 (partial)** |
| Timeout boundary | ~305s (min 304.3s, median 306.1s) |
| Recovery | Yes — `sse.recovery.replayed` |

Pattern: each app is hit ~once; this is a background condition affecting whichever turn happens to be slow, not a single broken app.

## Recommendations

### Immediate
1. **Confirm the upstream timeout** with the GoCode/model-proxy gateway owners — verify the 5-min request timeout and whether it can be raised for streaming completions, or whether SSE keep-alive/chunked responses should reset the idle timer.
2. **Reassure on `hb3qylxofz`:** single transient timeout, session recovered. Not app-specific.

### Product / resilience
3. **Make 408 retryable with a fresh turn** rather than surfacing raw "request timeout" — or show a clearer, retryable message in chat. Confirm AI SDK `maxRetries` behavior for 408 after a partial stream (a naive retry costs another ~5 min, so prefer a resume/continue strategy over blind retry).
4. **Reduce slow-turn probability:** investigate why `assessment_agent.classify` took 306s — that path alone consumed the entire budget. If classification and the main turn share the upstream and run sequentially, a slow classify can starve the main generation.
5. **Cap/observe time-to-first-token and inter-chunk gaps** (we already emit `stream.chunk.slow_gap`); alert when median `streamElapsedMs` for 408s approaches the proxy limit.

### Monitoring
6. Add a dashboard panel + alert on `sse.execution.error` with `statusCode:408` rate (baseline ~9–22/day dev); page if it spikes.

## Reproduction queries (Loki, datasource uid `ff18mpwxpc7wgd` / proxy id 650)

```
# This app, timeout events
{job="airo-agents", env="dev"} |= "hb3qylxofz" |= "sse.execution.error"

# Fleet-wide 408 rate per day
sum(count_over_time({job="airo-agents", env="dev"} |= "sse.execution.error" |= "\"statusCode\":408" [1d]))
```
