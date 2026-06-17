# SSE Reconnect: Idle-Dormant / Active-Bounded — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the SSE chat client from retrying an unreachable stream forever — go *dormant* (silent, re-arm on next send) when the conversation is idle, and bound retries to ~5 minutes then surface a terminal error when a turn is active.

**Architecture:** `SSETransport`'s `onerror` circuit breaker latches whether a turn was active (`_state === 'streaming'`) at the start of a failure streak. Idle outages call `enterDormant()` (close, stop, new `'dormant'` state). Active outages call `enterActiveCooldown()` for a bounded number of quiet cooldown cycles, then `enterUnreachable()` (terminal `onError`). The old infinite auto-reopen cooldown is removed.

**Tech Stack:** TypeScript, Vitest (node env), the `eventsource@4.1.0` polyfill (fixed 3s reconnect interval), React hook (`useSSEChat`).

**Spec:** `docs/superpowers/specs/2026-06-17-sse-reconnect-backoff-giveup-design.md`

---

## File Structure

- `app/src/services/transport/types.ts` — add `'dormant'` to the `TransportState` union.
- `app/src/services/transport/SSETransport.ts` — the reconnect state machine (all behavior).
- `app/src/hooks/useSSEChat.ts` — map `'dormant'` → `connection.status: 'idle'` in `deriveConnectionState`.
- `app/src/services/transport/__tests__/SSETransport.test.ts` — transport tests (rewrite obsolete cooldown tests; add idle/active/guard/logging tests).
- `app/src/hooks/__tests__/useSSEChat.test.ts` — hook mapping test.

---

### Task 1: Add the `'dormant'` transport state and hook mapping

**Files:**
- Modify: `app/src/services/transport/types.ts:1`
- Modify: `app/src/hooks/useSSEChat.ts:132-143`
- Test: `app/src/hooks/__tests__/useSSEChat.test.ts` (add after line 1498)

- [ ] **Step 1: Write the failing hook test**

Add this test in `app/src/hooks/__tests__/useSSEChat.test.ts` immediately after the `'connection.status is error when state is error'` test (after line 1498). It mirrors the existing `onStateChange`-driven tests:

```ts
  it('connection.status is idle (not error) when state is dormant', async () => {
    const hook = await setupHook()

    act(() => {
      lastTransport.callbacks?.onStateChange('dormant')
    })

    expect(hook.result.current.connection.status).toBe('idle')
    expect(hook.result.current.connection.isConnected).toBe(false)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test -- -t "connection.status is idle"`
Expected: FAIL — `deriveConnectionState`'s `default` branch returns `'connecting'` for the unknown `'dormant'` value, so `connection.status` is `'connecting'`, not `'idle'`.

- [ ] **Step 3: Add `'dormant'` to the `TransportState` union**

In `app/src/services/transport/types.ts`, change line 1:

```ts
export type TransportState = 'disconnected' | 'connected' | 'streaming' | 'error' | 'dormant'
```

- [ ] **Step 4: Map `'dormant'` in `deriveConnectionState`**

In `app/src/hooks/useSSEChat.ts`, the function currently reads:

```ts
function deriveConnectionState(transportState: TransportState): { connected: boolean; status: ConnectionStatus } {
  const connected = transportState === 'connected' || transportState === 'streaming'
  const status: ConnectionStatus = (() => {
    switch (transportState) {
      case 'connected': return 'idle'
      case 'streaming': return 'streaming'
      case 'error': return 'error'
      default: return 'connecting'
    }
  })()
  return { connected, status }
}
```

Add a `'dormant'` case so a dormant transport reads as a benign idle connection (composer stays enabled; `isProcessing` is independent of `isConnected`). `connected` stays `false` because the stream is not live:

```ts
function deriveConnectionState(transportState: TransportState): { connected: boolean; status: ConnectionStatus } {
  const connected = transportState === 'connected' || transportState === 'streaming'
  const status: ConnectionStatus = (() => {
    switch (transportState) {
      case 'connected': return 'idle'
      case 'streaming': return 'streaming'
      case 'error': return 'error'
      // Idle give-up: a torn-down stream re-armed only by the next send.
      // Surface as a benign idle connection, not an error (AIROBUILD-2628).
      case 'dormant': return 'idle'
      default: return 'connecting'
    }
  })()
  return { connected, status }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter website test -- -t "connection.status is idle"`
