# SSE Operational Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a no-subscriber abort timer so SSE execution aborts after 2 minutes when all clients disconnect, and add zero-delivery logging to app-level fanout.

**Architecture:** `EventStreamRegistry` gains a listener callback that notifies `MessageExecutionService` when the last subscriber for a conversation leaves or a new subscriber arrives. `MessageExecutionService` manages per-conversation timers that abort execution after timeout. App-level `sendToApp` gains a log line when delivery count is zero.

**Tech Stack:** TypeScript, Vitest, Express (agents service)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `agents/src/server/sse/EventStreamRegistry.ts` | Add `SubscriberLifecycleListener` interface, invoke callbacks on register/unregister |
| `agents/src/server/sse/MessageExecutionService.ts` | Implement listener, manage `noSubscriberTimers` map, abort on timeout |
| `agents/src/server/app.ts` | Wire listener when creating `MessageExecutionService` |
| `agents/src/server/sse/__tests__/EventStreamRegistry.test.ts` | Tests for listener callback invocation |
| `agents/src/server/sse/__tests__/no-subscriber-abort.test.ts` | Timer lifecycle tests (start, cancel, fire, cleanup) |

---

### Task 1: Add SubscriberLifecycleListener to EventStreamRegistry

**Files:**
- Modify: `agents/src/server/sse/EventStreamRegistry.ts`
- Modify: `agents/src/server/sse/__tests__/EventStreamRegistry.test.ts`

- [ ] **Step 1: Write failing tests for listener callbacks**

Add to `agents/src/server/sse/__tests__/EventStreamRegistry.test.ts`:

```typescript
describe('subscriber lifecycle listener', () => {
  it('calls onLastSubscriberLeft when last subscriber unregisters during active conversation', () => {
    const listener = { onLastSubscriberLeft: vi.fn(), onSubscriberAdded: vi.fn() }
    const registry = new EventStreamRegistry(listener)
    const writer = createMockWriter()
    const { subscriber } = registry.register('conv_1', 'app_1', writer)

    registry.unregister('conv_1', subscriber)

    expect(listener.onLastSubscriberLeft).toHaveBeenCalledWith('conv_1')
  })

  it('does not call onLastSubscriberLeft when other subscribers remain', () => {
    const listener = { onLastSubscriberLeft: vi.fn(), onSubscriberAdded: vi.fn() }
    const registry = new EventStreamRegistry(listener)
    const w1 = createMockWriter()
    const w2 = createMockWriter()
    registry.register('conv_1', 'app_1', w1)
    const { subscriber: sub2 } = registry.register('conv_1', 'app_1', w2)

    registry.unregister('conv_1', sub2)

    expect(listener.onLastSubscriberLeft).not.toHaveBeenCalled()
  })

  it('calls onSubscriberAdded on register', () => {
    const listener = { onLastSubscriberLeft: vi.fn(), onSubscriberAdded: vi.fn() }
    const registry = new EventStreamRegistry(listener)
    const writer = createMockWriter()

    registry.register('conv_1', 'app_1', writer)

    expect(listener.onSubscriberAdded).toHaveBeenCalledWith('conv_1')
  })

  it('calls onLastSubscriberLeft when sendToAll removes the last dead writer', () => {
    const listener = { onLastSubscriberLeft: vi.fn(), onSubscriberAdded: vi.fn() }
    const registry = new EventStreamRegistry(listener)
    const bad = createMockWriter()
    ;(bad.write as any).mockImplementation(() => { throw new Error('broken pipe') })
    registry.register('conv_1', 'app_1', bad)

    registry.sendToAll('conv_1', 'test', { foo: 'bar' })

    expect(listener.onLastSubscriberLeft).toHaveBeenCalledWith('conv_1')
  })

  it('works without a listener (backward compatible)', () => {
    const registry = new EventStreamRegistry()
    const writer = createMockWriter()
    const { subscriber } = registry.register('conv_1', 'app_1', writer)

    expect(() => registry.unregister('conv_1', subscriber)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/EventStreamRegistry.test.ts"`
