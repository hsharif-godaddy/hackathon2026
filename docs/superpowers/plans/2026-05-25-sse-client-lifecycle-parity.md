# SSE Client Lifecycle Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four SSE client-side gaps — archive-restore reconnect, complete trace IDs, history pagination retry, and history state reset — so SSE matches WebSocket's user-visible behavior.

**Architecture:** All changes in `app/`. The SSE reconnect is rewritten to destroy/recreate the transport with a fresh URL lookup. Trace IDs are extracted from complete events identically to the WS CompleteHandler. Pagination error handling preserves cursor state for retry.

**Tech Stack:** React hooks, Zustand stores, SSETransport class, Vitest + React Testing Library

---

## File Map

| File | Responsibility | Action |
|------|---------------|--------|
| `app/src/hooks/useSSEChat.ts` | SSE chat hook with reconnect, event handling | Modify |
| `app/src/services/transport/SSETransport.ts` | Transport layer — EventSource management, history fetch | Modify |
| `app/src/hooks/__tests__/useSSEChat.test.ts` | Hook unit tests | Modify |
| `app/src/services/transport/__tests__/SSETransport.test.ts` | Transport unit tests | Modify |

---

### Task 1: Archive-Restore Reconnect — Tests

**Files:**
- Modify: `app/src/hooks/__tests__/useSSEChat.test.ts`

- [ ] **Step 1: Add `clearCache` to the dynamic-api mock**

The existing mock at line 219 only has `getConfigForSite`. Add `clearCache`:

```typescript
vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ baseUrl: 'https://agent.example.com' }),
    clearCache: vi.fn(),
  },
}))
```

- [ ] **Step 2: Add `clearMessages` to the store mock**

Add to `getStoreState()` return object (around line 72):

```typescript
clearMessages: vi.fn(),
```

And declare at the top with the other mocks (around line 40):

```typescript
const mockClearMessages = vi.fn()
```

Then add `clearMessages: mockClearMessages,` inside `getStoreState()` and add `mockClearMessages.mockClear()` inside `beforeEach`.

- [ ] **Step 3: Write reconnect test — destroys transport and triggers fresh connect**

Add a new `describe('reconnect')` block after the history loading section:

```typescript
describe('reconnect', () => {
  it('destroys transport, clears cache, resets history state, and creates new transport', async () => {
    const { dynamicApiConfigService } = await import('@/config/dynamic-api')
    mockConversationIdFromCookie = 'conv-abc-123'

    const { useSSEChat } = await import('@/hooks/useSSEChat')
    const hook = renderHook(() => useSSEChat())

    await act(async () => {
      await flushPromises()
    })

    const firstTransport = lastTransport
    expect(firstTransport.connect).toHaveBeenCalledTimes(1)

    // Simulate archive restore: new URL available
    vi.mocked(dynamicApiConfigService.getConfigForSite).mockResolvedValue({
      baseUrl: 'https://new-agent.example.com',
    })

    // Trigger reconnect
    await act(async () => {
      await hook.result.current.actions.reconnect()
      await flushPromises()
    })

    // Old transport destroyed
    expect(firstTransport.destroy).toHaveBeenCalled()

    // Cache cleared
    expect(dynamicApiConfigService.clearCache).toHaveBeenCalledWith('test-app-123')

    // History state reset
    expect(mockClearMessages).toHaveBeenCalled()
    expect(mockSetHistoryLoadingComplete).toHaveBeenCalledWith(false)
    expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(false)

    // New transport created with fresh URL
    const { SSETransport } = await import('@/services/transport/SSETransport')
    expect(SSETransport).toHaveBeenLastCalledWith({ baseUrl: 'https://new-agent.example.com' })

    hook.unmount()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter website test "useSSEChat" -t "destroys transport"`
Expected: FAIL — `reconnect` doesn't clear cache or destroy transport yet.

---

### Task 2: Archive-Restore Reconnect — Implementation

**Files:**
- Modify: `app/src/hooks/useSSEChat.ts`

- [ ] **Step 1: Add reconnectNonce state**

After the existing `useState` declarations (around line 177, near `transportState`), add:

```typescript
const [reconnectNonce, setReconnectNonce] = useState(0)
```