Expected: PASS

- [ ] **Step 6: Typecheck (the union is additive; WS path is unaffected)**

Run: `pnpm --filter website typecheck`
Expected: PASS — `useStreamingWebSocket` derives its status from its own XState machine and does not switch on this union; `deriveConnectionState` is the only exhaustive reader and now handles `'dormant'`.

- [ ] **Step 7: Commit**

```bash
git add app/src/services/transport/types.ts app/src/hooks/useSSEChat.ts app/src/hooks/__tests__/useSSEChat.test.ts
git commit -m "feat(sse): add dormant transport state, map to idle connection (AIROBUILD-2628)"
```

---

### Task 2: Replace the cooldown loop with idle-dormant / active-bounded reconnect

**Files:**
- Modify: `app/src/services/transport/SSETransport.ts` (config interface, fields, constructor, `connect`, `disconnect`, `reconnectIfNeeded`, `enterCooldown` → new methods, `initialize` handler, `onerror`)
- Test: `app/src/services/transport/__tests__/SSETransport.test.ts` (add logger mock; rewrite the obsolete cooldown tests; add new tests)

This is one behavior change committed with its tests so the suite stays green.

- [ ] **Step 1: Add a logger mock to the transport test file**

At the top of `app/src/services/transport/__tests__/SSETransport.test.ts`, after the existing `vi.mock('@/lib/agent-fetch', ...)` block (ends at line 23), add a logger mock and import so log-collapse can be asserted (no existing test asserts the logger, so this is additive):

```ts
vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
```

