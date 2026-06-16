# Design: Soft-commit GoCode 408 "request timeout" (chat UX)

**Date:** 2026-06-16
**Status:** Draft — pending user review
**Related:** AIROBUILD-2079 (chunk-timeout / premature-close soft-commit, branch `deverton/chunk-timeout-soft-commit`, PR #4435). This is a direct extension of that work.

## Problem

When a model turn streams slowly and crosses GoCode's ~304s request timeout, GoCode returns **HTTP 408 with body `"request timeout"`**. The AI SDK surfaces this as `AI_APICallError` (`statusCode: 408`, `isNetworkError: false`), which the agent emits as `sse.execution.error`. The user sees a **raw red "Request Timeout" error bubble in the chat panel, and any already-streamed partial response is discarded.**

### Evidence (investigation 2026-06-16, app `hb3qylxofz`)

- One turn (`conversationId 0f743c84…`) hit `statusCode: 408`, `responseBody: "request timeout"`, `isNetworkError: false`, after `streamElapsedMs: 308224` (~308s) having already read **43 chunks**.
- Fleet-wide in dev: **84 distinct apps / ~91 events over 7 days**; `streamElapsedMs` clusters tightly at **min 304.3s / median 306.1s** — the signature of a hard ~304s upstream timeout.
- This ~304s boundary is the **same GoCode timeout** AIROBUILD-2079 already handles for the network-close flavor (`TypeError: terminated`). The 408 is the clean-HTTP-response sibling of that same timeout.

### Why the existing soft-commit misses it

AIROBUILD-2079 added a soft-commit seam: a premature upstream close where content already arrived is finalized as `finishReason: 'incomplete'` (skipping the dead `getFinalResult()`), which the client maps to the existing `connectionLost` advisory ("response may be incomplete — send a follow-up"). That seam gates on `isNetworkError(err)`. A 408 is a real HTTP response, so `isNetworkError` is `false`, the seam returns `false` and rethrows, and the turn lands on the hard-error path.

## Scope

In scope (Tiers 1 + 2 from the investigation):
1. **Preserve partial content** on a 408 when content already streamed — soft-commit as `incomplete`, reusing the existing `connectionLost` advisory (no client/i18n change).
2. **Friendly message** for the no-content 408 case — replace raw `"Request Timeout"` with actionable copy.

Out of scope (deferred):
- Resume/auto-continue from the partial on retry (Tier 3).
- Prevention: reducing the sequential ~306s `assessment_agent.classify` before the main stream; long-turn progress UI (Tier 4).
- Any change to GoCode's upstream timeout itself (tracked separately as the infra root cause).

## Approach

Chosen: **broaden the existing soft-commit trigger predicate** to recognize the HTTP-response timeout flavor, reusing the proven `decideChunkTimeoutFinalization` content gate and both transports' existing wiring.

Rejected alternatives:
- **`classifyTurnError`-only:** friendlier message but still discards partial content (the red bubble replaces streamed text). Fails the main goal.
- **Dedicated new 408 handler:** duplicates soft-commit logic and violates the `@airo/ai-transport` "one seam, both transports" rule.

## Components

### 1. `isUpstreamTimeoutError()` — new predicate (only new logic)
- Location: `packages/ai-transport/src/analyze-stream-error.ts` (beside `isNetworkError`).
- True for an `APICallError`-shaped error with `statusCode === 408 || statusCode === 504`. Uses the `statusCode` `analyzeStreamError()` already extracts.
- Status-based only — 408 is semantically "request timeout"; do not over-match on `responseBody` text.

### 2. SSE soft-commit gate — `agents/src/server/sse/MessageExecutionService.ts`
- In `handlePrematureClose` (~line 1128), change the guard from
  `if (!isNetworkError(err)) return false`
  to also accept `isUpstreamTimeoutError(err)`.
- Downstream unchanged: `decideChunkTimeoutFinalization({isFinished, hasContent})` content-gates (content → `incomplete`; none → fail-fast), `prematureCloseError` records the honest error span. The read-loop (~line 1301) and textStream (~line 1354) catch sites call `handlePrematureClose`. The `getFinalResult` catch (~line 1381) has a separate inline gate (`if ((isNetworkError(err) || isUpstreamTimeoutError(err)) && hasContent)`) that was likewise broadened to accept `isUpstreamTimeoutError` — it does not call `handlePrematureClose`.

### 3. WS soft-commit gate — `packages/ai-transport/src/experimental-websocket-server.ts`
- Mirror the SSE change: the `postStreamError` catch that sets `pendingSoftCommitReason` for `isNetworkError` also sets it for `isUpstreamTimeoutError`. Mandatory parity per `packages/ai-transport/CLAUDE.md`.

### 4. Friendly no-content message — `packages/ai-transport/src/classify-turn-error.ts`
- In the `APICallError` branch (~line 77), when `statusCode` is 408/504 return a `clientMessage`, e.g. *"The AI took too long to respond and the request timed out. Please send your message again."*, instead of the raw `error.message`.
- Renders only on the fail-fast (no-content) path; the common content-present case is soft-committed and never reaches here.
- `isRetryable` left **unchanged** (still false for 408): there is no turn-level retry button in the client; the recovery model is "send a follow-up", already stated by the advisory copy. Deliberate non-change.

## Data flow (after change)

```
GoCode 408 mid-stream ─▶ read/textStream catch ─▶ handlePrematureClose
   ├─ content present  ─▶ finishReason:'incomplete' ─▶ client connectionLost advisory (partial preserved)
   └─ no content       ─▶ fail fast ─▶ classifyTurnError ─▶ friendly timeout message
GoCode 408 pre-stream ─▶ generateError catch (no content) ─▶ friendly timeout message
```

## Cross-cutting concerns

- **Observability:** Content-present 408s will move from `sse.execution.error` (statusCode 408) to `sse.stream.premature_close.soft_commit`. Add a distinguishing field (`statusCode` and/or `trigger: 'upstream_timeout'`) to the soft-commit logs in both transports so the timeout rate stays measurable. Monitoring query updates accordingly (the investigation dashboard query must be revised).
- **Span/billing honesty:** Unchanged from prior work — soft-commit skips `getFinalResult()` (effectively unbilled) and records the Langfuse span as an error via `prematureCloseError` while the wire `finishReason` is the soft `incomplete`.
- **504 inclusion:** Observed evidence is 408 only; 504 included as a semantic gateway-timeout sibling (safe — committing already-streamed content as `incomplete` is always accurate). Drop to 408-only if preferred.
- **Mislabeling risk:** A 408/504 is unambiguously a timeout; soft-committing partial content as `incomplete` is safe in all cases.

## Testing

- `@airo/ai-transport`: unit tests for `isUpstreamTimeoutError` — 408 ✓, 504 ✓, 400/429/500 ✗, network-error ✗, non-`APICallError` ✗.
- SSE (`MessageExecutionService` tests): 408 mid-stream **with** content → `incomplete` soft-commit; 408 **without** content → fail-fast with friendly `clientMessage`. Extend existing premature-close tests.
- WS (`experimental-websocket-server` tests): 408 → `pendingSoftCommitReason` set → `finishReason: 'incomplete'`; parity with SSE.
- `classify-turn-error` test: 408/504 → `clientMessage` populated; other `APICallError` codes unchanged.
- Gate: `typecheck` / `lint` / `build` / unit tests green across `@airo/ai-transport`, `@airo/agents`, `website`.

## Acceptance criteria

1. A 408 with partial content streamed no longer shows a red error bubble; the partial response is preserved and the existing `connectionLost` advisory is shown.
2. A 408 with no content shows the friendly timeout message, not raw "Request Timeout".
3. SSE and WS behave identically.
4. Soft-committed timeouts remain queryable in Loki via a distinguishable log field.
5. No client or i18n changes required.