- [ ] **Step 2: Add reconnectNonce to the connect effect deps**

Find the connect effect (line 311, `useEffect(() => { if (!enabled || !currentAppId) return`). Add `reconnectNonce` to its dependency array. The current deps are approximately `[enabled, currentAppId]` — it becomes `[enabled, currentAppId, reconnectNonce]`.

- [ ] **Step 3: Rewrite the reconnect callback**

Replace the existing `reconnect` at line 992-1005:

```typescript
const reconnect = useCallback(async (): Promise<void> => {
  const appId = useStreamingConversationStore.getState().currentAppId
  if (!appId) return

  dynamicApiConfigService.clearCache(appId)

  const store = useStreamingConversationStore.getState()
  store.clearMessages()
  store.setHistoryLoadingComplete(false)
  store.setHistoryLoadRequested(false)

  if (transportRef.current) {
    transportRef.current.destroy()
    transportRef.current = null
    setTransport(null)
  }

  setReconnectNonce((n) => n + 1)
}, [])
```

- [ ] **Step 4: Run the reconnect test**

Run: `pnpm --filter website test "useSSEChat" -t "destroys transport"`
Expected: PASS

- [ ] **Step 5: Run the full useSSEChat test suite to check for regressions**

Run: `pnpm --filter website test "useSSEChat"`
Expected: All tests pass. The nonce starts at 0, so existing tests (which don't call reconnect) are unaffected.

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useSSEChat.ts app/src/hooks/__tests__/useSSEChat.test.ts
git commit -m "fix(sse): implement archive-restore reconnect with full state reset

Destroy stale transport, clear dynamic API cache and history flags,
then re-trigger connect effect via nonce so a fresh SSETransport is
created with the new agent URL.

Resolves parity analysis Blocker: Cold archive reconnect (Area 1)."
```

---

### Task 3: Complete Trace IDs — Tests

**Files:**
- Modify: `app/src/hooks/__tests__/useSSEChat.test.ts`

- [ ] **Step 1: Add `setLastCompleteTraceIds` to the useDevelopPageStore mock**

Update the mock at line 240:

```typescript
const mockSetLastCompleteTraceIds = vi.fn()

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: vi.fn().mockReturnValue({
      selectedModel: undefined,
      setLaunchVideoResult: mockSetLaunchVideoResult,
      setLastCompleteTraceIds: mockSetLastCompleteTraceIds,
    }),
  },
}))
```

Add `mockSetLastCompleteTraceIds.mockClear()` to `beforeEach`.

- [ ] **Step 2: Write test — complete event with trace IDs stores them**

Add inside the main `describe('useSSEChat')`:

```typescript
describe('complete trace IDs', () => {
  it('stores trace IDs from complete event in useDevelopPageStore', async () => {
    await setupHook()

    storeState.activeStream = { id: 'stream-1', role: 'assistant', content: '', segments: [], toolCalls: [], isComplete: false }

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'complete',
        data: {
          traceId: 'trace-abc',
          observationId: 'obs-xyz',
          agentId: 'builder',
          finishReason: 'stop',
        },
        content: undefined,
      })
    })

    expect(mockSetLastCompleteTraceIds).toHaveBeenCalledWith({
      traceId: 'trace-abc',
      observationId: 'obs-xyz',
      agentName: 'builder',
    })
  })

  it('sets trace IDs to null when complete event lacks them', async () => {
    await setupHook()

    storeState.activeStream = { id: 'stream-1', role: 'assistant', content: '', segments: [], toolCalls: [], isComplete: false }

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'complete',
        data: { finishReason: 'stop' },
        content: undefined,
      })
    })

    expect(mockSetLastCompleteTraceIds).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter website test "useSSEChat" -t "trace IDs"`
Expected: FAIL — `mockSetLastCompleteTraceIds` never called.

---

### Task 4: Complete Trace IDs — Implementation

**Files:**
- Modify: `app/src/hooks/useSSEChat.ts`

- [ ] **Step 1: Add useDevelopPageStore import**

Add at the top of the file with other store imports:

```typescript
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
```

- [ ] **Step 2: Add trace ID extraction in the complete handler**

In the `complete` branch (after `scheduleUsageRefresh()` at line 485), add:

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

- [ ] **Step 3: Run trace ID tests**

Run: `pnpm --filter website test "useSSEChat" -t "trace IDs"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/useSSEChat.ts app/src/hooks/__tests__/useSSEChat.test.ts
git commit -m "fix(sse): extract trace IDs from complete events for feedback linkage

