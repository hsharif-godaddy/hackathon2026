---
title: Mid-stream budget exhaustion bypassed grant advancement
date: 2026-05-01
category: runtime-errors
module: ai-transport
problem_type: runtime_error
component: assistant
severity: high
symptoms:
  - "Customer with exhausted plan grant + available credit pack saw Usage Limit Reached modal"
  - "Mid-stream budget_exceeded errors (HTTP 200 sent, error in stream-part) bypassed grant advancement"
  - "grants.session.index_reset fired 1s after BudgetExceededError already propagated"
root_cause: logic_error
resolution_type: code_fix
tags:
  - grants
  - budget-service
  - websocket
  - streaming
  - gocode
  - mid-stream-error
  - retry
related_components:
  - ai-lib-websocket-server
  - sse-message-execution
  - streaming-conversation-store
---

# Mid-stream budget exhaustion bypassed grant advancement

## Problem

GoCode returns HTTP 200, streams tokens, then sends `budget_exceeded` as a stream-part error. All three existing grant advancement layers only caught pre-stream errors:

1. **Fetch interceptor** (`unified-provider.ts`) fires on HTTP 400 before stream starts
2. **Agent factory catch** (`agent-factory.ts`) fires when `streamGenerate()` throws before returning stream
3. **Frontend refresh** (`grant_context` event) reactive, fires after error reaches client (too late)

Customer with exhausted plan grant ($10.00 budget, $10.02 spent) and available credit pack (118 credits remaining) saw "Usage Limit Reached" modal instead of seamless retry.

## Symptoms

- "Usage Limit Reached" modal for customers with available credit packs
- Production logs: `BudgetExceededError` at 00:35:01, `grants.session.index_reset` at 00:35:02 (1s too late)
- GoCode error body: `ExceededBudget: End User=airo-builder:grant:7qygh3sip0 over budget`
- Existing fetch interceptor and streamGenerate catch never triggered for mid-stream errors

## What Didn't Work

- **Layer 1 (pre-emptive grant switching at <5% remaining)**: Implemented then reverted. Stranded ~75 credits per plan grant (5%) with no UX benefit since Layer 2's retry is sub-500ms and invisible. Also relied on stale cached `creditsSpent`. (session history)
- **Retry logic in streamGenerate catch**: Initial implementation placed the retry block in the `streamGenerate` try/catch (line ~3875), which only catches pre-stream API errors. Found during browser testing that `processStreamWithToolEvents` errors propagate to the `postStreamError` catch (line ~4482) instead.
- **Local dev testing**: `pnpm dev` uses 999999-credit mock grants that never exhaust. Required `SIMULATE_BUDGET_ERROR` env var with hooks in `onTextDelta` and `onToolResult` callbacks. (auto memory [claude])

## Solution

Four-layer recovery across transport, agents, and client:

### Transport: `onBudgetExhaustedMidStream` callback (`experimental-websocket-server.ts`)

```typescript
// In postStreamError catch block (NOT streamGenerate catch)
if (BudgetExceededError.isInstance(postStreamError) && this.config.onBudgetExhaustedMidStream && midStreamRetryCount < 3) {
  const executedToolNames = conv?.pendingToolCalls
    ? Array.from(conv.pendingToolCalls.values())
        .filter((tc) => (tc.status === 'completed' || tc.status === 'running') && typeof tc.name === 'string')
        .map((tc) => tc.name)
    : []

  const result = await Promise.race([callbackPromise, timeoutPromise]) // 10s timeout
  if (result.retry && result.newUserId) {
    metadata.user = result.newUserId
    if (!result.hasNonIdempotentTools) {
      // Layer 2: clean retry
      await this.publishToEventChannel(socket.id, 'stream_retry', '', { reason: 'budget_exceeded_grant_advanced' })
      return this.streamAgentResponse(socket, agent, data, context, agentName, startTime, shouldComplete, midStreamRetryCount + 1, originalPrompt)
    } else {
      // Layer 3: continuation (builds prompt with tool history + partial content)
      const continuationData = { ...data, message: continuationContext }
      return this.streamAgentResponse(socket, agent, continuationData, context, ...)
    }
  }
}
```

### Agents: callback wiring (`ai-lib-websocket-server.ts`)

```typescript
onBudgetExhaustedMidStream: async (socketId, _error, executedToolNames) => {
  const hasNonIdempotent = hasNonIdempotentTools(executedToolNames)
  const advanced = grantSessionManager.advanceToNextGrant(socketId)
  if (advanced) {
    const newUserId = grantSessionManager.getCurrentUserId(socketId)
    return { retry: true, newUserId, hasNonIdempotentTools: hasNonIdempotent }
  }
  // Fall through to requestGrantRefreshAndWait...
}
```

### Non-idempotent tool allowlist (`non-idempotent-tools.ts`)

```typescript
const NON_IDEMPOTENT_TOOL_NAMES = new Set([
  'socialpostpublish', 'manage_products', 'manage_inventory',
  'manage_pricing', 'manage_media', 'insertrow', 'updaterow', 'deleterow',
])
```

### Client: `StreamRetryHandler` + `clearStreamForRetry`

Handles `stream_retry` event by clearing content, segments, toolCalls, and all error flags before retry content arrives.

## Why This Works

**Correct error boundary**: Mid-stream errors from `processStreamWithToolEvents` propagate to `postStreamError` catch, not `streamGenerate` catch. The retry logic must live where the errors land.

**Idempotency safety**: Non-idempotent tool allowlist prevents duplicate side effects. `running` status tools included in the filter because side effects may have started even if the result wasn't recorded.

**Transparent to user**: Both Layer 2 (retry) and Layer 3 (continuation) are invisible to the customer. No modal, no interruption, sub-second grant advancement.

**Bounded retries**: Max 3 attempts with 10s callback timeout. Boolean sentinel distinguishes timeout from callback exception in error logging.

## Prevention

- **Streaming error handling audit**: when adding AI streaming calls, verify error handling in BOTH `streamGenerate` catch (pre-stream) AND `postStreamError` catch (mid-stream). These are separate try/catch blocks in `streamAgentResponse`.
- **Non-idempotent tool list maintenance**: when adding tools with external side effects (database writes, publish, deploy), add the lowercased base name to `NON_IDEMPOTENT_TOOL_NAMES` in `packages/ai-transport/src/non-idempotent-tools.ts`.
- **Browser testing for budget flows**: `pnpm dev` has 999999-credit mock grants. Use `SIMULATE_BUDGET_ERROR` env var with `SIMULATE_BUDGET_MODE` to test Layer 2, Layer 3, grants exhausted, and callback timeout scenarios.
- **Test with real grants**: use `pnpm run local:test` + budget-service-enabled test account for end-to-end grant advancement testing.

## Related Issues

- [Budget headers inherited on grant-fallback retry](../logic-errors/budget-headers-inherited-on-grant-fallback-retry-2026-04-06.md) (sibling retry-path hygiene pattern)
- [Budget reconciliation before completion](../best-practices/budget-reconciliation-before-completion-2026-04-08.md) (WebSocket lifecycle constraint)
- [NaN bypass budget-service fail-closed](../logic-errors/nan-bypass-budget-service-fail-closed-2026-04-06.md) (complementary billing safety)
- [Parallel reads blocking critical billing write](../logic-errors/parallel-reads-blocking-critical-billing-write-2026-04-07.md) (billing operation ordering)
- Slack thread: https://godaddy.slack.com/archives/C09E8ETF1FE/p1777572979706539
