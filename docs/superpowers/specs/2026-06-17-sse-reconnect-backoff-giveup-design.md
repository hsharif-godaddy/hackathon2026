# AIROBUILD-2628 — SSE reconnect: idle-dormant / active-bounded

**Status:** Design approved (pending spec review)
**Date:** 2026-06-17
**Ticket:** AIROBUILD-2628 — "Builder chat (SSE): client reconnect storms on deleted/idle apps — add backoff + give-up"
**Files:** `app/src/services/transport/SSETransport.ts`, `app/src/services/transport/types.ts`, `app/src/hooks/useSSEChat.ts`

## Problem

An orphaned `/develop` tab (deleted app, or an app idle for days whose agent has been
hibernated/stopped) cannot re-establish its SSE stream. The browser connects directly to the
agent, so a gone agent yields a network error ("Failed to fetch") with no HTTP status. The
`eventsource@4.1.0` polyfill retries on a **fixed 3s interval** forever (no built-in backoff), so:

- `onerror` fires every ~3s, each logging `sse.transport.eventsource.error`.
- The existing circuit breaker counts `consecutiveErrors`; at `maxConsecutiveErrors` (10) it enters a
  **fixed 60s cooldown**, then **auto-reopens forever** — there is no terminal state.
- Result: ~260+ retries/session and climbing, ~25k+ ESSP events/day across many orphaned tabs.

Root cause (per ticket investigation): these are **abandoned tabs, not active-user failures**. The
active SSE path is healthy (~100% of turns that connect complete). So there is usually **no human
watching** — the fix's job is to make idle/orphaned tabs stop hammering, not to present a recovery UI.

## Key insight: idle vs active

The SSE stream is only required for *correctness* during an **active turn** (to receive streaming
events; recovery-replay catches the client up after a reconnect). When the conversation is **idle**, a
live EventSource is only a convenience — and if it is failing to reconnect, the app is unreachable, so
there are no notifications to miss anyway. The reconnect policy therefore branches on whether a turn is
active when the retry streak exhausts.

## Design

The `eventsource` polyfill's own 10×3s ≈ 30s of retries serves as the "ride out a transient blip"
window. What changes is what happens *after* that streak exhausts.

### `SSETransport.ts`

Keep `consecutiveErrors` / `maxConsecutiveErrors` (≈30s streak before the breaker acts). Replace the
infinite auto-reopen cooldown with two terminal branches.

**Latch the active/idle decision at the start of the outage**, not at threshold time: on the
`consecutiveErrors` 0→1 transition, record `outageActive = (this._state === 'streaming')`. Branch on
`outageActive` thereafter. Re-reading `_state` at the threshold is unsafe because the state changes
during cooldown cycles; the latch protects the turn that was live when the connection dropped. Cleared
on `initialize` (recovery) and on terminal/dormant resolution.

- **Idle** (`outageActive === false`) → `enterDormant()`:
  - Close the EventSource, stop retrying, no timer, no reopen.
  - `setState('dormant')` — a new benign state (see types change). The composer stays usable; no error UI.
  - This is what silences the orphaned tab.

- **Active** (`outageActive === true`) → bounded retry, then terminal:
  - Allow `maxActiveCooldowns` (default **3**) fixed `cooldownMs` (default **60s**) cooldown cycles to
    ride out a deploy / container restart. Each cycle: close ES, wait `cooldownMs`, reopen.
  - **Cooldown cycles are quiet:** they do NOT call `onError`, and the transport stays in `'streaming'`
    so the in-progress turn's UI remains intact and `recovery-replay` can resume it when the agent
    returns. (Contrast: the *current* `enterCooldown()` fires `onError`, which clears `activeStream` and
    `setIsLoading(false)` — that prematurely kills the turn UI and must NOT happen mid-budget.)
  - A successful `initialize` during any cycle resets `consecutiveErrors`, `activeCooldowns`, and
    `outageActive` (full recovery — the outage is forgotten).
  - On exhausting the cooldown budget → terminal: close ES, `setState('error')`, fire `onError` once.
    No new component — `useSSEChat.onError` finalizes the stream and unsticks the input.
  - Total active tolerance ≈ 4 streaks × 30s + 3 cooldowns × 60s ≈ **5 minutes**.

`sendMessage()`: if `_state === 'dormant'`, reopen the stream (`openEventSource()`) before issuing the
POST; recovery-replay handles event ordering. **This is the only idle re-arm.**