Expected: FAIL — `EventStreamRegistry` constructor does not accept a listener argument

- [ ] **Step 3: Implement listener interface and callbacks**

In `agents/src/server/sse/EventStreamRegistry.ts`, add the interface and modify the class:

```typescript
export interface SubscriberLifecycleListener {
  onLastSubscriberLeft(conversationId: string): void
  onSubscriberAdded(conversationId: string): void
}
```

Modify the constructor to accept an optional listener:

```typescript
export class EventStreamRegistry {
  private connections = new Map<string, Set<SSEConnection>>()
  private listener: SubscriberLifecycleListener | undefined

  constructor(listener?: SubscriberLifecycleListener) {
    this.listener = listener
  }
```

In `register()`, after adding the connection to the set, call:

```typescript
this.listener?.onSubscriberAdded(conversationId)
```

In `unregister()`, after the existing `if (conns.size === 0) this.connections.delete(conversationId)` line, add:

```typescript
if (conns.size === 0) {
  this.connections.delete(conversationId)
  this.listener?.onLastSubscriberLeft(conversationId)
}
```

(Replace the existing `if (conns.size === 0) this.connections.delete(conversationId)` — fold the delete into the same block.)

In `sendToAll()`, after the dead-writer cleanup loop, the existing `if (conns.size === 0) this.connections.delete(conversationId)` should also notify:

```typescript
if (conns.size === 0) {
  this.connections.delete(conversationId)
  this.listener?.onLastSubscriberLeft(conversationId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/EventStreamRegistry.test.ts"`
Expected: All tests PASS (including existing tests — no listener means no callback, backward compatible)

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/sse/EventStreamRegistry.ts agents/src/server/sse/__tests__/EventStreamRegistry.test.ts
git commit -m "feat(sse): add SubscriberLifecycleListener to EventStreamRegistry"
```

---

### Task 2: Add no-subscriber abort timer to MessageExecutionService

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts`
- Create: `agents/src/server/sse/__tests__/no-subscriber-abort.test.ts`

- [ ] **Step 1: Write failing tests for timer lifecycle**

