# Debug Stats Drawer

A switchboard-gated dev tool that surfaces per-prompt LLM usage stats next to the chat input. Provides a fast read on cost and cache behavior without leaving the builder.

## Goals

- Show the USD cost of the most recent user prompt.
- Show a sparkline of cost per user message (last 20).
- Show the cache hit rate and cache write tokens for the most recent prompt.
- Be invisible to all users by default; only visible when the switchboard flag is on.

## Non-goals

- BMS budget credits.
- Persistence across reloads.
- Per-tool, per-agent, or per-LLM-call breakdowns in the UI.
- Export, copy, or sharing of stats.

## Architecture

### Switchboard flag

Add `SWITCHBOARD_APPBUILDER_DEBUG_DRAWER` to `app/src/config/switchboard-flags.ts`. The drawer renders nothing when the flag is off.

### Backend (agents)

`agents/src/server/ai-lib-websocket-server.ts` already computes `costEstimate` and cache metrics around line 1236, then logs `websocket.token_usage.tracked`. Immediately after that log call, send a new WebSocket event to the connected client containing the same data. One event is emitted per LLM call.

Server-side opt-in env flag `DEBUG_STATS_EVENTS=true` controls whether the event is emitted at all. Off by default in production. The frontend switchboard flag controls visibility; the env flag controls whether the data leaves the server.

Event type:

```ts
type DebugTurnStatsEvent = {
  type: 'debug_turn_stats'
  conversationId: string
  agentName: string
  modelName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  cacheHitRate: number          // 0..1
  contextWindowUtilization: number
  costUsd: number
  timestamp: string             // ISO
}
```

The type lives in the shared WS event types package (alongside other agent→client events).

### Frontend

A new `DebugStatsContext` provider holds:

```ts
type TurnStats = {
  costUsd: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  cacheHitRate: number          // recomputed at seal time
  modelName: string
  conversationId: string
  sealedAt: string
}

type State = {
  inFlight: Partial<TurnStats> | null
  history: TurnStats[]          // ring buffer, newest last, max 20
}
```

Actions:

- `LLM_CALL(event)` — accumulates one `DebugTurnStatsEvent` into `inFlight`. Sums `costUsd`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheWriteInputTokens`. Tracks the latest `modelName`, `conversationId`.
- `USER_MESSAGE_SENT()` — fires when the user submits a new prompt. Before recording the new in-flight, seal the previous `inFlight` into `history` (cap at 20, drop oldest). Recompute `cacheHitRate = cachedInputTokens / max(inputTokens, 1)` at seal time.
- `CLEAR()` — empties history and inFlight.

The chat WebSocket client routes `debug_turn_stats` events into `LLM_CALL`. The chat send path dispatches `USER_MESSAGE_SENT` when the user submits.

### Files

New:

- `app/src/app/[market]/develop/components/chat/DebugStatsContext.tsx` — provider + reducer + hook.
- `app/src/app/[market]/develop/components/chat/DebugStatsDrawer.tsx` — drawer UI.

Modified:

- `app/src/config/switchboard-flags.ts` — add new flag constant.
- Shared WS event types — add `DebugTurnStatsEvent`.
- `agents/src/server/ai-lib-websocket-server.ts` — emit WS event after token usage tracking, gated by `DEBUG_STATS_EVENTS`.
- `app/src/app/[market]/develop/components/chat/CollapsibleChatInputSection.tsx` — wrap children with `DebugStatsProvider`; render `<DebugStatsDrawer />` as a sibling positioned to the right of the input.
- WS client dispatcher — route `debug_turn_stats` events into the context.

## UI

### Closed state

A narrow vertical handle (~24px wide) flush against the right edge of the chat input container, with a chevron icon and a subtle accent color. Hover highlights. Click toggles open state. The handle is in the layout flow as a flex sibling, so the chat input shrinks by 24px when the flag is on.

### Open state

Slides out to the right of the input, width ~280px, height matches the chat input section. Sections:

1. **Last prompt** — large USD cost (e.g. `$0.0142`); sub-line `1,234 in / 567 out tokens`; sub-line `model: claude-sonnet-4-5`.
2. **Cost per prompt** — inline SVG sparkline of `history` (oldest left, newest right). Hover shows tooltip with cost and timestamp. Y-axis auto-scales to the max in window.
3. **Cache** — `hit rate: 78%` and `writes: 3,421 tokens`, both for the last sealed prompt.
4. **Footer** — `Clear history` button; conversation id in monospace, truncated middle.

Open/closed state persists to `sessionStorage` keyed by appId so it survives re-renders inside one session, but not across reloads (consistent with the in-memory history).

Uses existing UI primitives in `app/src/components/ui/` for buttons, tooltips, and typography.

## Aggregation rule

Within a single user-message window:

- `costUsd = sum of costUsd across all LLM calls`
- `inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens` — sums
- `cacheHitRate = cachedInputTokens / max(inputTokens, 1)` computed at seal time
- `modelName, conversationId` — last seen wins

If a user submits a new prompt while no LLM calls have arrived for the previous one (e.g., agent error), `inFlight` may be `null` or sparse — seal whatever's there, including a zero-cost entry, so the sparkline reflects reality.

## Testing

### Reducer

- `LLM_CALL` accumulates fields when `inFlight` is null and when partially populated.
- `USER_MESSAGE_SENT` seals `inFlight` to `history`, recomputes `cacheHitRate`, resets `inFlight`.
- Ring buffer caps at 20, drops oldest.
- `CLEAR` empties both.

### Component

- Drawer renders nothing when switchboard flag is off.
- Drawer renders all sections with correct values when flag is on and history has entries.
- Sparkline renders one bar per history entry.
- Empty history shows placeholder (`no data yet`) instead of broken sparkline.

### Backend

- WS event is emitted with expected payload when `DEBUG_STATS_EVENTS=true`.
- WS event is not emitted when the env var is unset or `false`.
- APM tracking and existing logging are unaffected by either branch.
