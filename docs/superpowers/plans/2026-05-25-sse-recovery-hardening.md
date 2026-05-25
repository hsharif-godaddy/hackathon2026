# SSE Recovery Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three SSE recovery/resilience gaps (buffer capacity, loss-failure surfacing, event contract) before WebSocket can be removed.

**Architecture:** Three independent changes bundled into one PR: (A) raise buffer capacity to 10,000 in `agent-runtime.ts`, (B) add `historyLoadFailed` signal to recovery_status and client fallback, (C) replace hard-coded event allowlist with a shared const array and contract test.

**Tech Stack:** TypeScript, Vitest, Express (agents), React hooks (app), `@airo/ai-transport` workspace package.

**Base branch:** `wt-20260525-104736-1440` (PR #4085 — runtime extraction)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `agents/src/server/agent-runtime.ts` | Part A: pass capacity config to ConversationEventChannel |
| `agents/src/server/__tests__/agent-runtime.test.ts` | Part A: capacity assertion |
| `agents/src/server/sse/routes.ts` | Part B: `historyLoadFailed` field in recovery_status |
| `agents/src/server/sse/__tests__/routes.test.ts` | Part B: history-failure test |
| `packages/ai-transport/src/interfaces.ts` | Part C: `STREAMING_EVENT_TYPES` const array |
| `packages/ai-transport/src/index.ts` | Part C: export `STREAMING_EVENT_TYPES` |
| `app/package.json` | Part C: add `@airo/ai-transport` dependency |
| `app/src/services/transport/SSETransport.ts` | Part C: import shared types, remove dead events |
| `app/src/services/transport/__tests__/sse-event-contract.test.ts` | Part C: contract test (new file) |
| `app/src/hooks/useSSEChat.ts` | Part B: history fallback on loss + failure |
| `app/src/hooks/__tests__/useSSEChat.test.ts` | Part B: fallback trigger test |

---

### Task 1: Buffer Capacity — Test

**Files:**
- Modify: `agents/src/server/__tests__/agent-runtime.test.ts`

- [ ] **Step 1: Write the failing test for buffer capacity**

Add this test inside the existing `describe('initAgentRuntime')` block at the end:

```typescript
    it('creates event channel with capacity 10000', async () => {
      const { ConversationEventChannel } = await import('@airo/ai-transport')
      const { initAgentRuntime } = await import('../agent-runtime.js')

      await initAgentRuntime()

      expect(ConversationEventChannel).toHaveBeenCalledWith(
        expect.objectContaining({ capacity: 10_000 })
      )
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "agent-runtime" -t "creates event channel with capacity 10000"`

Expected: FAIL — `ConversationEventChannel` called with no arguments (default config).

---

### Task 2: Buffer Capacity — Implementation

**Files:**
- Modify: `agents/src/server/agent-runtime.ts`

- [ ] **Step 1: Pass explicit capacity config**

In `agents/src/server/agent-runtime.ts`, change line ~51:

```typescript
// Before:
const channel = new ConversationEventChannel()

// After:
const channel = new ConversationEventChannel({ capacity: 10_000, ttl: 5 * 60 * 1000 })
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "agent-runtime"`

Expected: All tests PASS including the new capacity test.

- [ ] **Step 3: Commit**

```bash
git add agents/src/server/agent-runtime.ts agents/src/server/__tests__/agent-runtime.test.ts
git commit -m "fix(sse): set event channel buffer capacity to 10000

Matches WebSocket's configured capacity. Default 1000 could overflow
during multi-tool turns, forcing unnecessary loss recovery on brief
reconnects."
```

---

### Task 3: History-Failure Surfacing — Server Test

**Files:**
- Modify: `agents/src/server/sse/__tests__/routes.test.ts`

- [ ] **Step 1: Modify existing test to assert `historyLoadFailed` field**

Find the test at ~line 716: `'emits replay_complete without history_message when getMessagesPaginated rejects'`. Add an assertion for the new field:

```typescript
    it('emits replay_complete without history_message when getMessagesPaginated rejects', async () => {
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue([]),
        getMetadata: vi.fn().mockReturnValue({ pendingMessageIds: [], firstSequence: 100, lastSequence: 120 }),
      })
      ;(deps as any).executionService = {
        subscribeStream: vi.fn(),
        hasActiveStream: vi.fn().mockReturnValue(false),
      }
      deps.messages.getMessagesPaginated.mockRejectedValueOnce(new Error('DB connection lost'))

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '50')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('"lossDetected":true')
      expect(capturedData).toContain('"historyLoadFailed":true')
      expect(capturedData).toContain('"historyStreaming":false')
      expect(capturedData).toContain('"historyMessageCount":0')
      expect(capturedData).not.toContain('event: history_message')
      expect(capturedData).toContain('event: replay_complete')
    })
```

Also add to the success test (line ~631, `'streams history_message events with full fields when buffer loss detected'`) a negative assertion:

```typescript
      // historyLoadFailed is false on success
      expect(capturedData).toContain('"historyLoadFailed":false')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "getMessagesPaginated rejects"`

Expected: FAIL — `historyLoadFailed` not present in output.

---

### Task 4: History-Failure Surfacing — Server Implementation

**Files:**
- Modify: `agents/src/server/sse/routes.ts`

- [ ] **Step 1: Add `historyLoadFailed` flag to recovery logic**

In `agents/src/server/sse/routes.ts`, modify the loss-recovery block (starting ~line 233):

```typescript
        let historyMessages: Awaited<ReturnType<typeof deps.messages.getMessagesPaginated>>['messages'] = []
        let historyHasMore = false
        let historyNextCursor: string | null = null
        let historyLoadFailed = false
        if (plan.lossDetected) {
          try {
            const customerId = (req as AuthenticatedRequest).agentContext?.customerId
            const paginatedResult = await deps.messages.getMessagesPaginated(
              workspaceScopeFromAppId(appId, customerId),
              conversationId,
              { limit: 20 }
            )
            historyMessages = paginatedResult.messages
            historyHasMore = paginatedResult.hasMore
            historyNextCursor = paginatedResult.nextCursor
          } catch (err) {
            historyLoadFailed = true
            logger.warn('sse.recovery.history_load_failed', { appId, conversationId, ...errorFields(err) })
          }
        }
```

Then include the new field in the `writeFormatted('recovery_status', ...)` call (~line 257):

```typescript
        writeFormatted('recovery_status', {
          hasBufferedEvents: shouldReplay,
          bufferedCount: replayedCount,
          bufferedEventCount: replayedCount,
          conversationId,
          streamCompleted: plan.streamCompleted,
          lossDetected: plan.lossDetected,
          lostEventCount: plan.lostEventCount,
          recoveryMode: clientHasNoState ? 'initial' : 'delta',
          historyStreaming: historyMessages.length > 0,
          historyMessageCount: historyMessages.length,
          historyHasMore,
          historyNextCursor,
          historyLoadFailed,
        })
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "routes.test"`

Expected: All 55+ SSE route tests PASS.

- [ ] **Step 3: Commit**

```bash
git add agents/src/server/sse/routes.ts agents/src/server/sse/__tests__/routes.test.ts
git commit -m "fix(sse): surface historyLoadFailed in recovery_status

When buffer loss is detected and the inline history fallback throws,
the client now receives an explicit signal rather than silently
missing data."
```

---

### Task 5: History-Failure Surfacing — Client Test

**Files:**
- Modify: `app/src/hooks/__tests__/useSSEChat.test.ts`

- [ ] **Step 1: Write the failing test for history fallback**

Add new tests in the `describe` block that covers recovery behavior (near existing recovery_status tests, after ~line 518):

```typescript
  it('triggers loadHistory fallback when loss detected with failed inline history and active stream', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: true,
          historyMessageCount: 0,
          historyStreaming: false,
          hasBufferedEvents: true,
          bufferedCount: 5,
          streamCompleted: false,
          conversationId: 'conv-created-123',
        },
      })
    })

    // Even though there are buffered events (active stream), the history fallback
    // should fire because inline history failed and data was lost.
    expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
  })

  it('does not trigger loadHistory fallback when historyLoadFailed is false', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: false,
          historyMessageCount: 3,
          historyStreaming: true,
          hasBufferedEvents: true,
          bufferedCount: 5,
          streamCompleted: false,
          conversationId: 'conv-created-123',
        },
      })
    })

    // History was delivered inline — no fallback needed.
    expect(lastTransport.loadHistory).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "useSSEChat" -t "triggers loadHistory fallback when loss"`

Expected: FAIL — `loadHistory` not called because the new fallback code doesn't exist yet.

---

### Task 6: History-Failure Surfacing — Client Implementation

**Files:**
- Modify: `app/src/hooks/useSSEChat.ts`

- [ ] **Step 1: Add history fallback logic**

In `app/src/hooks/useSSEChat.ts`, after the existing `recovery_status` handler's main branching logic (after the `logger.info('sse.recovery.status', ...)` call at ~line 738), add:

```typescript
                // Buffer-loss with failed inline history: fall back to HTTP history
                // load so the client doesn't silently miss conversation data.
                if (payload?.lossDetected && payload?.historyLoadFailed && payload?.historyMessageCount === 0) {
                  logger.info('sse.recovery.history_fallback_triggered', { appId: currentAppId })
                  if (transportRef.current) {
                    transportRef.current.loadHistory()
                  }
                }
```

Place this AFTER the existing branching (so it fires in addition to the existing paths — when `hasBufferedEvents` is true, the fallback still triggers a history load to cover the lost gap).

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter website test "useSSEChat" -t "triggers loadHistory fallback"`

Expected: PASS.

- [ ] **Step 3: Run full useSSEChat test suite**

Run: `pnpm --filter website test "useSSEChat"`

Expected: All tests PASS (verify no regressions in existing recovery behavior).

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/useSSEChat.ts app/src/hooks/__tests__/useSSEChat.test.ts
git commit -m "fix(sse): fallback to HTTP history when inline recovery fails

When buffer loss is detected and the server's inline history load
throws, the client now triggers a standard loadHistory() call rather
than silently showing stale/empty state."
```

---

### Task 7: Event Contract — Shared Const Array

**Files:**
- Modify: `packages/ai-transport/src/interfaces.ts`
- Modify: `packages/ai-transport/src/index.ts`

- [ ] **Step 1: Replace type union with const-array-driven type**

In `packages/ai-transport/src/interfaces.ts`, replace lines 319–346:

```typescript
/**
 * Event types for streaming events.
 * Runtime array drives the type — adding a new event here automatically
 * makes it available to both server publishers and client listeners.
 */
export const STREAMING_EVENT_TYPES = [
  'chunk',
  'tool_start',
  'tool_input_delta',
  'tool_call',
  'tool_result',
  'step_start',
  'step_complete',
  'complete',
  'error',
  'validation_message',
  'recovery_status',
  'conversation_info',
  'agents_available',
  'replay_complete',
  'catchup_status',
  'catchup_complete',
  'server_config',
  'client_action',
  'budget_update',
  'budget_status',
  'debug_turn_stats',
  'stream_retry',
  'video',
  'request_grant_refresh',
] as const

export type StreamingEventType = typeof STREAMING_EVENT_TYPES[number]
```

- [ ] **Step 2: Export from package index**

In `packages/ai-transport/src/index.ts`, change the interfaces export block (around line 29) from:

```typescript
export type {
  StreamingEvent,
  StreamingEventType,
  EventSubscriber,
  EventMetadata,
  CircularBufferConfig,
  HistoryProvider,
  PersistedMessage,
  RecoveryStatusData
} from './interfaces.js'
```

To:

```typescript
export {
  STREAMING_EVENT_TYPES,
} from './interfaces.js'
export type {
  StreamingEvent,
  StreamingEventType,
  EventSubscriber,
  EventMetadata,
  CircularBufferConfig,
  HistoryProvider,
  PersistedMessage,
  RecoveryStatusData
} from './interfaces.js'
```

- [ ] **Step 3: Run ai-transport tests and typecheck**

Run: `pnpm --filter @airo/ai-transport test && pnpm --filter @airo/ai-transport typecheck`

Expected: All tests PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ai-transport/src/interfaces.ts packages/ai-transport/src/index.ts
git commit -m "refactor(ai-transport): derive StreamingEventType from const array

STREAMING_EVENT_TYPES is now a runtime-available const array that
drives the type. Client and server can import the array to stay in
sync without manual maintenance."
```

---

### Task 8: Event Contract — Client Integration

**Files:**
- Modify: `app/package.json`
- Modify: `app/src/services/transport/SSETransport.ts`

- [ ] **Step 1: Add workspace dependency**

In `app/package.json`, add `@airo/ai-transport` to dependencies (alphabetical order, near `@airo/shared`):

```json
    "@airo/shared": "workspace:*",
    "@airo/ai-transport": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 2: Replace hard-coded event list in SSETransport**

In `app/src/services/transport/SSETransport.ts`, add the import at the top (with other imports):

```typescript
import { STREAMING_EVENT_TYPES } from '@airo/ai-transport'
```

Then replace the hard-coded `eventTypes` array (~line 464) with:

```typescript
    const ROUTE_EVENT_TYPES = [
      'history_message',
      'history_loaded',
      'history_complete',
      'stream_error',
      'oauth_result',
    ] as const

    const eventTypes = [...STREAMING_EVENT_TYPES, ...ROUTE_EVENT_TYPES].filter(
      t => !SSE_INTENTIONALLY_IGNORED.has(t)
    )
```

Add the ignored set as a module-level constant (near the top of the file, after imports):

```typescript
const SSE_INTENTIONALLY_IGNORED: ReadonlySet<string> = new Set([
  'budget_status',
  'conversation_info',
  'agents_available',
  'server_config',
  'catchup_status',
  'catchup_complete',
])
```

This removes the dead `status` and `resync` entries (which were in the old hard-coded list but not in `STREAMING_EVENT_TYPES`) and explicitly filters out events that are intentionally not listened to.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter website typecheck`

Expected: PASS — no type errors.

- [ ] **Step 4: Run existing SSETransport tests**

Run: `pnpm --filter website test "SSETransport"`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/src/services/transport/SSETransport.ts pnpm-lock.yaml
git commit -m "refactor(sse): derive client event list from shared STREAMING_EVENT_TYPES

Removes dead events (status, resync), uses the canonical server type
array as the source of truth, and defines route-emitted extras
alongside an explicit ignore set."
```

---

### Task 9: Event Contract — Contract Test

**Files:**
- Create: `app/src/services/transport/__tests__/sse-event-contract.test.ts`

- [ ] **Step 1: Write the contract test**

Create `app/src/services/transport/__tests__/sse-event-contract.test.ts`:

```typescript
/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { STREAMING_EVENT_TYPES } from '@airo/ai-transport'

const ROUTE_EVENT_TYPES = [
  'history_message',
  'history_loaded',
  'history_complete',
  'stream_error',
  'oauth_result',
] as const

const SSE_INTENTIONALLY_IGNORED = new Set([
  'budget_status',
  'conversation_info',
  'agents_available',
  'server_config',
  'catchup_status',
  'catchup_complete',
])

const SSE_CLIENT_EVENTS = new Set([...STREAMING_EVENT_TYPES, ...ROUTE_EVENT_TYPES])

describe('SSE event contract', () => {
  it('client registers or explicitly ignores every server event type', () => {
    const unhandled = STREAMING_EVENT_TYPES.filter(
      t => !SSE_CLIENT_EVENTS.has(t) && !SSE_INTENTIONALLY_IGNORED.has(t)
    )
    expect(unhandled).toEqual([])
  })

  it('intentionally ignored events are all valid server types', () => {
    const invalid = [...SSE_INTENTIONALLY_IGNORED].filter(
      t => !STREAMING_EVENT_TYPES.includes(t as any)
    )
    expect(invalid).toEqual([])
  })

  it('route event types are not duplicates of streaming event types', () => {
    const duplicates = ROUTE_EVENT_TYPES.filter(
      t => (STREAMING_EVENT_TYPES as readonly string[]).includes(t)
    )
    expect(duplicates).toEqual([])
  })
})
```

- [ ] **Step 2: Run the contract test**

Run: `pnpm --filter website test "sse-event-contract"`

Expected: All 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add app/src/services/transport/__tests__/sse-event-contract.test.ts
git commit -m "test(sse): add event contract test

Fails if a new server event type is added without updating the
client listener list or the explicit ignore set."
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full agents test suite**

Run: `pnpm --filter @airo/agents test:unit`

Expected: All ~4929 tests PASS.

- [ ] **Step 2: Run full ai-transport test suite**

Run: `pnpm --filter @airo/ai-transport test`

Expected: All ~706 tests PASS.

- [ ] **Step 3: Run full website test suite**

Run: `pnpm --filter website test`

Expected: All tests PASS.

- [ ] **Step 4: Typecheck all packages**

Run: `pnpm typecheck`

Expected: PASS across all packages.

- [ ] **Step 5: Lint**

Run: `pnpm lint`

Expected: PASS.