Create `agents/src/server/sse/__tests__/no-subscriber-abort.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MessageExecutionService } from '../MessageExecutionService.js'
import type { EventStreamRegistry } from '../EventStreamRegistry.js'

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  errorFields: (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
}))

vi.mock('@airo/ai-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/ai-transport')>()
  return {
    ...actual,
    parseChunkTimeoutMs: () => 30000,
  }
})

function createMinimalDeps(overrides: Record<string, unknown> = {}) {
  return {
    getAgent: vi.fn(),
    contextManager: { loadContextMessages: vi.fn().mockResolvedValue({ contextMessages: [] }) },
    loadConversationHistory: vi.fn().mockResolvedValue([]),
    conversationPersistence: {
      continueConversation: vi.fn().mockResolvedValue(undefined),
      startAgentTurn: vi.fn().mockResolvedValue('msg-1'),
      completeConversation: vi.fn().mockResolvedValue(undefined),
    },
    eventChannel: {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      markMessageEventsPersisted: vi.fn().mockReturnValue(1),
    },
    sseRegistry: {
      getSubscribers: vi.fn().mockReturnValue([]),
    } as unknown as EventStreamRegistry,
    stateManager: {
      getCurrentAgent: vi.fn(),
      getLastHandoffPrompt: vi.fn(),
      clearLastHandoffPrompt: vi.fn(),
      setSessionMetadata: vi.fn(),
      getSelectedTodoList: vi.fn(),
      setSelectedTodoList: vi.fn(),
    },
    ...overrides,
  } as any
}

describe('MessageExecutionService no-subscriber abort timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts timer when onLastSubscriberLeft is called during active stream', () => {
    const deps = createMinimalDeps()
    const service = new MessageExecutionService(deps)

    // Simulate an active stream by directly setting internal state
    const activeStreams = (service as any).activeStreams as Map<string, unknown>
    const abortControllers = (service as any).abortControllers as Map<string, AbortController>
    const controller = new AbortController()
    activeStreams.set('conv_1', { appId: 'app_1', convId: 'conv_1', subscriberIds: new Set() })
    abortControllers.set('conv_1', controller)

    service.onLastSubscriberLeft('conv_1')

    const timers = (service as any).noSubscriberTimers as Map<string, NodeJS.Timeout>
    expect(timers.has('conv_1')).toBe(true)
  })

  it('does not start timer when no active stream exists', () => {
    const deps = createMinimalDeps()
    const service = new MessageExecutionService(deps)

    service.onLastSubscriberLeft('conv_1')

    const timers = (service as any).noSubscriberTimers as Map<string, NodeJS.Timeout>
    expect(timers.has('conv_1')).toBe(false)
  })

  it('cancels timer when onSubscriberAdded is called', () => {
    const deps = createMinimalDeps()
    const service = new MessageExecutionService(deps)

    const activeStreams = (service as any).activeStreams as Map<string, unknown>
    const abortControllers = (service as any).abortControllers as Map<string, AbortController>
    const controller = new AbortController()
    activeStreams.set('conv_1', { appId: 'app_1', convId: 'conv_1', subscriberIds: new Set() })
    abortControllers.set('conv_1', controller)

    service.onLastSubscriberLeft('conv_1')
    service.onSubscriberAdded('conv_1')

    const timers = (service as any).noSubscriberTimers as Map<string, NodeJS.Timeout>
    expect(timers.has('conv_1')).toBe(false)
  })

  it('aborts execution when timer fires', () => {
    const deps = createMinimalDeps()
    const service = new MessageExecutionService(deps)

    const activeStreams = (service as any).activeStreams as Map<string, unknown>
    const abortControllers = (service as any).abortControllers as Map<string, AbortController>
    const controller = new AbortController()
    activeStreams.set('conv_1', { appId: 'app_1', convId: 'conv_1', subscriberIds: new Set() })
    abortControllers.set('conv_1', controller)

    service.onLastSubscriberLeft('conv_1')
    vi.advanceTimersByTime(120_000)

    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBe('no_subscriber_timeout')
  })

  it('does not abort if timer was cancelled by reconnect', () => {
    const deps = createMinimalDeps()
    const service = new MessageExecutionService(deps)

    const activeStreams = (service as any).activeStreams as Map<string, unknown>
    const abortControllers = (service as any).abortControllers as Map<string, AbortController>
    const controller = new AbortController()
    activeStreams.set('conv_1', { appId: 'app_1', convId: 'conv_1', subscriberIds: new Set() })
    abortControllers.set('conv_1', controller)

    service.onLastSubscriberLeft('conv_1')
    service.onSubscriberAdded('conv_1')
    vi.advanceTimersByTime(120_000)

    expect(controller.signal.aborted).toBe(false)
  })

  it('cleans up timer map entry after timer fires', () => {
    const deps = createMinimalDeps()
    const service = new MessageExecutionService(deps)

    const activeStreams = (service as any).activeStreams as Map<string, unknown>
    const abortControllers = (service as any).abortControllers as Map<string, AbortController>
    activeStreams.set('conv_1', { appId: 'app_1', convId: 'conv_1', subscriberIds: new Set() })
    abortControllers.set('conv_1', new AbortController())

    service.onLastSubscriberLeft('conv_1')
    vi.advanceTimersByTime(120_000)

    const timers = (service as any).noSubscriberTimers as Map<string, NodeJS.Timeout>
    expect(timers.has('conv_1')).toBe(false)
  })

  it('replaces existing timer if onLastSubscriberLeft called twice', () => {
    const deps = createMinimalDeps()
    const service = new MessageExecutionService(deps)

    const activeStreams = (service as any).activeStreams as Map<string, unknown>
    const abortControllers = (service as any).abortControllers as Map<string, AbortController>
    const controller = new AbortController()
    activeStreams.set('conv_1', { appId: 'app_1', convId: 'conv_1', subscriberIds: new Set() })
    abortControllers.set('conv_1', controller)

    service.onLastSubscriberLeft('conv_1')
    vi.advanceTimersByTime(60_000)
    // Call again (e.g. from dead-writer pruning) — resets timer
    service.onLastSubscriberLeft('conv_1')
    vi.advanceTimersByTime(60_000)

    // Only 60s since second call — not yet at 120s
    expect(controller.signal.aborted).toBe(false)

    vi.advanceTimersByTime(60_000)
    expect(controller.signal.aborted).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/no-subscriber-abort.test.ts"`
