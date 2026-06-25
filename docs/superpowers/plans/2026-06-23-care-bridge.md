# Airo Care Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded `agents/src/care/` module that, on `/agent support` turns, creates a Care conversation and streams its NDJSON response back through AAB's SSE chat channel — without touching the build-agent code path.

**Architecture:** New module at `agents/src/care/` wraps `@airo-care/client` (visitor-cookie auth, in-memory session map keyed by AAB conversationId). `MessageExecutionService.executeUnderTrace` gets a 3-line branch on `resolvedAgentId === 'support'` that delegates to a sibling `executeSupportUnderTrace` method. Bridge yields wire-ready `BridgeEvent`s (Care vocabulary contained inside the boundary); intercept site just iterates and publishes.

**Tech Stack:** TypeScript (Node 22+, ESM), `@airo-care/client@1.0.0-rc` (fetch-only), `@airo/ai-transport` (`StreamingEvent` shape), Vitest, `agents/src/logging` (structured logger).

## Global Constraints

- Module location: `agents/src/care/`. The ONLY public surface re-exported from `index.ts` is `createCareBridge`, `CareBridge`, `SupportTurnInput`, `BridgeEvent`. Files inside the module are never imported from outside.
- Forbidden imports inside `agents/src/care/`: `agents/src/server/**`, `agents/src/database/**`, `agents/src/agents/**`, `agents/src/tools/**`, `express`, `@airo/ai-lib`.
- Allowed imports inside `agents/src/care/`: `@airo-care/client`, `@airo/ai-transport` (StreamingEvent type only), `agents/src/logging`, `node:crypto`.
- `agentName: 'support'` is the value the bridge stamps on every published `BridgeEvent`.
- The bridge contract guarantees exactly one terminal `complete` event at the end of every for-await stream (happy or error).
- Bridge initial version targets `@airo-care/client@1.0.0-rc`. The client's `streamMessage` does NOT accept a caller `AbortSignal` — the bridge honors `abortSignal` only between for-await yields. The call site is marked `TODO(care-abort)` for the fast-follow.
- Env vars: `AIRO_CARE_BASE_URL` (required; bridge returns `null` if empty), `AIRO_CARE_EXECUTOR` (defaults to `'v1/orchestrator-test'`).
- Structured logs under `care.*` event namespace. Use `errorFields(err)` to spread error metadata. camelCase fields.
- Test files live in `agents/src/care/__tests__/` next to the module. Use Vitest (project default).
- Catalog deps go in `pnpm-workspace.yaml` `catalog:` block, then referenced as `"catalog:"` in `agents/package.json`. Never `pnpm update --recursive`.

---

## File Structure

**New files (inside `agents/src/care/`):**
- `identity.ts` — `generateUcid()`
- `errors.ts` — `userFacingErrorMessage(err)`
- `event-queue.ts` — callback → async-iterable adapter
- `CareSessionStore.ts` — in-memory session map + TTL sweep
- `translator.ts` — `StreamMessageEvents` → `BridgeEvent | null`
- `CareBridge.ts` — `createCareBridge()` factory + `streamSupportTurn` generator
- `index.ts` — public re-exports
- `__tests__/identity.test.ts`
- `__tests__/errors.test.ts`
- `__tests__/event-queue.test.ts`
- `__tests__/CareSessionStore.test.ts`
- `__tests__/translator.test.ts`
- `__tests__/CareBridge.test.ts`
- `__tests__/fixtures/fake-airo-care-client.ts` — test double

**Modified files:**
- `pnpm-workspace.yaml` — add `@airo-care/client` to catalog
- `agents/package.json` — add `@airo-care/client: catalog:` to dependencies
- `agents/.env.example` — add `AIRO_CARE_BASE_URL` and `AIRO_CARE_EXECUTOR`
- `agents/src/server/sse/MessageExecutionService.ts` — add `careBridge` dep, extract `setupStreamState` helper, add `executeSupportUnderTrace` method, add branch in `executeUnderTrace`
- `agents/src/server/app.ts` — construct `CareBridge` from env vars, pass into `MessageExecutionService`
- `agents/src/server/sse/__tests__/MessageExecutionService.support-turn.test.ts` — integration test for `executeSupportUnderTrace` (new file)

---

### Task 1: Add `@airo-care/client` as a workspace dependency

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog section)
- Modify: `agents/package.json` (dependencies)

**Interfaces:**
- Consumes: nothing
- Produces: `@airo-care/client` package importable from inside `@airo/agents`

- [ ] **Step 1: Add catalog entry**

Open `pnpm-workspace.yaml`. In the `catalog:` block (after the alphabetically-near entries), add:

```yaml
  '@airo-care/client': 1.0.0-rc
```

Place it alphabetically between `@ai-sdk/provider` and `@aws-sdk/client-dynamodb` (or wherever maintains alphabetical order in the existing block).

- [ ] **Step 2: Add the dep to agents/package.json**

Open `agents/package.json`. In the `dependencies` object, add:

```json
"@airo-care/client": "catalog:",
```

Place alphabetically in the `dependencies` block.

- [ ] **Step 3: Install**

Run:
```bash
pnpm install
```

Expected: install succeeds in ~3s; no errors about missing package; lockfile updates.

- [ ] **Step 4: Verify install + type resolution**

Run:
```bash
ls agents/node_modules/@airo-care/client/dist/index.d.ts && \
node -e "console.log(Object.keys(require('@airo-care/client')))" 2>&1 | head -5
```