`reconnectIfNeeded()`: add a `'dormant'` guard alongside the existing `'disconnected'` early-return, so
tab focus / visibilitychange does **not** revive a dormant tab.

Remove the old `enterCooldown()` → auto-reopen-forever loop.

New/changed transport fields:

- `private activeCooldowns = 0` — counts active-path cooldown cycles; reset on `initialize` and on
  explicit intent (`connect()` / manual `reconnectIfNeeded()`).
- Config (constructor, defaults): `maxConsecutiveErrors = 10`, `cooldownMs = 60_000`,
  `maxActiveCooldowns = 3`.

### `types.ts`

Add `'dormant'` to the `TransportState` union (additive):

```ts
export type TransportState = 'disconnected' | 'connected' | 'streaming' | 'error' | 'dormant'
```

WS-safe: the WebSocket path derives its state from its own XState machine
(`getTransportStateKey` → `string`) and does not switch on this union; only `SSETransport` emits
`'dormant'` and only `useSSEChat.deriveConnectionState` reads the union (with a `default` branch).

### `useSSEChat.ts`

`deriveConnectionState`: map `'dormant'` → `{ connected: false, status: 'idle' }`. This keeps the
composer enabled (`isProcessing = isLoading || isStreaming || !!loadingMessage` — independent of
`isConnected`) and shows no error/spinner. The next `send` re-arms the transport.

No new banner. The active-turn terminal reuses the existing `onError` handling (sets
`connectionError`, clears `activeStream`, `setIsLoading(false)`), which unsticks the UI for the rare
case a real user's app goes unreachable mid-build.

### Logging (AC3)

- `sse.transport.eventsource.error`: log only on first-of-streak (`consecutiveErrors === 1`); suppress
  attempts 2–N.
- Add one-shot `sse.transport.dormant` (idle give-up) with the error count.
- Keep the existing one-shot `sse.transport.cooldown.entered` per active cooldown cycle (carrying
  `activeCooldowns`), and add one-shot `sse.transport.unreachable` at the active terminal.
- Net: ~260+/session-climbing → a handful per outage, then silent.

## "App gone" handling

Falls out without a probe: an idle orphan goes dormant (cause-agnostic); a deleted app surfaces
definitively on the next `send` via the existing `APP_NOT_FOUND` retry/terminal handling in
`useSSEChat`. No control-plane existence check is added.

## Acceptance criteria mapping

- **AC1 (capped backoff, no hundreds of rapid retries):** idle → dormant after one ~30s streak;
  active → bounded to ~5 min then terminal. Infinite auto-reopen removed.
- **AC2 (terminal state + clear affordance):** active → existing `onError` terminal (input unstuck);
  idle → silent dormant (correct, since no human is watching an orphaned tab). Recovery is an explicit
  `send`.
- **AC3 (log once per cycle):** first-of-streak + one-shot dormant/terminal logs.
- **AC4 (verified deleted + long-idle; transient still recovers):** transient drops recover within the
  polyfill streak or an active cooldown (`initialize` resets counters); covered by tests below.

## Out of scope

- WebSocket reconnect behaviour (parity only; no changes).
- Server / edge / gateway changes (separate investigation into long-lived SSE GET drops).
- AIROBUILD-2557 instrumentation.

## Testing

Extend `app/src/services/transport/__tests__/SSETransport.test.ts` (fake timers):

- Idle streak exhausts → `'dormant'`, EventSource closed, no reopen scheduled, no error emitted.
- Dormant + `sendMessage()` → stream reopened, POST issued.
- Dormant + focus/visibilitychange (`reconnectIfNeeded`) → no reopen.
- Active streak → cooldown cycles stay `'streaming'` and do NOT fire `onError`; after
  `maxActiveCooldowns` cycles → terminal `'error'` + `onError` fired once; total ≈ 5 min on fake timers.
- `initialize` mid-outage resets `consecutiveErrors`, `activeCooldowns`, and `outageActive` (transient
  recovery — turn continues, no terminal).
- Outage that begins while `'streaming'` stays on the active path even though state changes during
  cooldowns (latch correctness).
- Logging: `eventsource.error` emitted once per streak (not per attempt); one dormant/terminal log.

Hook-level (`useSSEChat`): `'dormant'` → `connection.status === 'idle'`, `isConnected === false`,
composer not disabled.