Expected: FAIL — `onLastSubscriberLeft` / `onSubscriberAdded` methods do not exist

- [ ] **Step 3: Implement no-subscriber abort timer**

In `agents/src/server/sse/MessageExecutionService.ts`:

Add import for the listener interface at the top:

```typescript
import type { SubscriberLifecycleListener } from './EventStreamRegistry.js'
```

Add constant after the existing `ERRORED_TURN_ASSESSMENT_TIMEOUT_MS`:

```typescript
const NO_SUBSCRIBER_ABORT_TIMEOUT_MS = parseInt(
  process.env.SSE_NO_SUBSCRIBER_ABORT_TIMEOUT_MS ?? '120000', 10
)
```

Add the timer map as a private field and implement the interface on the class:

```typescript
export class MessageExecutionService implements SubscriberLifecycleListener {
  private deps: ExecutionDeps
  private readonly chunkTimeoutMs = parseChunkTimeoutMs()
  private abortControllers = new Map<string, AbortController>()
  private activeStreams = new Map<string, ActiveStream>()
  private noSubscriberTimers = new Map<string, NodeJS.Timeout>()
```

Add the two methods after the `hasActiveStream` method:

```typescript
  onLastSubscriberLeft(conversationId: string): void {
    if (!this.activeStreams.has(conversationId)) return

    // Clear any existing timer (idempotent if called from dead-writer pruning)
    const existing = this.noSubscriberTimers.get(conversationId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.noSubscriberTimers.delete(conversationId)
      const controller = this.abortControllers.get(conversationId)
      if (controller) {
        const appId = this.activeStreams.get(conversationId)?.appId
        logger.info('sse.execution.no_subscriber_abort', { conversationId, appId, timeoutMs: NO_SUBSCRIBER_ABORT_TIMEOUT_MS })
        controller.abort('no_subscriber_timeout')
      }
    }, NO_SUBSCRIBER_ABORT_TIMEOUT_MS)

    this.noSubscriberTimers.set(conversationId, timer)
    logger.info('sse.execution.no_subscriber_timer_started', { conversationId, timeoutMs: NO_SUBSCRIBER_ABORT_TIMEOUT_MS })
  }

  onSubscriberAdded(conversationId: string): void {
    const timer = this.noSubscriberTimers.get(conversationId)
    if (timer) {
      clearTimeout(timer)
      this.noSubscriberTimers.delete(conversationId)
      logger.info('sse.execution.no_subscriber_timer_cancelled', { conversationId })
    }
  }
```

In the `finally` block of `execute()` (around line 1691, after `this.activeStreams.delete(conversationId)`), add cleanup:

```typescript
// Clean up no-subscriber timer if execution completes naturally
const pendingTimer = this.noSubscriberTimers.get(conversationId)
if (pendingTimer) {
  clearTimeout(pendingTimer)
  this.noSubscriberTimers.delete(conversationId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/no-subscriber-abort.test.ts"`
Expected: All tests PASS