Store traceId/observationId/agentName from SSE complete events in
useDevelopPageStore so the feedback banner can link to Langfuse traces.

Resolves parity analysis Missing: Complete trace attribution (Area 1/7)."
```

---

### Task 5: History Pagination Retry — Transport Test

**Files:**
- Modify: `app/src/services/transport/__tests__/SSETransport.test.ts`

- [ ] **Step 1: Write test — pagination failure preserves cursor in emitted event**

Add a new `describe('loadHistory')` block:

```typescript
describe('loadHistory', () => {
  it('emits history_complete with preserved cursor on pagination failure', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    // Mock a failed paginated fetch
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    })

    transport.loadHistory({ cursor: 'cursor-abc', limit: 20 })

    await vi.waitFor(() => {
      expect(callbacks.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'history_complete',
          data: expect.objectContaining({
            error: expect.any(String),
            hasMore: true,
            nextCursor: 'cursor-abc',
            messageCount: 0,
          }),
        })
      )
    })
  })

  it('emits history_loaded with hasMore false on initial load failure', async () => {
    transport.connect('app_1', 'token_123', 'conv_1')
    await vi.waitFor(() => {
      expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    })

    transport.loadHistory()

    await vi.waitFor(() => {
      expect(callbacks.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'history_loaded',
          data: expect.objectContaining({
            error: expect.any(String),
            hasMore: false,
            nextCursor: null,
            messageCount: 0,
          }),
        })
      )
    })
  })
})
```

- [ ] **Step 2: Run test to verify the pagination failure test fails**

Run: `pnpm --filter website test "SSETransport" -t "preserved cursor"`
Expected: FAIL — currently emits `hasMore: false`.

---

### Task 6: History Pagination Retry — Transport Implementation

**Files:**
- Modify: `app/src/services/transport/SSETransport.ts`

- [ ] **Step 1: Update the catch block in loadHistory**

In `SSETransport.loadHistory` (around line 331), change the `.catch()` handler:

Before:
```typescript
.catch((err: unknown) => {
  const msg = errMessage(err)
  logger.warn('sse.transport.load_history.failed', {
    appId: this.appId, conversationId: this.conversationId,
    isPagination: !!params.cursor, error: msg,
  })
  this.callbacks?.onEvent({
    type: params.cursor ? 'history_complete' : 'history_loaded',
    data: { error: msg, hasMore: false, nextCursor: null, messageCount: 0 },
  })
})
```

After:
```typescript
.catch((err: unknown) => {
  const msg = errMessage(err)
  const isPagination = !!params.cursor
  logger.warn('sse.transport.load_history.failed', {
    appId: this.appId, conversationId: this.conversationId,
    isPagination, error: msg,
  })
  this.callbacks?.onEvent({
    type: isPagination ? 'history_complete' : 'history_loaded',
    data: {
      error: msg,
      hasMore: isPagination,
      nextCursor: isPagination ? (params.cursor ?? null) : null,
      messageCount: 0,
    },
  })
})
```

- [ ] **Step 2: Run transport tests**

Run: `pnpm --filter website test "SSETransport" -t "loadHistory"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/src/services/transport/SSETransport.ts app/src/services/transport/__tests__/SSETransport.test.ts
git commit -m "fix(sse): preserve pagination cursor on history fetch failure

When a paginated history fetch fails, emit hasMore: true with the
original cursor so the client can retry. Initial (non-paginated) load
failures still emit hasMore: false.

