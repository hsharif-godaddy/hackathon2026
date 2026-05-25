# SSE Client Lifecycle Parity

Date: 2026-05-25

## Context

PR #4085 extracted the transport-agnostic agent runtime (Blocker #1 from `docs/websocket-to-sse-parity-analysis-2026-05-25.md`). This is the second PR in the WebSocket replacement sequence, addressing four client-side gaps in `app/`:

1. Archive-restore reconnect (Blocker — Area 1)
2. Complete trace ID attribution (Missing — Area 1 / Area 7)
3. History pagination retry (Partial — Area 1)
4. History state reset on reconnect (subsumed by #1)

All changes are in `app/` (client-side). No `agents/` changes. Independent of PR #4085 — no file overlap or logical dependency.

## 1. Archive-Restore Reconnect

### Problem

After cold-archive restore, the agent runs at a new Nomad allocation URL. The SSE `reconnect()` (useSSEChat.ts:992) only refreshes the token and reconnects the existing transport instance — which still holds the stale `baseUrl` baked in at construction. Additionally, `dynamicApiConfigService` has the old URL cached, and `historyLoadingComplete` is already `true` from the initial page load, preventing history reload.

### Design

Rewrite `useSSEChat.reconnect()`:

```typescript
const reconnect = useCallback(async (): Promise<void> => {
  const appId = useStreamingConversationStore.getState().currentAppId
  if (!appId) return

  // 1. Evict stale URL from cache
  dynamicApiConfigService.clearCache(appId)

  // 2. Reset chat state so history reloads
  const store = useStreamingConversationStore.getState()
  store.clearMessages()
  store.setHistoryLoadingComplete(false)
  store.setHistoryLoadRequested(false)

  // 3. Destroy existing transport (holds stale baseUrl)
  if (transportRef.current) {
    transportRef.current.destroy()
    transportRef.current = null
    setTransport(null)
  }

  // 4. Trigger connect effect to re-run with fresh URL
  setReconnectNonce((n) => n + 1)
}, [])
```

Add `reconnectNonce` state:

```typescript
const [reconnectNonce, setReconnectNonce] = useState(0)
```

Add `reconnectNonce` to the connect effect's dependency array (the existing `useEffect` at line 311 that watches `currentAppId`). When the nonce increments, the effect re-fires: fetches fresh config (new `agent_url`), creates a new `SSETransport({ baseUrl })`, and connects.

### Why a nonce

The connect effect watches `currentAppId`. Archive restore doesn't change the appId — the same app just moved to a new allocation. A nonce is the lightest way to re-trigger the effect without introducing a fake appId transition or refactoring the effect into an imperative function.

## 2. Complete Trace IDs

### Problem

WebSocket's `CompleteHandler` extracts `traceId`, `observationId`, and `agentName` from the complete event and stores them via `useDevelopPageStore.setLastCompleteTraceIds()`. The feedback banner (`useAppGenerationFeedbackTrigger`) reads these to link user feedback to Langfuse traces. SSE's complete handler omits this — feedback submitted after an SSE turn has no trace linkage.

### Design

Add trace ID extraction after `store.finalizeStream(event.data)` in the SSE complete handler:

```typescript
const traceId = completeData?.traceId
const observationId = completeData?.observationId
if (typeof traceId === 'string' && typeof observationId === 'string' && traceId && observationId) {
  const agentName = typeof completeData?.agentId === 'string' && completeData.agentId.length > 0
    ? completeData.agentId : undefined
  useDevelopPageStore.getState().setLastCompleteTraceIds({ traceId, observationId, agentName })
} else {
  useDevelopPageStore.getState().setLastCompleteTraceIds(null)
}
```

Same extraction logic as `CompleteHandler.traceIdsFromComplete`.

## 3. History Pagination Retry

### Problem

When a paginated history fetch fails (`SSETransport.loadHistory` catch block), the transport emits `history_complete` with `{ hasMore: false, nextCursor: null }`. The hook then calls `store.setHistoryPagination({ hasMore: false, nextCursor: null })`, which destroys the cursor. The user cannot retry — the UI shows no "load more" affordance.

### Design

**Hook layer** — on pagination error, don't update pagination state:

```typescript
} else if (type === 'history_complete') {
  flushHistoryBatch(true)

  if ((event.data as any)?.error) {
    logger.warn('sse.history.complete.error', {
      appId: currentAppId, error: (event.data as any).error,
    })
    // Preserve existing pagination cursor — user can retry
  } else {
    store.setHistoryPagination({
      hasMore: typeof (event.data as any)?.hasMore === 'boolean' ? (event.data as any).hasMore : false,
      nextCursor: (event.data as any)?.nextCursor ?? null,
    })
  }
  store.setHistoryLoadingMore(false)
  // ... rest unchanged
}
```

**Transport layer** — on pagination failure, signal `hasMore: true` so the error path is distinguishable from "genuinely no more pages":

```typescript
// In .catch() when params.cursor is set (pagination):
this.callbacks?.onEvent({
  type: 'history_complete',
  data: { error: msg, hasMore: true, nextCursor: params.cursor ?? null, messageCount: 0 },
})
```

The hook's error branch means this data won't be consumed for pagination state, but it makes the transport's intent explicit and keeps the event self-describing for logging/debugging.

## 4. History State Reset

Subsumed by item #1. The `reconnect()` rewrite resets `historyLoadingComplete` and `historyLoadRequested` before triggering the connect effect, which then loads history as part of its normal flow.

## Files Touched

| File | Changes |
|------|---------|
| `app/src/hooks/useSSEChat.ts` | Reconnect rewrite (nonce + state resets), trace IDs in complete handler, pagination error handling |
| `app/src/services/transport/SSETransport.ts` | Pagination failure preserves cursor in emitted event |

## Tests

| Test file | Cases |
|-----------|-------|
| `app/src/hooks/__tests__/useSSEChat.test.ts` | Archive-restore reconnect: destroys transport, clears cache, creates new transport with fresh URL. Trace IDs: complete event with traceId/observationId updates store; complete without them sets null. Pagination: error preserves existing cursor and hasMore; user can retry. |
| `app/src/services/transport/__tests__/SSETransport.test.ts` | Pagination failure emits `hasMore: true` with original cursor. |

## Non-Goals

- Transport-agnostic reconnect abstraction (WS is dying; not worth the indirection)
- Server-side changes (all gaps are client-side)
- Changes to the archive-restore trigger in `page.tsx` (it already calls `ws.actions.reconnect()` which routes to whichever transport is active)