- [ ] **Step 5: Run full SSE test suite to verify no regressions**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/"`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/no-subscriber-abort.test.ts
git commit -m "feat(sse): add no-subscriber abort timer to MessageExecutionService"
```

---

### Task 3: Wire listener in app.ts and route construction

**Files:**
- Modify: `agents/src/server/app.ts`

- [ ] **Step 1: Pass MessageExecutionService as listener to EventStreamRegistry**

In `agents/src/server/app.ts`, the `sseRegistry` is created at line 219 before the execution service exists. The execution service is lazily created in `getOrCreateSSEExecutionService()`. Two options: (a) pass the listener lazily, or (b) restructure so the registry is constructed with the listener once available.

The simplest approach: make `EventStreamRegistry` accept setting the listener after construction. Add a setter method.

Actually — looking at the code flow, the registry is created at module top-level (line 219), and the execution service is created lazily (line 237). The listener needs to be set once the execution service is created.

Add a `setListener` method to `EventStreamRegistry`:

In `agents/src/server/sse/EventStreamRegistry.ts`, add:

```typescript
setListener(listener: SubscriberLifecycleListener): void {
  this.listener = listener
}
```

In `agents/src/server/app.ts`, inside `getOrCreateSSEExecutionService()`, after creating the `MessageExecutionService` (around line 287, before `return sseExecutionService`), add:

```typescript
sseRegistry.setListener(sseExecutionService)
```

- [ ] **Step 2: Run typecheck to verify wiring compiles**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 3: Run full SSE test suite**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/"`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/sse/EventStreamRegistry.ts agents/src/server/app.ts
git commit -m "feat(sse): wire no-subscriber listener between registry and execution service"
```

---

### Task 4: Add zero-delivery logging to sendToApp

**Files:**
- Modify: `agents/src/server/sse/EventStreamRegistry.ts`
- Modify: `agents/src/server/sse/__tests__/EventStreamRegistry.test.ts`

- [ ] **Step 1: Write failing test for zero-delivery log**

Add to `agents/src/server/sse/__tests__/EventStreamRegistry.test.ts`:

```typescript
import { logger } from '../../../logging/index.js'

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
```

Then in the `app-scoped fan-out` describe block, add:

```typescript
it('logs when sendToApp has zero delivery (no open connections for app)', () => {
  const registry = new EventStreamRegistry()

  registry.sendToApp('app_nobody', 'oauth_result', { success: true })

  expect(logger.debug).toHaveBeenCalledWith(
    'sse.registry.send_to_app.no_connections',
    expect.objectContaining({ appId: 'app_nobody', eventType: 'oauth_result' })
  )
})