And add to the imports at the top of the file (after line 6's `import { SSETransport }`):

```ts
import { logger } from '@/lib/request-context'
```

- [ ] **Step 2: Replace the three obsolete cooldown tests and add the new behavior tests**

In `app/src/services/transport/__tests__/SSETransport.test.ts`, replace the entire body of the `describe('reconnect cooldown circuit-breaker', ...)` block's first three tests — `'enters cooldown after maxConsecutiveErrors and closes the EventSource'`, `'reconnectIfNeeded short-circuits cooldown and reopens immediately'`, and `'cooldown timer auto-reopens when it fires'` (lines 318–412) — with the tests below. Keep the `fireError` helper (lines 313–316) and the remaining tests in that describe block unchanged.

```ts
    it('idle stream that exhausts retries goes dormant — no error, no reopen', async () => {
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 3,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      // autoFireInitialize (default true) → reaches 'connected' (idle).
      await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenCalledWith('connected'))

      const es = lastEventSourceInstance
      const countBefore = eventSourceInstances.length

      fireError()
      fireError()
      fireError() // threshold trip while idle

      expect(es.close).toHaveBeenCalled()
      expect(callbacks.onStateChange).toHaveBeenCalledWith('dormant')
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(eventSourceInstances.length).toBe(countBefore) // no reopen
      t.destroy()
    })

    it('reconnectIfNeeded does NOT revive a dormant (idle) transport', async () => {
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 1,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenCalledWith('connected'))

      fireError() // idle → dormant
      expect(callbacks.onStateChange).toHaveBeenCalledWith('dormant')

      const count = eventSourceInstances.length
      t.reconnectIfNeeded()
      expect(eventSourceInstances.length).toBe(count) // focus/visibility cannot revive
      t.destroy()
    })

    it('active-turn outage retries bounded cooldowns then gives up (unreachable)', async () => {
      autoFireInitialize = false // reopens never "succeed", so the budget accumulates
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 1,
        cooldownMs: 10,
        maxActiveCooldowns: 2,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await Promise.resolve()

      // Force an active turn: sendMessage sets state 'streaming' on the 202 POST.
      await t.sendMessage({ content: 'go', sessionId: 's' })
      expect(t.state).toBe('streaming')

      fireError() // cooldown 1 (quiet — no onError)
      expect(callbacks.onError).not.toHaveBeenCalled()
      await new Promise((r) => setTimeout(r, 20)) // timer reopens
      fireError() // cooldown 2
      await new Promise((r) => setTimeout(r, 20)) // timer reopens
      fireError() // budget exhausted → terminal

      expect(callbacks.onStateChange).toHaveBeenCalledWith('error')
      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'sse_transport_unreachable' }),
      )
      t.destroy()
    })

    it('reconnectIfNeeded short-circuits an active cooldown and reopens immediately', async () => {
      autoFireInitialize = false
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 1,
        cooldownMs: 60_000,
        maxActiveCooldowns: 3,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await Promise.resolve()

      await t.sendMessage({ content: 'go', sessionId: 's' }) // state → streaming
      const before = eventSourceInstances.length

      fireError() // active cooldown (long timer; will not fire during the test)
      expect(eventSourceInstances.length).toBe(before) // closed, not yet reopened

      t.reconnectIfNeeded() // user signal short-circuits the cooldown
      expect(eventSourceInstances.length).toBe(before + 1)
      t.destroy()
    })

    it('logs eventsource.error once per streak, not per attempt (AC3)', async () => {
      const warnSpy = logger.warn as ReturnType<typeof vi.fn>
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 5,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenCalledWith('connected'))
      warnSpy.mockClear()

      fireError()
      fireError()
      fireError()
      fireError() // 4 errors, below threshold (5)

      const errorLogs = warnSpy.mock.calls.filter((c) => c[0] === 'sse.transport.eventsource.error')
      expect(errorLogs).toHaveLength(1) // first-of-streak only
      t.destroy()
    })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter website test app/src/services/transport/__tests__/SSETransport.test.ts`
Expected: the five tests above FAIL — `enterActiveCooldown`/`enterDormant`/`enterUnreachable`, the `'dormant'` state, the active/idle latch, the `maxActiveCooldowns` option, and first-of-streak logging do not exist yet (the current code emits `'sse_transport_cooldown'` and reopens forever).

- [ ] **Step 4: Add the config option, fields, and constructor default**

In `app/src/services/transport/SSETransport.ts`, extend the `SSETransportConfig` interface (after the `cooldownMs?` doc block, around line 52):

```ts
  cooldownMs?: number
  /**
   * Number of quiet cooldown cycles allowed during an ACTIVE turn before the
   * transport gives up and surfaces a terminal error. Idle outages never use
   * this — they go dormant after the first streak. (AIROBUILD-2628)
   */
  maxActiveCooldowns?: number
}
```

Add fields alongside the existing circuit-breaker fields (after line 76 `private consecutiveErrors = 0`):

```ts
  private consecutiveErrors = 0
  // Active-turn cooldown budget + the latched active/idle decision for the
  // current outage. activeCooldowns persists across cooldown-timer reopens
  // (so the ~5-min budget keeps counting) and is reset only by recovery
  // (initialize) or explicit intent. outageActive is latched on the first
  // error of a streak — see onerror.
  private readonly maxActiveCooldowns: number
  private activeCooldowns = 0
  private outageActive = false
```

In the constructor (after line 84 `this.cooldownMs = config.cooldownMs ?? 60_000`):

```ts
    this.maxActiveCooldowns = config.maxActiveCooldowns ?? 3
```

- [ ] **Step 5: Add `resetReconnectState()` and reset the outage on explicit intent + recovery**

In `app/src/services/transport/SSETransport.ts`, add this method next to `resetCooldown` (after line 211):

```ts
  // Full reset of the active/idle outage tracking. Distinct from
  // resetCooldown(): the active-cooldown timer must PRESERVE activeCooldowns so
  // the ~5-minute budget keeps counting across reopen cycles, whereas explicit
  // intent (connect / manual reconnect / disconnect) and a successful
  // initialize forget the outage entirely.
  private resetReconnectState(): void {
    this.activeCooldowns = 0
    this.outageActive = false
  }
```

In `connect()`, after `this.resetCooldown()` (line 101):

```ts
    this.resetCooldown()
    this.resetReconnectState()
```

In `disconnect()`, after `this.resetCooldown()` (line 132):

```ts
    this.resetCooldown()
    this.resetReconnectState()
```

In the `initialize` event handler, where it currently resets the counter (line 523), add the outage reset (a successful initialize means the stream — and any in-progress turn — recovered):

```ts
      this.consecutiveErrors = 0
      this.resetReconnectState()
      this.setState('connected')
```

- [ ] **Step 6: Add the `'dormant'` guard and outage reset to `reconnectIfNeeded()`**

In `app/src/services/transport/SSETransport.ts`, `reconnectIfNeeded()` currently reads (lines 162–176):

```ts
  reconnectIfNeeded(): void {
    if (!this.appId || !this.token || !this.conversationId) return
    if (this._state === 'disconnected') return
    if (this.cooldownUntil > 0 && Date.now() < this.cooldownUntil) {
      this.resetCooldown('manual')
      this.openEventSource()
      return
    }
    if (!this.eventSource) {
      this.openEventSource()
    }
  }
```

Replace it with:

```ts
  reconnectIfNeeded(): void {
    if (!this.appId || !this.token || !this.conversationId) return
    if (this._state === 'disconnected') return
    // Dormant is a deliberate idle give-up (AIROBUILD-2628): only an explicit
    // sendMessage() re-arms it. Tab focus / visibility must NOT revive it.
    if (this._state === 'dormant') return
    if (this.cooldownUntil > 0 && Date.now() < this.cooldownUntil) {
      this.resetCooldown('manual')
      this.resetReconnectState() // user signal grants a fresh active budget
      this.openEventSource()
      return
    }
    if (!this.eventSource) {
      this.openEventSource()
    }
  }
```

- [ ] **Step 7: Replace `enterCooldown()` with the three outage methods**

In `app/src/services/transport/SSETransport.ts`, delete the entire `enterCooldown()` method (lines 178–197) and replace it with:

```ts
  // Active-turn outage: a turn was streaming when the connection dropped, so
  // keep trying (quietly) to avoid dropping completion events — recovery-replay
  // resumes the turn when the stream returns. Bounded to maxActiveCooldowns
  // cycles (~5 min at the defaults) before giving up.
  private enterActiveCooldown(): void {
    if (this.activeCooldowns >= this.maxActiveCooldowns) {
      this.enterUnreachable()
      return
    }
    this.activeCooldowns++
    this.cooldownUntil = Date.now() + this.cooldownMs
    // Quiet: do NOT fire onError and do NOT change _state — the turn is still
    // running server-side and its UI must stay intact across the wait.
    this.closeEventSource()
    logger.warn('sse.transport.cooldown.entered', {
      appId: this.appId, conversationId: this.conversationId,
      cooldownMs: this.cooldownMs, errors: this.consecutiveErrors,
      activeCooldowns: this.activeCooldowns,
    })
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null
      const hadCredentials = !!(this.appId && this.token && this.conversationId)
      this.resetCooldown('timer') // resets consecutiveErrors; KEEPS activeCooldowns
      if (hadCredentials) this.openEventSource()
    }, this.cooldownMs)
  }

  // Idle outage: no turn was active, so a live stream is only a convenience.
  // Stop retrying entirely and go dormant — re-armed only by the next
  // sendMessage(). This silences orphaned/idle tabs (AIROBUILD-2628).
  private enterDormant(): void {
    this.closeEventSource()
    this.resetReconnectState()
    this.setState('dormant')
    logger.warn('sse.transport.dormant', {
      appId: this.appId, conversationId: this.conversationId,
      errors: this.consecutiveErrors,
    })
  }

  // Active-turn give-up after the cooldown budget is exhausted. Surface a
  // terminal transport error so useSSEChat finalizes the stream and unsticks
  // the input; a subsequent send re-arms the stream.
  private enterUnreachable(): void {
    this.closeEventSource()
    this.resetReconnectState()
    this.setState('error')
    this.callbacks?.onError(new Error('sse_transport_unreachable'))
    logger.warn('sse.transport.unreachable', {
      appId: this.appId, conversationId: this.conversationId,
      activeCooldowns: this.activeCooldowns,
    })
  }
```

- [ ] **Step 8: Rewrite the `onerror` handler to latch active/idle and branch**

In `app/src/services/transport/SSETransport.ts`, the `onerror` handler currently reads (lines 483–506):

```ts
    this.eventSource.onerror = (err: any) => {
      if (err?.code === 401 || err?.status === 401) {
        this.closeEventSource()
        void this.refreshTokenAndReopen()
        return
      }
      this.consecutiveErrors++
      // Non-401 errors: let the polyfill reconnect on its own until the
      // threshold trips. After that we close it and freeze for cooldownMs.
      logger.warn('sse.transport.eventsource.error', {
        appId: this.appId, conversationId: this.conversationId,
        status: err?.status, code: err?.code,
        message: err?.message ?? errMessage(err),
        consecutiveErrors: this.consecutiveErrors,
      })
      if (this.consecutiveErrors >= this.maxConsecutiveErrors && this.cooldownUntil === 0) {
        this.enterCooldown()
      }
    }
```

Replace it with:

```ts
    this.eventSource.onerror = (err: any) => {
      if (err?.code === 401 || err?.status === 401) {
        // 401 is an auth event, not a transport fault — refresh the token and
        // reopen without bumping the circuit-breaker counter.
        this.closeEventSource()
        void this.refreshTokenAndReopen()
        return
      }
      this.consecutiveErrors++
      // Latch active-vs-idle at the START of a failure streak. _state changes
      // across cooldown cycles, so reading it at the threshold is unsafe; the
      // latch protects the turn that was live when the drop began. Log only the
      // first error of a streak — attempts 2..N are suppressed so an orphaned
      // tab does not flood ESSP (AIROBUILD-2628, AC3).
      if (this.consecutiveErrors === 1) {
        this.outageActive = this._state === 'streaming'
        logger.warn('sse.transport.eventsource.error', {
          appId: this.appId, conversationId: this.conversationId,
          status: err?.status, code: err?.code,
          message: err?.message ?? errMessage(err),
          outageActive: this.outageActive,
        })
      }
      if (this.consecutiveErrors >= this.maxConsecutiveErrors && this.cooldownUntil === 0) {
        if (this.outageActive) {
          this.enterActiveCooldown()
        } else {
          this.enterDormant()
        }
      }
    }
```

- [ ] **Step 9: Run the transport tests to verify they pass**

Run: `pnpm --filter website test app/src/services/transport/__tests__/SSETransport.test.ts`
Expected: PASS — the five new tests pass, and the retained tests (401 no-bump, initialize reset, reconnectIfNeeded no-ops, disconnect detaches listener, fresh connect resets) still pass.

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add app/src/services/transport/SSETransport.ts app/src/services/transport/__tests__/SSETransport.test.ts
git commit -m "feat(sse): idle-dormant + active-bounded reconnect, replacing infinite cooldown (AIROBUILD-2628)"
```

---

### Task 3: Re-arm the stream on send after dormancy / give-up

**Files:**
- Modify: `app/src/services/transport/SSETransport.ts` (`sendMessage`, around line 251)
- Test: `app/src/services/transport/__tests__/SSETransport.test.ts` (add inside the `describe('reconnect cooldown circuit-breaker', ...)` block)

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('reconnect cooldown circuit-breaker', ...)` block in `app/src/services/transport/__tests__/SSETransport.test.ts`:

```ts
    it('sendMessage re-arms the stream when dormant', async () => {
      const t = new SSETransport({
        baseUrl: 'http://localhost:4000',
        maxConsecutiveErrors: 2,
        cooldownMs: 1000,
      })
      t.on(callbacks)
      t.connect('app_1', 'token_123', 'conv_1')
      await vi.waitFor(() => expect(callbacks.onStateChange).toHaveBeenCalledWith('connected'))

      fireError()
      fireError() // idle → dormant
      expect(callbacks.onStateChange).toHaveBeenCalledWith('dormant')

      const countBefore = eventSourceInstances.length
      await t.sendMessage({ content: 'Hi', sessionId: 's' })

      expect(eventSourceInstances.length).toBe(countBefore + 1) // stream re-armed
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/conversations/app_1/conv_1/messages',
        expect.objectContaining({ method: 'POST' }),
      )
      t.destroy()
    })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test -- -t "sendMessage re-arms the stream when dormant"`
Expected: FAIL — `sendMessage` does not reopen the EventSource, so `eventSourceInstances.length` stays at `countBefore`.

- [ ] **Step 3: Add the re-arm block to `sendMessage`**

In `app/src/services/transport/SSETransport.ts`, `sendMessage` currently starts (line 250–253):

```ts
  async sendMessage(params: SendMessageParams): Promise<void> {
    if (!this.appId || !this.conversationId) throw new Error('Not connected')

    const response = await this.authedFetch(`${this.convPath}/messages`, {
```

Insert the re-arm block after the `Not connected` throw:

```ts
  async sendMessage(params: SendMessageParams): Promise<void> {
    if (!this.appId || !this.conversationId) throw new Error('Not connected')

    // Re-arm a torn-down stream on user send: idle dormancy and the active
    // give-up both close the EventSource, and the POST's response events need a
    // live stream to land on (recovery-replay handles ordering). An explicit
    // disconnect() is honoured — not revived. (AIROBUILD-2628)
    if (!this.eventSource && this._state !== 'disconnected') {
      this.consecutiveErrors = 0
      this.resetReconnectState()
      this.openEventSource()
    }

    const response = await this.authedFetch(`${this.convPath}/messages`, {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter website test -- -t "sendMessage re-arms the stream when dormant"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/services/transport/SSETransport.ts app/src/services/transport/__tests__/SSETransport.test.ts
git commit -m "feat(sse): re-arm dormant/terminated stream on next send (AIROBUILD-2628)"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full transport + hook test files**

Run: `pnpm --filter website test app/src/services/transport/__tests__/SSETransport.test.ts app/src/hooks/__tests__/useSSEChat.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 2: Typecheck the whole package**

Run: `pnpm --filter website typecheck`
Expected: PASS

- [ ] **Step 3: Lint the changed files**

Run: `pnpm --filter website lint`
Expected: PASS (no new errors in `SSETransport.ts`, `types.ts`, `useSSEChat.ts`, or the two test files).

- [ ] **Step 4: Confirm no other references to the removed `enterCooldown` or the old `sse_transport_cooldown` error**

Run: `grep -rn "enterCooldown\|sse_transport_cooldown" app/src`
Expected: no matches (the method is removed and the cooldown `onError` no longer fires; `sse.transport.cooldown.entered` log remains and is fine).

---

## Self-Review

**Spec coverage:**
- AC1 (capped retries, no hundreds of rapid retries) → Task 2 (idle → dormant after one streak; active → `maxActiveCooldowns` then terminal; infinite reopen removed).
- AC2 (terminal state + affordance) → Task 2 `enterUnreachable` reuses the existing `onError` terminal path; idle dormancy is intentionally silent (Task 1 maps it to a benign idle status).
- AC3 (log once per cycle) → Task 2 first-of-streak `eventsource.error` log + one-shot `dormant` / `cooldown.entered` / `unreachable`; verified by the "logs once per streak" test.
- AC4 (transient still recovers; verified deleted + long-idle) → `initialize` resets the budget (Task 2 Step 5; covered by the retained "successful initialize resets" test); idle deleted/long-idle → dormant; active outage → bounded then terminal.
- Re-arm on send (spec "only idle re-arm") → Task 3.
- `'dormant'` state + idle mapping (spec types/hook section) → Task 1.

**Placeholder scan:** none — every step has exact paths, code, commands, and expected output.

**Type consistency:** `maxActiveCooldowns`, `activeCooldowns`, `outageActive`, `resetReconnectState`, `enterActiveCooldown`, `enterDormant`, `enterUnreachable` are used identically across Tasks 2–3; `'dormant'` is the single state literal used in `types.ts`, `deriveConnectionState`, `reconnectIfNeeded`, and the tests; the terminal error message is `'sse_transport_unreachable'` everywhere.