Expected: file exists; key list includes `AiroCareClient`, `BrowserAuthenticator`, `CookieAuthenticator`, `AgentClientError`, `NetworkError`, `TimeoutError`.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml agents/package.json pnpm-lock.yaml
git commit -m "chore(care): add @airo-care/client@1.0.0-rc workspace dep"
```

---

### Task 2: `identity.ts` — generate UCID

**Files:**
- Create: `agents/src/care/identity.ts`
- Test: `agents/src/care/__tests__/identity.test.ts`

**Interfaces:**
- Consumes: `node:crypto`
- Produces: `generateUcid(): string` — returns RFC4122 v4 UUID string

- [ ] **Step 1: Write the failing test**

Create `agents/src/care/__tests__/identity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { generateUcid } from '../identity.js'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('generateUcid', () => {
  it('returns an RFC4122 v4 UUID string', () => {
    const ucid = generateUcid()
    expect(ucid).toMatch(UUID_V4_PATTERN)
  })

  it('returns a different value on each call', () => {
    const a = generateUcid()
    const b = generateUcid()
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/identity.test.ts
```

Expected: FAIL with "Cannot find module '../identity.js'" or similar.

- [ ] **Step 3: Implement `identity.ts`**

Create `agents/src/care/identity.ts`:

```typescript
import { randomUUID } from 'node:crypto'

/**
 * Generate a UCID — UUID v4 used as the cross-system correlation id
 * for an Airo Care conversation. One UCID per AAB conversation, sticky
 * across all support turns on that conversation.
 */
export function generateUcid(): string {
  return randomUUID()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/identity.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/care/identity.ts agents/src/care/__tests__/identity.test.ts
git commit -m "feat(care): add identity helper for UCID generation"
```

---

### Task 3: `errors.ts` — user-facing error message helper

**Files:**
- Create: `agents/src/care/errors.ts`
- Test: `agents/src/care/__tests__/errors.test.ts`

**Interfaces:**
- Consumes: `AgentClientError`, `NetworkError`, `TimeoutError` from `@airo-care/client`
- Produces:
  - `userFacingErrorMessage(err: unknown): string` — single English string ≤ 120 chars; never throws

- [ ] **Step 1: Write the failing test**

Create `agents/src/care/__tests__/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { AgentClientError, NetworkError, TimeoutError } from '@airo-care/client'
import { userFacingErrorMessage } from '../errors.js'

describe('userFacingErrorMessage', () => {
  it('returns the generic message for a NetworkError', () => {
    const msg = userFacingErrorMessage(new NetworkError('connection refused'))
    expect(msg).toContain('connection')
    expect(msg.length).toBeLessThanOrEqual(120)
  })

  it('returns a timeout-specific message for a TimeoutError', () => {
    const msg = userFacingErrorMessage(new TimeoutError('timed out', 30000))
    expect(msg.toLowerCase()).toContain('took too long')
    expect(msg.length).toBeLessThanOrEqual(120)
  })

  it('returns the generic message for a 5xx AgentClientError', () => {
    const msg = userFacingErrorMessage(new AgentClientError('boom', {
      fault: 'server', type: 'INTERNAL_SERVER_ERROR', statusCode: 500,
    }))
    expect(msg.toLowerCase()).toContain('support')
    expect(msg.length).toBeLessThanOrEqual(120)
  })

  it('returns a not-found message for a 404 AgentClientError', () => {
    const msg = userFacingErrorMessage(new AgentClientError('not found', {
      fault: 'client', type: 'NOT_FOUND', statusCode: 404,
    }))
    expect(msg.toLowerCase()).toContain('try again')
    expect(msg.length).toBeLessThanOrEqual(120)
  })

  it('returns the generic message for any other thrown value', () => {
    expect(userFacingErrorMessage('oops')).toMatch(/.+/)
    expect(userFacingErrorMessage(undefined)).toMatch(/.+/)
    expect(userFacingErrorMessage(new Error('weird'))).toMatch(/.+/)
  })

  it('never throws', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => userFacingErrorMessage(circular)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/errors.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `errors.ts`**

Create `agents/src/care/errors.ts`:

```typescript
import { AgentClientError, NetworkError, TimeoutError } from '@airo-care/client'

const GENERIC = 'Sorry, support is unavailable right now. Try again in a moment.'
const TIMEOUT = 'Sorry, support took too long to respond. Try again in a moment.'
const NOT_FOUND = 'Your support conversation ended. Send your message again to start a new one.'

/**
 * Map any thrown value to a single short English string safe to render
 * in the chat as an inline error chunk. Never throws; returns a generic
 * fallback when the input is not a recognized Care client error.
 */
export function userFacingErrorMessage(err: unknown): string {
  try {
    if (err instanceof TimeoutError) return TIMEOUT
    if (err instanceof NetworkError) return GENERIC
    if (err instanceof AgentClientError) {
      if (err.statusCode === 404) return NOT_FOUND
      return GENERIC
    }
    return GENERIC
  } catch {
    return GENERIC
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/errors.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/care/errors.ts agents/src/care/__tests__/errors.test.ts
git commit -m "feat(care): add user-facing error message helper"
```

---

### Task 4: `event-queue.ts` — callback→async-iterable adapter

**Files:**
- Create: `agents/src/care/event-queue.ts`
- Test: `agents/src/care/__tests__/event-queue.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `createEventQueue<T>(): EventQueue<T>`
  - `EventQueue<T>` with: `push(event: T): void`, `close(): void`, `fail(err: unknown): void`, `[Symbol.asyncIterator](): AsyncIterator<T>`

- [ ] **Step 1: Write the failing test**

Create `agents/src/care/__tests__/event-queue.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createEventQueue } from '../event-queue.js'

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of iter) out.push(v)
  return out
}

describe('createEventQueue', () => {
  it('yields pushed events in order until closed', async () => {
    const q = createEventQueue<number>()
    q.push(1); q.push(2); q.push(3)
    q.close()
    const seen = await collect(q)
    expect(seen).toEqual([1, 2, 3])
  })

  it('supports push interleaved with consumption', async () => {
    const q = createEventQueue<number>()
    setTimeout(() => { q.push(1); q.push(2); q.close() }, 10)
    const seen = await collect(q)
    expect(seen).toEqual([1, 2])
  })

  it('rethrows the failure reason as the consumer iterates', async () => {
    const q = createEventQueue<number>()
    q.push(1)
    q.fail(new Error('boom'))
    const seen: number[] = []
    await expect(async () => {
      for await (const v of q) seen.push(v)
    }).rejects.toThrow('boom')
    expect(seen).toEqual([1])
  })

  it('ignores pushes after close', async () => {
    const q = createEventQueue<number>()
    q.push(1); q.close(); q.push(2)
    const seen = await collect(q)
    expect(seen).toEqual([1])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/event-queue.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `event-queue.ts`**

Create `agents/src/care/event-queue.ts`:

```typescript
export interface EventQueue<T> extends AsyncIterable<T> {
  push(event: T): void
  close(): void
  fail(err: unknown): void
}

/**
 * Minimal callback → async-iterable adapter. Push producers' events from
 * any callback (e.g. AiroCareClient's onEvent handler) and consume them
 * via for-await. Close to signal end-of-stream; fail to throw the reason
 * into the consumer on its next iteration.
 *
 * Single-consumer only. Buffers events when the consumer is slower than
 * the producer; awaits the producer when the consumer is faster.
 */
export function createEventQueue<T>(): EventQueue<T> {
  const buffer: T[] = []
  let closed = false
  let failure: unknown = undefined
  let pending: { resolve: (v: IteratorResult<T>) => void; reject: (e: unknown) => void } | null = null

  function deliver(): void {
    if (!pending) return
    if (failure !== undefined) {
      const p = pending; pending = null
      p.reject(failure)
      return
    }
    if (buffer.length > 0) {
      const p = pending; pending = null
      p.resolve({ value: buffer.shift()!, done: false })
      return
    }
    if (closed) {
      const p = pending; pending = null
      p.resolve({ value: undefined as never, done: true })
    }
  }

  return {
    push(event: T): void {
      if (closed || failure !== undefined) return
      buffer.push(event)
      deliver()
    },
    close(): void {
      if (closed || failure !== undefined) return
      closed = true
      deliver()
    },
    fail(err: unknown): void {
      if (closed || failure !== undefined) return
      failure = err ?? new Error('queue failed without a reason')
      deliver()
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: (): Promise<IteratorResult<T>> => new Promise((resolve, reject) => {
          pending = { resolve, reject }
          deliver()
        }),
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/event-queue.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/care/event-queue.ts agents/src/care/__tests__/event-queue.test.ts
git commit -m "feat(care): add callback to async-iterable queue adapter"
```

---

### Task 5: `CareSessionStore.ts` — in-memory session map with TTL sweep

**Files:**
- Create: `agents/src/care/CareSessionStore.ts`
- Test: `agents/src/care/__tests__/CareSessionStore.test.ts`

**Interfaces:**
- Consumes: `generateUcid` from `./identity.js`
- Produces:
  - `interface CareSession { ucid: string; careConversationId?: string }`
  - class `CareSessionStore` with:
    - `getOrInit(aabConversationId: string): CareSession`
    - `setCareConversationId(aabConversationId: string, careConversationId: string): void`
    - `invalidate(aabConversationId: string): void`
    - `sweep(maxAgeMs: number, now?: () => number): number` — returns count removed
    - `size(): number`

- [ ] **Step 1: Write the failing test**

Create `agents/src/care/__tests__/CareSessionStore.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { CareSessionStore } from '../CareSessionStore.js'

describe('CareSessionStore', () => {
  it('getOrInit creates a session with a fresh ucid', () => {
    const store = new CareSessionStore()
    const s = store.getOrInit('aab-1')
    expect(s.ucid).toMatch(/^[0-9a-f-]+$/i)
    expect(s.careConversationId).toBeUndefined()
    expect(store.size()).toBe(1)
  })

  it('getOrInit returns the same session for the same aabConversationId', () => {
    const store = new CareSessionStore()
    const a = store.getOrInit('aab-1')
    const b = store.getOrInit('aab-1')
    expect(a).toBe(b)
    expect(a.ucid).toBe(b.ucid)
    expect(store.size()).toBe(1)
  })

  it('setCareConversationId persists on the existing session', () => {
    const store = new CareSessionStore()
    store.getOrInit('aab-1')
    store.setCareConversationId('aab-1', 'care-conv-1')
    expect(store.getOrInit('aab-1').careConversationId).toBe('care-conv-1')
  })

  it('setCareConversationId is a no-op for unknown ids', () => {
    const store = new CareSessionStore()
    store.setCareConversationId('aab-missing', 'care-conv-1')
    expect(store.size()).toBe(0)
  })

  it('invalidate drops the entry', () => {
    const store = new CareSessionStore()
    store.getOrInit('aab-1')
    store.invalidate('aab-1')
    expect(store.size()).toBe(0)
  })

  it('sweep removes entries idle longer than maxAgeMs', () => {
    let now = 1_000_000
    const store = new CareSessionStore()
    store.getOrInit('aab-old')
    now += 60_000
    store.getOrInit('aab-recent')
    now += 30_000
    const removed = store.sweep(45_000, () => now)
    expect(removed).toBe(1)
    expect(store.size()).toBe(1)
  })

  it('sweep updates lastTouched on read/write', () => {
    let now = 1_000_000
    const store = new CareSessionStore()
    store.getOrInit('aab-1')          // touched at t=0
    now += 60_000
    store.getOrInit('aab-1')          // re-touched at t=60s
    now += 30_000                     // 30s since last touch
    const removed = store.sweep(45_000, () => now)
    expect(removed).toBe(0)
    expect(store.size()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/CareSessionStore.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `CareSessionStore.ts`**

Create `agents/src/care/CareSessionStore.ts`:

```typescript
import { generateUcid } from './identity.js'

export interface CareSession {
  ucid: string
  careConversationId?: string
}

/**
 * In-memory map from AAB conversationId to Care session state.
 * Session is sticky for the lifetime of an AAB conversation: the same
 * ucid (and, once set, the same careConversationId) are reused on every
 * subsequent support turn until invalidated.
 *
 * Bounded by a TTL sweep — entries idle longer than the configured window
 * are dropped, freeing the Care conversation in Care's ASM via its own
 * idle-timeout workflow.
 */
export class CareSessionStore {
  private sessions = new Map<string, CareSession>()
  private lastTouched = new Map<string, number>()
  private readonly nowFn: () => number

  constructor(now: () => number = () => Date.now()) {
    this.nowFn = now
  }

  getOrInit(aabConversationId: string): CareSession {
    let session = this.sessions.get(aabConversationId)
    if (!session) {
      session = { ucid: generateUcid() }
      this.sessions.set(aabConversationId, session)
    }
    this.lastTouched.set(aabConversationId, this.nowFn())
    return session
  }

  setCareConversationId(aabConversationId: string, careConversationId: string): void {
    const session = this.sessions.get(aabConversationId)
    if (!session) return
    session.careConversationId = careConversationId
    this.lastTouched.set(aabConversationId, this.nowFn())
  }

  invalidate(aabConversationId: string): void {
    this.sessions.delete(aabConversationId)
    this.lastTouched.delete(aabConversationId)
  }

  size(): number {
    return this.sessions.size
  }

  /**
   * Remove sessions whose lastTouched is older than maxAgeMs.
   * `now` override exists for deterministic tests.
   */
  sweep(maxAgeMs: number, now: () => number = this.nowFn): number {
    const currentTime = now()
    let removed = 0
    for (const [convId, touched] of this.lastTouched) {
      if (currentTime - touched > maxAgeMs) {
        this.sessions.delete(convId)
        this.lastTouched.delete(convId)
        removed++
      }
    }
    return removed
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/CareSessionStore.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/care/CareSessionStore.ts agents/src/care/__tests__/CareSessionStore.test.ts
git commit -m "feat(care): add in-memory session store with TTL sweep"
```

---

### Task 6: `translator.ts` — Care events to BridgeEvent

**Files:**
- Create: `agents/src/care/translator.ts`
- Test: `agents/src/care/__tests__/translator.test.ts`

**Interfaces:**
- Consumes:
  - `StreamMessageEvents` from `@airo-care/client`
  - `StreamingEvent` from `@airo/ai-transport`
  - `userFacingErrorMessage` from `./errors.js`
- Produces:
  - `type BridgeEvent = Omit<StreamingEvent, 'id' | 'sequence' | 'timestamp' | 'deliveredTo' | 'persisted'>`
  - `translateCareEvent(event: StreamMessageEvents, ctx: TranslateCtx): BridgeEvent | null`
  - `interface TranslateCtx { agentName: string; conversationId: string }`
  - `terminalCompleteEvent(ctx: TranslateCtx): BridgeEvent` — synthetic terminal frame the bridge emits on stream-end-without-result and after error chunks

- [ ] **Step 1: Write the failing test**

Create `agents/src/care/__tests__/translator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { StreamMessageEvents } from '@airo-care/client'
import { translateCareEvent, terminalCompleteEvent } from '../translator.js'

const ctx = { agentName: 'support', conversationId: 'aab-1' }

function ev<T extends StreamMessageEvents>(e: T): T { return e }

describe('translateCareEvent', () => {
  it('maps delta to a chunk', () => {
    const out = translateCareEvent(ev({ eventId: 1, timestamp: 1, type: 'delta', textDelta: 'hi' }), ctx)
    expect(out).toEqual({
      type: 'chunk', content: 'hi', data: {},
      agentName: 'support', conversationId: 'aab-1',
    })
  })

  it('maps result to a complete with finishReason=stop', () => {
    const out = translateCareEvent(ev({ eventId: 2, timestamp: 2, type: 'result', output: 'done' }), ctx)
    expect(out).toEqual({
      type: 'complete', content: '', data: { finishReason: 'stop' },
      agentName: 'support', conversationId: 'aab-1',
    })
  })

  it('maps error to a user-facing chunk (translator does not emit a terminal complete itself)', () => {
    const out = translateCareEvent(ev({
      eventId: 3, timestamp: 3, type: 'error', message: 'boom', fatal: true,
    }), ctx)
    expect(out?.type).toBe('chunk')
    expect((out as { content: string }).content.length).toBeGreaterThan(0)
    expect((out as { agentName: string }).agentName).toBe('support')
  })

  it.each(['start', 'progress', 'heartbeat', 'data', 'artifact'] as const)(
    'returns null for %s events',
    (eventType) => {
      const e = { eventId: 4, timestamp: 4, type: eventType } as unknown as StreamMessageEvents
      expect(translateCareEvent(e, ctx)).toBeNull()
    },
  )
})

describe('terminalCompleteEvent', () => {
  it('returns a complete frame stamped with agentName and conversationId', () => {
    expect(terminalCompleteEvent(ctx)).toEqual({
      type: 'complete', content: '', data: { finishReason: 'stop' },
      agentName: 'support', conversationId: 'aab-1',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/translator.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `translator.ts`**

Create `agents/src/care/translator.ts`:

```typescript
import type { StreamMessageEvents } from '@airo-care/client'
import type { StreamingEvent } from '@airo/ai-transport'
import { userFacingErrorMessage } from './errors.js'

export type BridgeEvent = Omit<
  StreamingEvent,
  'id' | 'sequence' | 'timestamp' | 'deliveredTo' | 'persisted'
>

export interface TranslateCtx {
  agentName: string
  conversationId: string
}

/**
 * Translate one Care stream event into an AAB BridgeEvent suitable for
 * direct passthrough to ConversationEventChannel.publish, or null when
 * the event has no AAB-visible analog (start/progress/heartbeat/data/
 * artifact for this iteration).
 *
 * `error` is translated to a user-facing chunk; the bridge follows it
 * with a separate terminalCompleteEvent so callers see exactly one
 * complete per stream.
 */
export function translateCareEvent(
  event: StreamMessageEvents,
  ctx: TranslateCtx,
): BridgeEvent | null {
  switch (event.type) {
    case 'delta':
      return {
        type: 'chunk',
        content: event.textDelta,
        data: {},
        agentName: ctx.agentName,
        conversationId: ctx.conversationId,
      }
    case 'result':
      return terminalCompleteEvent(ctx)
    case 'error':
      return {
        type: 'chunk',
        content: userFacingErrorMessage(event),
        data: {},
        agentName: ctx.agentName,
        conversationId: ctx.conversationId,
      }
    case 'start':
    case 'progress':
    case 'heartbeat':
    case 'data':
    case 'artifact':
      return null
  }
}

export function terminalCompleteEvent(ctx: TranslateCtx): BridgeEvent {
  return {
    type: 'complete',
    content: '',
    data: { finishReason: 'stop' },
    agentName: ctx.agentName,
    conversationId: ctx.conversationId,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/translator.test.ts
```

Expected: 8 tests PASS (3 cases + 5 ignored-types + 1 terminalComplete).

- [ ] **Step 5: Commit**

```bash
git add agents/src/care/translator.ts agents/src/care/__tests__/translator.test.ts
git commit -m "feat(care): translate Care events to BridgeEvent"
```

---

### Task 7: `CareBridge.ts` — bridge with fake-client tests

**Files:**
- Create: `agents/src/care/CareBridge.ts`
- Create: `agents/src/care/__tests__/fixtures/fake-airo-care-client.ts`
- Test: `agents/src/care/__tests__/CareBridge.test.ts`

**Interfaces:**
- Consumes: `AiroCareClient`, `CookieAuthenticator` from `@airo-care/client`; `CareSessionStore`; `translateCareEvent`, `terminalCompleteEvent`, `BridgeEvent`; `createEventQueue`; `userFacingErrorMessage`; `logger` from `agents/src/logging/index.js`
- Produces:
  - `interface SupportTurnInput { aabConversationId: string; visitorId: string; message: string; abortSignal?: AbortSignal }`
  - `interface CareBridge { streamSupportTurn(input: SupportTurnInput): AsyncIterable<BridgeEvent> }`
  - `interface CareBridgeConfig { baseURL: string; executor: string; clientFactory?: (visitorId: string) => AiroCareClient }`
  - `createCareBridge(config: CareBridgeConfig): CareBridge | null`
  - `BridgeEvent` re-exported from `./translator.js`

- [ ] **Step 1: Write the fake client fixture**

Create `agents/src/care/__tests__/fixtures/fake-airo-care-client.ts`:

```typescript
import type { AiroCareClient } from '@airo-care/client'
import type {
  CreateConversationRequest, CreateConversationResponse,
  SendMessageRequest, OnStreamEvent, StreamMessageEvents,
} from '@airo-care/client'

export type FakeCreateBehavior =
  | { kind: 'success'; conversationId: string }
  | { kind: 'throw'; error: unknown }

export type FakeStreamScript =
  | { kind: 'events'; events: StreamMessageEvents[] }
  | { kind: 'throwBefore'; error: unknown }
  | { kind: 'throwAfter'; events: StreamMessageEvents[]; error: unknown }

export interface FakeAiroCareClient
  extends Pick<AiroCareClient, 'createConversation' | 'streamMessage'> {
  /** Calls recorded for assertions. */
  readonly createCalls: CreateConversationRequest[]
  readonly streamCalls: SendMessageRequest[]
}

export function makeFakeClient(opts: {
  create: FakeCreateBehavior
  stream: FakeStreamScript
}): FakeAiroCareClient {
  const createCalls: CreateConversationRequest[] = []
  const streamCalls: SendMessageRequest[] = []
  return {
    createCalls,
    streamCalls,
    async createConversation(params: CreateConversationRequest): Promise<CreateConversationResponse> {
      createCalls.push(params)
      if (opts.create.kind === 'throw') throw opts.create.error
      return { conversationId: opts.create.conversationId, ucid: params.ucid }
    },
    async streamMessage(params: SendMessageRequest, handle: OnStreamEvent): Promise<void> {
      streamCalls.push(params)
      if (opts.stream.kind === 'throwBefore') throw opts.stream.error
      for (const e of opts.stream.events) handle(e)
      if (opts.stream.kind === 'throwAfter') throw opts.stream.error
    },
  }
}
```

- [ ] **Step 2: Write the failing CareBridge test**

Create `agents/src/care/__tests__/CareBridge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { AgentClientError } from '@airo-care/client'
import type { AiroCareClient } from '@airo-care/client'
import { createCareBridge } from '../CareBridge.js'
import type { BridgeEvent } from '../CareBridge.js'
import { makeFakeClient } from './fixtures/fake-airo-care-client.js'

async function drain(iter: AsyncIterable<BridgeEvent>): Promise<BridgeEvent[]> {
  const out: BridgeEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}

describe('createCareBridge', () => {
  it('returns null when baseURL is empty', () => {
    const bridge = createCareBridge({ baseURL: '', executor: 'v1/test' })
    expect(bridge).toBeNull()
  })

  it('returns a bridge when baseURL is set', () => {
    const bridge = createCareBridge({ baseURL: 'https://care.example', executor: 'v1/test' })
    expect(bridge).not.toBeNull()
  })
})

describe('streamSupportTurn — happy path', () => {
  it('creates a Care conversation on first turn, streams delta chunks, ends with one complete', async () => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: {
        kind: 'events',
        events: [
          { eventId: 1, timestamp: 1, type: 'start', conversationId: 'care-conv-1' },
          { eventId: 2, timestamp: 2, type: 'delta', textDelta: 'Hello ' },
          { eventId: 3, timestamp: 3, type: 'delta', textDelta: 'world' },
          { eventId: 4, timestamp: 4, type: 'result', output: 'Hello world' },
        ],
      },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({
      aabConversationId: 'aab-1', visitorId: 'vis-1', message: 'hi',
    }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect(events[0]).toMatchObject({ type: 'chunk', content: 'Hello ', agentName: 'support', conversationId: 'aab-1' })
    expect(events[1]).toMatchObject({ type: 'chunk', content: 'world' })
    expect(fake.createCalls).toHaveLength(1)
    expect(fake.createCalls[0]?.ucid).toMatch(/^[0-9a-f-]+$/i)
    expect(fake.streamCalls).toHaveLength(1)
    expect(fake.streamCalls[0]?.conversationId).toBe('care-conv-1')
  })

  it('reuses the same careConversationId on a second turn (no second create)', async () => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: '' }] },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: 'vis-1', message: 'hi 1' }))
    await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: 'vis-1', message: 'hi 2' }))
    expect(fake.createCalls).toHaveLength(1)
    expect(fake.streamCalls).toHaveLength(2)
    expect(fake.streamCalls.every(c => c.conversationId === 'care-conv-1')).toBe(true)
  })
})

describe('streamSupportTurn — failure paths', () => {
  it('createConversation failure yields error chunk + complete, invalidates session', async () => {
    const fake = makeFakeClient({
      create: { kind: 'throw', error: new AgentClientError('down', { fault: 'server', type: 'SERVICE_UNAVAILABLE', statusCode: 503 }) },
      stream: { kind: 'events', events: [] },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: 'vis-1', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((events[0] as { content: string }).content.length).toBeGreaterThan(0)
    // Next turn must create again (session was invalidated).
    const fake2 = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-2' },
      stream: { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: '' }] },
    })
    const bridge2 = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake2 as unknown as AiroCareClient,
    })!
    await drain(bridge2.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: 'vis-1', message: 'retry' }))
    expect(fake2.createCalls).toHaveLength(1)
  })

  it('stream-mid throw yields error chunk + complete, invalidates session', async () => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: {
        kind: 'throwAfter',
        events: [{ eventId: 1, timestamp: 1, type: 'delta', textDelta: 'partial' }],
        error: new Error('disconnected'),
      },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: 'vis-1', message: 'hi' }))
    // Expect: partial chunk, then error chunk, then complete.
    expect(events.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect((events[0] as { content: string }).content).toBe('partial')
  })

  it('emits a synthetic terminal complete when the stream closes without a result event', async () => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: {
        kind: 'events',
        events: [
          { eventId: 1, timestamp: 1, type: 'delta', textDelta: 'hi' },
          // no 'result'
        ],
      },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: 'vis-1', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'complete'])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/CareBridge.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement `CareBridge.ts`**

Create `agents/src/care/CareBridge.ts`:

```typescript
import { AiroCareClient, CookieAuthenticator } from '@airo-care/client'
import type { StreamMessageEvents } from '@airo-care/client'
import { errorFields, logger } from '../logging/index.js'
import { CareSessionStore } from './CareSessionStore.js'
import { createEventQueue } from './event-queue.js'
import { translateCareEvent, terminalCompleteEvent, type BridgeEvent } from './translator.js'
import { userFacingErrorMessage } from './errors.js'

export type { BridgeEvent } from './translator.js'

const AGENT_NAME = 'support'

export interface SupportTurnInput {
  aabConversationId: string
  visitorId: string
  message: string
  abortSignal?: AbortSignal
}

export interface CareBridge {
  streamSupportTurn(input: SupportTurnInput): AsyncIterable<BridgeEvent>
}

export interface CareBridgeConfig {
  baseURL: string
  executor: string
  /**
   * Test seam — production builds use the default factory which constructs
   * a real AiroCareClient with the provided visitor cookie. Tests inject
   * a fake to avoid real network calls.
   */
  clientFactory?: (visitorId: string) => AiroCareClient
}

/**
 * Build the Care bridge. Returns null when baseURL is empty so callers
 * can degrade cleanly to a "Care not configured" inline error chunk in
 * environments where Care credentials are not provisioned.
 */
export function createCareBridge(config: CareBridgeConfig): CareBridge | null {
  if (!config.baseURL) {
    logger.warn('care.bridge.disabled', { reason: 'missing_baseURL' })
    return null
  }

  const store = new CareSessionStore()
  const buildClient = config.clientFactory ?? ((visitorId: string): AiroCareClient =>
    new AiroCareClient({
      baseURL: config.baseURL,
      executor: config.executor,
      authenticator: new CookieAuthenticator(`visitor=vid=${visitorId}`),
    }))

  async function* streamSupportTurn(input: SupportTurnInput): AsyncGenerator<BridgeEvent, void, void> {
    const { aabConversationId, visitorId, message, abortSignal } = input
    const session = store.getOrInit(aabConversationId)
    const translateCtx = { agentName: AGENT_NAME, conversationId: aabConversationId }
    const client = buildClient(visitorId)

    if (!session.careConversationId) {
      const startedAt = Date.now()
      try {
        const { conversationId } = await client.createConversation({ ucid: session.ucid })
        store.setCareConversationId(aabConversationId, conversationId)
        logger.info('care.care_conversation.created', {
          aabConversationId, careConversationId: conversationId, ucid: session.ucid,
          latencyMs: Date.now() - startedAt,
        })
      } catch (err) {
        logger.error('care.care_conversation.create_failed', {
          aabConversationId, ucid: session.ucid, ...errorFields(err),
        })
        store.invalidate(aabConversationId)
        yield {
          type: 'chunk', content: userFacingErrorMessage(err), data: {},
          agentName: AGENT_NAME, conversationId: aabConversationId,
        }
        yield terminalCompleteEvent(translateCtx)
        return
      }
    }

    const careConversationId = session.careConversationId!
    const queue = createEventQueue<StreamMessageEvents>()
    let sawResult = false

    // TODO(care-abort): pass { signal: abortSignal } once @airo-care/client
    // publishes the AbortSignal-supporting version. For 1.0.0-rc the bridge
    // only honors abortSignal between for-await yields below.
    const streamPromise = client.streamMessage(
      { conversationId: careConversationId, input: { role: 'user', content: message } },
      (event) => {
        if (event.type === 'result') sawResult = true
        queue.push(event)
      },
    ).then(() => queue.close())
     .catch((err) => queue.fail(err))

    logger.info('care.stream.started', { aabConversationId, careConversationId })

    let deltaCount = 0
    const turnStart = Date.now()
    try {
      for await (const careEvent of queue) {
        if (abortSignal?.aborted) {
          logger.info('care.stream.aborted', {
            aabConversationId, careConversationId,
            reason: abortSignal.reason instanceof Error ? abortSignal.reason.message : String(abortSignal.reason),
          })
          break
        }
        const translated = translateCareEvent(careEvent, translateCtx)
        if (translated) {
          if (translated.type === 'chunk') deltaCount++
          yield translated
        }
        if (careEvent.type === 'result') return  // translated already emitted complete
      }
      // Stream closed without a result event — emit a synthetic terminal complete.
      if (!sawResult) {
        logger.info('care.stream.completed', {
          aabConversationId, careConversationId, deltaCount, durationMs: Date.now() - turnStart,
        })
        yield terminalCompleteEvent(translateCtx)
      }
    } catch (err) {
      logger.error('care.stream.errored', {
        aabConversationId, careConversationId, ...errorFields(err),
      })
      store.invalidate(aabConversationId)
      yield {
        type: 'chunk', content: userFacingErrorMessage(err), data: {},
        agentName: AGENT_NAME, conversationId: aabConversationId,
      }
      yield terminalCompleteEvent(translateCtx)
    } finally {
      await streamPromise.catch(() => undefined)
    }
  }

  return { streamSupportTurn }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm --filter @airo/agents test:unit src/care/__tests__/CareBridge.test.ts
```

Expected: all CareBridge tests PASS.

- [ ] **Step 6: Commit**

```bash
git add agents/src/care/CareBridge.ts agents/src/care/__tests__/CareBridge.test.ts agents/src/care/__tests__/fixtures/
git commit -m "feat(care): add CareBridge with session management + stream translation"
```

---

### Task 8: `index.ts` — public re-exports

**Files:**
- Create: `agents/src/care/index.ts`

**Interfaces:**
- Consumes: everything from `./CareBridge.js`
- Produces: the public surface of `agents/src/care/`

- [ ] **Step 1: Create the index file**

Create `agents/src/care/index.ts`:

```typescript
export { createCareBridge } from './CareBridge.js'
export type {
  CareBridge,
  SupportTurnInput,
  CareBridgeConfig,
  BridgeEvent,
} from './CareBridge.js'
```

- [ ] **Step 2: Verify it compiles cleanly**

Run:
```bash
pnpm --filter @airo/agents typecheck
```

Expected: 0 errors from `agents/src/care/`.

- [ ] **Step 3: Commit**

```bash
git add agents/src/care/index.ts
git commit -m "feat(care): expose public surface via index.ts"
```

---

### Task 9: Extract `setupStreamState` helper in MessageExecutionService

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts`

**Interfaces:**
- Consumes: existing private fields `activeStreams`, `deps.sseRegistry`, `deps.eventChannel` on the `MessageExecutionService` instance
- Produces:
  - `private setupStreamState(opts: { conversationId: string; appId: string; agentNameForApm: string; requestId?: string; apmTransaction?: ActiveStream['apmTransaction'] }): ActiveStream`

This refactor is a no-behavior-change extraction. The same logic already lives inline inside `executeUnderTrace` at the "Bridge sseRegistry → eventChannel" comment block. We extract so both `executeUnderTrace` and the new `executeSupportUnderTrace` (next task) call the same helper.

- [ ] **Step 1: Locate the inline code in MessageExecutionService**

Open `agents/src/server/sse/MessageExecutionService.ts`. Find the block (currently around line 2005-2015) that begins:

```typescript
// Bridge sseRegistry → eventChannel BEFORE pre-turn persistence runs. If we
```

and ends after the `for (const sub of sseSubscribers)` loop. That block plus the `setLabel('agent_name', ...)` call is the extraction target.

- [ ] **Step 2: Add the private helper**

Inside the `MessageExecutionService` class, immediately above `private async executeUnderTrace(`, add:

```typescript
private setupStreamState(opts: {
  conversationId: string
  appId: string
  agentNameForApm: string
  requestId?: string
  apmTransaction?: ActiveStream['apmTransaction']
}): ActiveStream {
  const { conversationId, appId, agentNameForApm, requestId, apmTransaction } = opts
  const streamState: ActiveStream = {
    appId, convId: conversationId, subscriberIds: new Set(),
    ...(requestId && { requestId }),
    apmTransaction,
  }
  this.activeStreams.set(conversationId, streamState)
  if (apmTransaction) apmTransaction.setLabel('agent_name', agentNameForApm)
  const sseSubscribers = this.deps.sseRegistry.getSubscribers(conversationId)
  for (const sub of sseSubscribers) {
    this.deps.eventChannel.subscribe(conversationId, sub)
    streamState.subscriberIds.add(sub.id)
  }
  return streamState
}
```

- [ ] **Step 3: Replace the inline block in `executeUnderTrace`**

Find the existing inline block and replace it with a call to the helper. Replace:

```typescript
const streamState: ActiveStream = { appId, convId: conversationId, subscriberIds: new Set(), ...(requestId && { requestId }), apmTransaction }
this.activeStreams.set(conversationId, streamState)
if (apmTransaction) apmTransaction.setLabel('agent_name', resolvedAgentId)
const sseSubscribers = this.deps.sseRegistry.getSubscribers(conversationId)
for (const sub of sseSubscribers) {
  this.deps.eventChannel.subscribe(conversationId, sub)
  streamState.subscriberIds.add(sub.id)
}
```

with:

```typescript
const streamState = this.setupStreamState({
  conversationId, appId, agentNameForApm: resolvedAgentId,
  requestId, apmTransaction,
})
```

(`streamState` variable is still referenced later in the function — leave those references unchanged.)

- [ ] **Step 4: Run typecheck**

Run:
```bash
pnpm --filter @airo/agents typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Run the full agents unit suite — no behavior change**

Run:
```bash
pnpm --filter @airo/agents test:unit
```

Expected: ALL existing tests still PASS. No new failures.

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts
git commit -m "refactor(sse): extract setupStreamState helper"
```

---

### Task 10: Add `careBridge` dep + `executeSupportUnderTrace` + branch in `executeUnderTrace`

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts`
- Create: `agents/src/server/sse/__tests__/MessageExecutionService.support-turn.test.ts`

**Interfaces:**
- Consumes: `CareBridge`, `SupportTurnInput` from `agents/src/care/index.js`; existing dep injection patterns
- Produces:
  - `ExecutionDeps.careBridge?: CareBridge` (new optional field)
  - `private executeSupportUnderTrace(params: ExecuteParams, turnSnapshot: TurnSnapshotState): Promise<TurnExecutionResult>` (new method)
  - Early branch in `executeUnderTrace`: `if (resolvedAgentId === 'support') return this.executeSupportUnderTrace(params, turnSnapshot)`

- [ ] **Step 1: Write the failing integration test**

Create `agents/src/server/sse/__tests__/MessageExecutionService.support-turn.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { CareBridge, BridgeEvent } from '../../../care/index.js'
import { MessageExecutionService } from '../MessageExecutionService.js'

/**
 * Minimal stubs for the deps MessageExecutionService consumes. We only
 * exercise the support-turn branch; other deps are touched only insofar
 * as the support path uses them (persistence, eventChannel, stateManager,
 * sseRegistry).
 */
function makeDeps(careBridge: CareBridge | null) {
  const publishedEvents: BridgeEvent[] = []
  const persistenceCalls: string[] = []
  const eventChannel = {
    publish: vi.fn(async (_convId: string, event: BridgeEvent) => {
      publishedEvents.push(event)
      return undefined as never
    }),
    subscribe: vi.fn(),
  }
  const persistence = {
    continueConversation: vi.fn(async () => { persistenceCalls.push('continueConversation'); return 'msg-user-1' }),
    startAgentTurn: vi.fn(async () => { persistenceCalls.push('startAgentTurn'); return 'msg-agent-1' }),
    completeConversation: vi.fn(async () => { persistenceCalls.push('completeConversation') }),
    captureStreamingEvent: vi.fn(async () => undefined),
    startConversation: vi.fn(async () => 'conv-1'),
    handleConversationError: vi.fn(async () => undefined),
    handleDisconnection: vi.fn(async () => undefined),
  }
  return {
    publishedEvents, persistenceCalls,
    deps: {
      getAgent: vi.fn(),
      contextManager: { loadContextMessages: vi.fn(async () => ({ contextMessages: [] })) },
      loadConversationHistory: vi.fn(async () => []),
      conversationPersistence: persistence as any,
      eventChannel: eventChannel as any,
      sseRegistry: { getSubscribers: () => new Set() } as any,
      stateManager: {
        getCurrentAgent: () => undefined,
        getLastHandoffPrompt: () => undefined,
        clearLastHandoffPrompt: () => undefined,
        setSessionMetadata: () => undefined,
        getSelectedTodoList: () => undefined,
        setSelectedTodoList: () => undefined,
      } as any,
      careBridge,
    } as any,
  }
}

async function* yieldEvents(events: BridgeEvent[]): AsyncGenerator<BridgeEvent, void, void> {
  for (const e of events) yield e
}

function execParamsSupport(overrides: Partial<{ visitorId: string | undefined }> = {}): any {
  const visitorId = 'visitorId' in overrides ? overrides.visitorId : 'vis-1'
  return {
    appId: 'app-1', conversationId: 'aab-1', content: 'help me', siteId: 'site-1',
    agentId: 'support', authType: 'basic',
    lifecycleContext: { agentContext: { visitorId } },
  }
}

describe('MessageExecutionService — support turn', () => {
  it('forwards bridge events to the event channel for a /agent support turn', async () => {
    const { publishedEvents, deps, persistenceCalls } = makeDeps({
      streamSupportTurn: () => yieldEvents([
        { type: 'chunk', content: 'hello ', data: {}, agentName: 'support', conversationId: 'aab-1' },
        { type: 'chunk', content: 'world', data: {}, agentName: 'support', conversationId: 'aab-1' },
        { type: 'complete', content: '', data: { finishReason: 'stop' }, agentName: 'support', conversationId: 'aab-1' },
      ]),
    })
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport())
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect(persistenceCalls).toContain('continueConversation')
    expect(persistenceCalls).toContain('startAgentTurn')
  })

  it('emits "visitor session missing" inline error when visitorId is absent', async () => {
    const { publishedEvents, deps } = makeDeps({
      streamSupportTurn: () => { throw new Error('bridge should not be called') },
    })
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport({ visitorId: undefined }))
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((publishedEvents[0] as { content: string }).content).toMatch(/visitor session missing|support is unavailable/i)
  })

  it('emits "Care not configured" inline error when careBridge dep is null', async () => {
    const { publishedEvents, deps } = makeDeps(null)
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport())
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((publishedEvents[0] as { content: string }).content).toMatch(/not configured/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm --filter @airo/agents test:unit src/server/sse/__tests__/MessageExecutionService.support-turn.test.ts
```

Expected: FAIL — `careBridge` not in `ExecutionDeps`, or `'support'` agentId path not implemented.

- [ ] **Step 3: Add `careBridge` to `ExecutionDeps`**

Open `agents/src/server/sse/MessageExecutionService.ts`. Find the `interface ExecutionDeps {` declaration. After the last optional field (currently `resolveToolMetadata`), add:

```typescript
  /**
   * Optional Care bridge. When set and `effectiveAgentId === 'support'`,
   * the message-execution branches to `executeSupportUnderTrace` and
   * forwards Care's NDJSON stream to the event channel. Null in dev
   * environments without `AIRO_CARE_BASE_URL`; the support path emits
   * a "Care not configured" inline error chunk in that case.
   */
  careBridge?: import('../../care/index.js').CareBridge | null
```

- [ ] **Step 4: Implement `executeSupportUnderTrace`**

In `agents/src/server/sse/MessageExecutionService.ts`, immediately after the `executeUnderTrace` method (closing brace), add:

```typescript
private async executeSupportUnderTrace(
  params: ExecuteParams,
  turnSnapshot: TurnSnapshotState,
): Promise<TurnExecutionResult> {
  const {
    appId, conversationId, content, siteId, authType,
    lifecycleContext, requestId, apmTransaction,
  } = params
  const agentCtx = lifecycleContext?.agentContext
  const sseSocketId = sseSessionKey(conversationId)

  // Cancel any in-flight prior turn for this conversation.
  this.abortControllers.get(conversationId)?.abort()
  const abortController = new AbortController()
  this.abortControllers.set(conversationId, abortController)

  // Bridge sseRegistry → eventChannel.
  this.setupStreamState({
    conversationId, appId, agentNameForApm: 'support',
    requestId, apmTransaction,
  })

  // Persist user message + open agent-turn slot.
  const persistenceContext: SSEPersistenceContext = {
    socketId: sseSocketId, agentName: 'support', appId, siteId,
    conversation: { conversationId },
    metadata: {
      authType,
      ...(agentCtx?.customerId && { customerId: agentCtx.customerId }),
    },
  }
  let activeAgentMessageId: string | undefined
  try {
    await this.deps.conversationPersistence.continueConversation(conversationId, content, persistenceContext)
    activeAgentMessageId = await this.deps.conversationPersistence.startAgentTurn(conversationId, persistenceContext)
  } catch (err) {
    logger.error('sse.execution.support.persist_failed', { appId, conversationId, ...errorFields(err) })
    // Emit a user-facing error and end the turn.
    await this.publishNonTerminal(appId, conversationId, {
      type: 'chunk', content: 'Sorry, something went wrong. Try again in a moment.', data: {},
      agentName: 'support', conversationId,
    })
    await this.publishTerminal(appId, conversationId, {
      type: 'complete', content: '', data: { finishReason: 'error' },
      agentName: 'support', conversationId,
    })
    return { success: false }
  }

  this.emitConversationStartIfFirstTurn(lifecycleContext, conversationId, 'support')

  // Guard 1: missing visitorId.
  if (!agentCtx?.visitorId) {
    logger.warn('sse.execution.support.visitor_missing', { appId, conversationId })
    await this.publishNonTerminal(appId, conversationId, {
      type: 'chunk',
      content: 'Sorry, support is unavailable — visitor session missing. Reload and try again.',
      data: {}, agentName: 'support', conversationId,
    })
    await this.publishTerminal(appId, conversationId, {
      type: 'complete', content: '', data: { finishReason: 'error' },
      agentName: 'support', conversationId,
    })
    return { success: false }
  }

  // Guard 2: bridge not configured.
  const careBridge = this.deps.careBridge
  if (!careBridge) {
    logger.warn('sse.execution.support.bridge_disabled', { appId, conversationId })
    await this.publishNonTerminal(appId, conversationId, {
      type: 'chunk',
      content: 'Support is not configured on this server.',
      data: {}, agentName: 'support', conversationId,
    })
    await this.publishTerminal(appId, conversationId, {
      type: 'complete', content: '', data: { finishReason: 'error' },
      agentName: 'support', conversationId,
    })
    return { success: false }
  }

  // Drain the bridge → publish to event channel. Bridge guarantees exactly
  // one terminal `complete` at the end; we use publishTerminal for it,
  // publishNonTerminal for everything else.
  try {
    let sawTerminal = false
    for await (const event of careBridge.streamSupportTurn({
      aabConversationId: conversationId,
      visitorId: agentCtx.visitorId,
      message: content,
      abortSignal: abortController.signal,
    })) {
      if (event.type === 'complete') {
        sawTerminal = true
        await this.publishTerminal(appId, conversationId, event)
      } else {
        await this.publishNonTerminal(appId, conversationId, event)
      }
    }
    if (!sawTerminal) {
      // Defensive: bridge should always end with complete. If it didn't,
      // emit one ourselves so the client doesn't hang.
      logger.warn('sse.execution.support.no_terminal', { appId, conversationId })
      await this.publishTerminal(appId, conversationId, {
        type: 'complete', content: '', data: { finishReason: 'stop' },
        agentName: 'support', conversationId,
      })
    }
  } finally {
    if (this.abortControllers.get(conversationId) === abortController) {
      this.abortControllers.delete(conversationId)
    }
    this.activeStreams.delete(conversationId)
  }

  return { success: true }
}
```

- [ ] **Step 5: Add the early branch in `executeUnderTrace`**

In `agents/src/server/sse/MessageExecutionService.ts`, find `executeUnderTrace`. Immediately after the destructure block at the top (where `resolvedAgentId` is computed from `agentId`), and BEFORE the `assessmentHandle` setup, insert:

```typescript
if (resolvedAgentId === 'support') {
  return this.executeSupportUnderTrace(params, turnSnapshot)
}
```

- [ ] **Step 6: Typecheck**

Run:
```bash
pnpm --filter @airo/agents typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Run the support-turn test**

Run:
```bash
pnpm --filter @airo/agents test:unit src/server/sse/__tests__/MessageExecutionService.support-turn.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 8: Run the full agents unit suite — no regressions**

Run:
```bash
pnpm --filter @airo/agents test:unit
```

Expected: ALL tests PASS (existing + new).

- [ ] **Step 9: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/MessageExecutionService.support-turn.test.ts
git commit -m "feat(sse): branch /agent support turns to CareBridge"
```

---

### Task 11: Wire `CareBridge` into `app.ts` + env example

**Files:**
- Modify: `agents/src/server/app.ts`
- Modify: `agents/.env.example`

**Interfaces:**
- Consumes: `createCareBridge` from `agents/src/care/index.js`
- Produces: a `CareBridge | null` instance constructed once at SSE service init, passed to `MessageExecutionService` as `careBridge` dep.

- [ ] **Step 1: Import `createCareBridge` in `app.ts`**

Open `agents/src/server/app.ts`. In the import block (around line 188-215, near other `../care` siblings would go), add:

```typescript
import { createCareBridge } from '../care/index.js';
```

- [ ] **Step 2: Construct the bridge inside `getOrCreateSSEExecutionService`**

In `agents/src/server/app.ts`, find `getOrCreateSSEExecutionService`. Immediately after the existing `const sseAppRepo = new AppRepository()` line, add:

```typescript
const careBridge = createCareBridge({
  baseURL: process.env.AIRO_CARE_BASE_URL ?? '',
  executor: process.env.AIRO_CARE_EXECUTOR ?? 'v1/orchestrator-test',
})
```

- [ ] **Step 3: Pass `careBridge` into `MessageExecutionService` deps**

In the same function, find the `new MessageExecutionService({` block. Inside that object literal, after the `lifecycle: getMessageLifecycleDeps(),` entry (or the last existing entry — order doesn't matter), add:

```typescript
careBridge,
```

- [ ] **Step 4: Update `agents/.env.example`**

Open `agents/.env.example`. Add at the end:

```bash

# Airo Care bridge — set AIRO_CARE_BASE_URL to enable /agent support.
# Leave unset for local dev to disable support routing (the bridge
# becomes null and "Care is not configured" surfaces inline).
AIRO_CARE_BASE_URL=
AIRO_CARE_EXECUTOR=v1/orchestrator-test
```

- [ ] **Step 5: Typecheck and lint**

Run:
```bash
pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/app.ts agents/.env.example
git commit -m "feat(care): wire CareBridge from AIRO_CARE_BASE_URL/AIRO_CARE_EXECUTOR"
```

---

### Task 12: Final verification

**Files:**
- None (no code changes unless previous tasks need fixes)

**Interfaces:**
- Consumes: nothing
- Produces: confidence that the integration is complete and clean

- [ ] **Step 1: Full typecheck**

Run:
```bash
pnpm --filter @airo/agents typecheck
```

Expected: 0 errors.

- [ ] **Step 2: Full lint**

Run:
```bash
pnpm --filter @airo/agents lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Full unit test suite**

Run:
```bash
pnpm --filter @airo/agents test:unit
```

Expected: ALL tests PASS, no skips related to Care.

- [ ] **Step 4: Verify boundary discipline**

Run:
```bash
grep -rE "from ['\"]\.\./(server|database|agents|tools)" agents/src/care/ 2>&1 && \
  echo "BOUNDARY VIOLATION above" || echo "OK: no forbidden imports in agents/src/care/"

grep -rE "from ['\"]@airo/ai-lib|from ['\"]express" agents/src/care/ 2>&1 && \
  echo "BOUNDARY VIOLATION above" || echo "OK: no @airo/ai-lib or express in agents/src/care/"

grep -rE "from ['\"]\.\./care/(CareSessionStore|translator|event-queue|identity|errors)" agents/src/ --exclude-dir=care 2>&1 && \
  echo "BOUNDARY VIOLATION above (internal imported from outside the module)" || \
  echo "OK: only care/index.ts referenced from outside"
```

Expected: each grep returns "OK: ..." with no violations. (Each grep prints nothing when clean, then the `||` branch prints "OK".)

- [ ] **Step 5: Verify the public-surface symbol list**

Run:
```bash
grep -E "^export " agents/src/care/index.ts
```

Expected output:
```
export { createCareBridge } from './CareBridge.js'
export type {
```
(Confirms only `createCareBridge` (value) plus type re-exports.)

- [ ] **Step 6: Manual smoke (informational only — does not block plan completion)**

If `AIRO_CARE_BASE_URL` is set in your local env:
```bash
pnpm run dev
```

Then in the chat, type:
```
/agent support
my email isn't working
```

Expected: chat streams a Care response in real time. Logs include `care.care_conversation.created` and `care.stream.completed` events.

If `AIRO_CARE_BASE_URL` is unset:
- App starts cleanly; log emits `care.bridge.disabled` once at boot.
- Typing `/agent support\n...` in chat shows a single inline message: "Support is not configured on this server." followed by stream end.

- [ ] **Step 7: Commit any final fixes (if any)**

If steps 1-6 surface fixes, commit them with descriptive messages following the convention `fix(care): ...` or `chore(care): ...`. If everything passes clean, no commit is needed for this step.

---

## Self-review notes

- **Spec coverage:** All sections of the spec map to tasks. Module layout (Task 2-8), intercept point (Task 9-10), session store (Task 5), translator (Task 6), bridge wiring (Task 11), persistence-inherited (covered by Task 10's persistence calls), observability (logs in Tasks 5/7/10), testing strategy (each module task), boundary rules (Task 12 step 4), upstream fast-follow (covered by `TODO(care-abort)` in Task 7).
- **Placeholder check:** No `TBD`/`TODO` left in plan text (only the legitimate `TODO(care-abort)` code comment which marks the fast-follow site).
- **Type consistency:** `BridgeEvent` defined in Task 6 (translator) and re-exported in Task 7 (CareBridge) and Task 8 (index). `SupportTurnInput` defined in Task 7. `CareSession`/`CareSessionStore` defined in Task 5 and consumed in Task 7. `setupStreamState` defined in Task 9 and consumed in Task 10. `executeSupportUnderTrace` defined in Task 10 (in implementation). All symbols match across tasks.
- **Scope check:** All twelve tasks ship as one bridge feature. No subsystems to split.