it('does not log when sendToApp delivers to at least one connection', () => {
  const registry = new EventStreamRegistry()
  registry.register('conv_1', 'app_X', createMockWriter())

  registry.sendToApp('app_X', 'oauth_result', { success: true })

  expect(logger.debug).not.toHaveBeenCalledWith(
    'sse.registry.send_to_app.no_connections',
    expect.anything()
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/EventStreamRegistry.test.ts"`
Expected: FAIL — `sendToApp` does not log

- [ ] **Step 3: Implement zero-delivery logging**

In `agents/src/server/sse/EventStreamRegistry.ts`, modify `sendToApp`:

```typescript
sendToApp(appId: string, type: string, data: Record<string, unknown>): void {
  const conversations = this.getConversationsByApp(appId)
  if (conversations.length === 0) {
    logger.debug('sse.registry.send_to_app.no_connections', { appId, eventType: type })
    return
  }
  for (const conversationId of conversations) {
    this.sendToAll(conversationId, type, data)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/EventStreamRegistry.test.ts"`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/sse/EventStreamRegistry.ts agents/src/server/sse/__tests__/EventStreamRegistry.test.ts
git commit -m "feat(sse): log zero-delivery on sendToApp for observability"
```

---

### Task 5: Add JSDoc delivery-guarantee documentation

**Files:**
- Modify: `agents/src/server/sse/EventStreamRegistry.ts`

- [ ] **Step 1: Add JSDoc to sendToApp**

Replace the existing `sendToApp` method signature with a documented version:

```typescript
/**
 * Broadcast an event to every open conversation stream for this app.
 *
 * Delivery guarantee: best-effort. If no conversation streams are open for the
 * app, the event is silently dropped (logged at debug level). Callers must not
 * depend on delivery confirmation — the client should re-fetch state on reconnect
 * for any app-level events (OAuth tokens, video status) that may have been missed.
 */
sendToApp(appId: string, type: string, data: Record<string, unknown>): void {
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add agents/src/server/sse/EventStreamRegistry.ts
git commit -m "docs(sse): add delivery-guarantee JSDoc to sendToApp"
```

---

### Task 6: Handle no_subscriber_timeout finish reason in execute loop

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts`
- Modify: `agents/src/server/sse/__tests__/no-subscriber-abort.test.ts`

- [ ] **Step 1: Write failing test for terminal event on timeout abort**

Add to `agents/src/server/sse/__tests__/no-subscriber-abort.test.ts`:

```typescript
it('publishes complete event with no_subscriber_timeout finishReason when timer fires', async () => {
  const publishMock = vi.fn().mockResolvedValue(undefined)
  const deps = createMinimalDeps({
    eventChannel: {
      publish: publishMock,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      markMessageEventsPersisted: vi.fn().mockReturnValue(1),
    },
  })
  const service = new MessageExecutionService(deps)

  const activeStreams = (service as any).activeStreams as Map<string, unknown>
  const abortControllers = (service as any).abortControllers as Map<string, AbortController>
  const controller = new AbortController()
  activeStreams.set('conv_1', { appId: 'app_1', convId: 'conv_1', subscriberIds: new Set() })
  abortControllers.set('conv_1', controller)

  service.onLastSubscriberLeft('conv_1')
  vi.advanceTimersByTime(120_000)

  // Allow microtask queue to drain (publishTerminal is async)
  await vi.runAllTimersAsync()

  expect(publishMock).toHaveBeenCalledWith(
    'conv_1',
    expect.objectContaining({
      type: 'complete',
      conversationId: 'conv_1',
      data: expect.objectContaining({ finishReason: 'no_subscriber_timeout' }),
    })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/no-subscriber-abort.test.ts" -t "publishes complete event"`
Expected: FAIL — timer abort does not publish a complete event

- [ ] **Step 3: Implement terminal event publication on timeout**

In `MessageExecutionService.onLastSubscriberLeft`, update the timeout callback to also publish a terminal event:

```typescript
const timer = setTimeout(() => {
  this.noSubscriberTimers.delete(conversationId)
  const controller = this.abortControllers.get(conversationId)
  const active = this.activeStreams.get(conversationId)
  if (controller && active) {
    const appId = active.appId
    logger.info('sse.execution.no_subscriber_abort', { conversationId, appId, timeoutMs: NO_SUBSCRIBER_ABORT_TIMEOUT_MS })
    controller.abort('no_subscriber_timeout')

    // Publish terminal event for replay on reconnect. No subscriber is
    // listening right now, but the event enters the buffer so a reconnecting
    // client receives it via Last-Event-Id recovery.
    void this.publishTerminal(appId, conversationId, {
      conversationId,
      type: 'complete',
      content: '',
      data: { finishReason: 'no_subscriber_timeout', timestamp: new Date().toISOString() },
      agentName: 'system',
    })
  }
}, NO_SUBSCRIBER_ABORT_TIMEOUT_MS)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/no-subscriber-abort.test.ts"`
Expected: All tests PASS

- [ ] **Step 5: Run full SSE test suite**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/"`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/no-subscriber-abort.test.ts
git commit -m "feat(sse): publish terminal complete on no-subscriber timeout for replay recovery"
```

---

### Task 7: Typecheck and lint pass

**Files:**
- All modified files

- [ ] **Step 1: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm --filter @airo/agents lint`
Expected: PASS (or fix any issues)

- [ ] **Step 3: Run full test suite**

Run: `pnpm --filter @airo/agents test:unit`
Expected: All tests PASS

- [ ] **Step 4: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "chore(sse): lint fixes for operational semantics PR"
```