Resolves parity analysis Partial: History pagination errors (Area 1)."
```

---

### Task 7: History Pagination Retry — Hook Test

**Files:**
- Modify: `app/src/hooks/__tests__/useSSEChat.test.ts`

- [ ] **Step 1: Write test — pagination error preserves existing cursor**

Add inside the `describe('history loading')` block:

```typescript
it('does not clear pagination state when history_complete has error', async () => {
  mockConversationIdFromCookie = 'conv-abc-123'
  await setupHook()

  // Simulate initial successful page load that set pagination state
  act(() => {
    lastTransport.callbacks?.onEvent({
      type: 'recovery_status',
      data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
    })
  })

  act(() => {
    lastTransport.callbacks?.onEvent({
      type: 'history_loaded',
      data: { hasMore: true, nextCursor: 'cursor-page-2', messageCount: 25 },
    })
  })

  expect(mockSetHistoryPagination).toHaveBeenLastCalledWith({
    hasMore: true,
    nextCursor: 'cursor-page-2',
  })
  mockSetHistoryPagination.mockClear()

  // Simulate pagination failure
  act(() => {
    lastTransport.callbacks?.onEvent({
      type: 'history_complete',
      data: { error: 'History fetch failed: 500', hasMore: true, nextCursor: 'cursor-page-2', messageCount: 0 },
    })
  })

  // Pagination state NOT cleared — cursor preserved
  expect(mockSetHistoryPagination).not.toHaveBeenCalled()
  expect(mockSetHistoryLoadingMore).toHaveBeenCalledWith(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "useSSEChat" -t "does not clear pagination"`
Expected: FAIL — currently calls `setHistoryPagination({ hasMore: false, nextCursor: null })`.

---

### Task 8: History Pagination Retry — Hook Implementation

**Files:**
- Modify: `app/src/hooks/useSSEChat.ts`

- [ ] **Step 1: Update the history_complete error branch**

Find the `history_complete` handler (around line 767). Change:

Before:
```typescript
} else if (type === 'history_complete') {
  flushHistoryBatch(true)

  if ((event.data as any)?.error) {
    logger.warn('sse.history.complete.error', {
      appId: currentAppId, error: (event.data as any).error,
    })
    // Clear pagination so stale hasMore/nextCursor from a prior
    // page don't trigger further load attempts after a failure.
    store.setHistoryPagination({ hasMore: false, nextCursor: null })
  } else {
    store.setHistoryPagination({
      hasMore: typeof (event.data as any)?.hasMore === 'boolean' ? (event.data as any).hasMore : false,
      nextCursor: (event.data as any)?.nextCursor ?? null,
    })
  }
  store.setHistoryLoadingMore(false)
```

After:
```typescript
} else if (type === 'history_complete') {
  flushHistoryBatch(true)

  if ((event.data as any)?.error) {
    logger.warn('sse.history.complete.error', {
      appId: currentAppId, error: (event.data as any).error,
    })
  } else {
    store.setHistoryPagination({
      hasMore: typeof (event.data as any)?.hasMore === 'boolean' ? (event.data as any).hasMore : false,
      nextCursor: (event.data as any)?.nextCursor ?? null,
    })
  }
  store.setHistoryLoadingMore(false)
```

The only change: remove `store.setHistoryPagination({ hasMore: false, nextCursor: null })` from the error branch. The existing cursor from the last successful page remains — the user can scroll up again to retry.

- [ ] **Step 2: Run the pagination retry test**

Run: `pnpm --filter website test "useSSEChat" -t "does not clear pagination"`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm --filter website test "useSSEChat"`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/useSSEChat.ts app/src/hooks/__tests__/useSSEChat.test.ts
git commit -m "fix(sse): preserve pagination cursor on history load failure

On error, skip updating pagination state so the existing cursor
remains valid for retry. Previously the cursor was wiped, making
'load more' disappear permanently after a transient failure.

Resolves parity analysis Partial: History pagination errors (Area 1)."
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full website test suite**

Run: `pnpm --filter website test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: No errors.

- [ ] **Step 3: Run lint**

Run: `pnpm --filter website lint`
Expected: No errors (or only pre-existing warnings).

- [ ] **Step 4: Verify no import/reference issues**

Run: `grep -n "useDevelopPageStore" app/src/hooks/useSSEChat.ts` — confirm the import exists.
Run: `grep -n "clearCache" app/src/hooks/useSSEChat.ts` — confirm it's called in reconnect.
Run: `grep -n "reconnectNonce" app/src/hooks/useSSEChat.ts` — confirm state + dep array usage.
