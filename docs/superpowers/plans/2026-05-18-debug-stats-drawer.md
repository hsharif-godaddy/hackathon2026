# Debug Stats Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a switchboard-gated debug drawer attached to the chat input that shows USD cost of the last prompt, a sparkline of cost-per-prompt over the last 20 user messages, and the cache hit rate / cache write tokens for the last prompt.

**Architecture:** Agents service emits a `debug_turn_stats` Socket.IO event after each LLM call (env-gated by `DEBUG_STATS_EVENTS=true`). The frontend listens via `TransportSupervisor`, dispatches into a `DebugStatsContext` reducer that aggregates per user message into a 20-entry ring buffer. A `DebugStatsDrawer` component renders next to `ChatInput` when `SWITCHBOARD_APPBUILDER_DEBUG_DRAWER` is on.

**Tech Stack:** TypeScript, React, Socket.IO, Vitest, existing `@airo/shared` package, existing `useSwitchboard` hook.

**Spec:** `docs/superpowers/specs/2026-05-18-debug-stats-drawer-design.md`.

---

## File Structure

**Created:**

- `packages/shared/src/websocket/debug-stats.ts` — `DebugTurnStatsEvent` type and event name constant.
- `app/src/app/[market]/develop/components/chat/DebugStatsContext.tsx` — provider, reducer, hook.
- `app/src/app/[market]/develop/components/chat/DebugStatsContext.test.tsx` — reducer tests.
- `app/src/app/[market]/develop/components/chat/DebugStatsDrawer.tsx` — drawer UI.
- `app/src/app/[market]/develop/components/chat/DebugStatsDrawer.test.tsx` — component tests.
- `app/src/app/[market]/develop/components/chat/CostSparkline.tsx` — small SVG sparkline.
- `app/src/app/[market]/develop/components/chat/CostSparkline.test.tsx` — sparkline tests.
- `agents/src/server/__tests__/debug-stats-emit.test.ts` — backend emit test.

**Modified:**

- `packages/shared/src/websocket/index.ts` — re-export new types.
- `app/src/config/switchboard-flags.ts` — add `SWITCHBOARD_APPBUILDER_DEBUG_DRAWER`.
- `agents/src/server/ai-lib-websocket-server.ts` — emit `debug_turn_stats` after `websocket.token_usage.tracked` log (around line 1274).
- `app/src/services/websocket/TransportSupervisor.ts` — listen for `debug_turn_stats` and forward via `emit()`.
- `app/src/app/[market]/develop/components/chat/ChatPane.tsx` — wrap chat input area with `DebugStatsProvider`, render `<DebugStatsDrawer />` next to `<ChatInput />`, and dispatch `USER_MESSAGE_SENT` from `handleSendMessage`.

---

## Task 1: Shared WebSocket event type

**Files:**
- Create: `packages/shared/src/websocket/debug-stats.ts`
- Modify: `packages/shared/src/websocket/index.ts`

- [ ] **Step 1: Create the event type file**

```ts
// packages/shared/src/websocket/debug-stats.ts
/**
 * Per-LLM-call debug stats emitted by the agents service when
 * DEBUG_STATS_EVENTS=true. Consumed by the frontend Debug Stats Drawer.
 */

export const DEBUG_TURN_STATS_EVENT = 'debug_turn_stats' as const

export interface DebugTurnStatsEvent {
  type: typeof DEBUG_TURN_STATS_EVENT
  conversationId: string
  agentName: string
  modelName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  cacheHitRate: number
  contextWindowUtilization: number
  costUsd: number
  timestamp: string
}
```

- [ ] **Step 2: Re-export from index**

Add to `packages/shared/src/websocket/index.ts`:

```ts
export { DEBUG_TURN_STATS_EVENT } from './debug-stats.js'
export type { DebugTurnStatsEvent } from './debug-stats.js'
```

- [ ] **Step 3: Verify build of @airo/shared**

Run: `pnpm --filter @airo/shared build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/websocket/debug-stats.ts packages/shared/src/websocket/index.ts
git commit -m "feat(shared): add DebugTurnStatsEvent WebSocket type"
```

---

## Task 2: Switchboard flag constant

**Files:**
- Modify: `app/src/config/switchboard-flags.ts`

- [ ] **Step 1: Add the constant**

Append in `app/src/config/switchboard-flags.ts`:

```ts
export const SWITCHBOARD_APPBUILDER_DEBUG_DRAWER = 'appbuilder-debug-drawer';
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/src/config/switchboard-flags.ts
git commit -m "feat(app): add SWITCHBOARD_APPBUILDER_DEBUG_DRAWER flag"
```

---

## Task 3: Backend — emit `debug_turn_stats` event

**Files:**
- Modify: `agents/src/server/ai-lib-websocket-server.ts:1274` (after `websocket.token_usage.tracked` log)
- Create: `agents/src/server/__tests__/debug-stats-emit.test.ts`

The existing `onTokenUsageTracked` callback in `ai-lib-websocket-server.ts` already computes `costEstimate.totalCost`, `cacheMetrics.cacheHitRate`, and `contextUtilization`. We append an `emitToApp` call gated by `DEBUG_STATS_EVENTS`.

- [ ] **Step 1: Write the failing test**

Create `agents/src/server/__tests__/debug-stats-emit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const emitToAppMock = vi.fn()
vi.mock('../ai-lib-websocket-server.js', async () => {
  const actual = await vi.importActual<typeof import('../ai-lib-websocket-server.js')>(
    '../ai-lib-websocket-server.js'
  )
  return { ...actual, emitToApp: emitToAppMock }
})

import { maybeEmitDebugTurnStats } from '../debug-stats-emit.js'

describe('maybeEmitDebugTurnStats', () => {
  beforeEach(() => {
    emitToAppMock.mockClear()
  })

  afterEach(() => {
    delete process.env.DEBUG_STATS_EVENTS
  })

  it('emits when DEBUG_STATS_EVENTS=true', () => {
    process.env.DEBUG_STATS_EVENTS = 'true'

    maybeEmitDebugTurnStats({
      appId: 'app-1',
      conversationId: 'conv-1',
      agentName: 'main_agent',
      modelName: 'claude-sonnet-4-5',
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      cachedInputTokens: 700,
      cacheWriteInputTokens: 300,
      cacheHitRate: 0.7,
      contextWindowUtilization: 0.1,
      costUsd: 0.0042,
    })

    expect(emitToAppMock).toHaveBeenCalledTimes(1)
    expect(emitToAppMock).toHaveBeenCalledWith(
      'app-1',
      'debug_turn_stats',
      expect.objectContaining({
        type: 'debug_turn_stats',
        conversationId: 'conv-1',
        modelName: 'claude-sonnet-4-5',
        costUsd: 0.0042,
        cachedInputTokens: 700,
        cacheWriteInputTokens: 300,
        cacheHitRate: 0.7,
      })
    )
  })

  it('does not emit when DEBUG_STATS_EVENTS is unset', () => {
    delete process.env.DEBUG_STATS_EVENTS

    maybeEmitDebugTurnStats({
      appId: 'app-1',
      conversationId: 'conv-1',
      agentName: 'main_agent',
      modelName: 'claude-sonnet-4-5',
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      cacheHitRate: 0,
      contextWindowUtilization: 0,
      costUsd: 0,
    })

    expect(emitToAppMock).not.toHaveBeenCalled()
  })

  it('does not emit when appId is missing', () => {
    process.env.DEBUG_STATS_EVENTS = 'true'

    maybeEmitDebugTurnStats({
      appId: '',
      conversationId: 'conv-1',
      agentName: 'main_agent',
      modelName: 'claude-sonnet-4-5',
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      cacheHitRate: 0,
      contextWindowUtilization: 0,
      costUsd: 0,
    })

    expect(emitToAppMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @airo/agents test:unit debug-stats-emit`
Expected: FAIL with "Cannot find module '../debug-stats-emit.js'".

- [ ] **Step 3: Create the helper module**

Create `agents/src/server/debug-stats-emit.ts`:

```ts
import { DEBUG_TURN_STATS_EVENT, type DebugTurnStatsEvent } from '@airo/shared/websocket'
import { emitToApp } from './ai-lib-websocket-server.js'

export interface MaybeEmitDebugTurnStatsArgs {
  appId: string
  conversationId: string
  agentName: string
  modelName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  cacheHitRate: number
  contextWindowUtilization: number
  costUsd: number
}

export function maybeEmitDebugTurnStats(args: MaybeEmitDebugTurnStatsArgs): void {
  if (process.env.DEBUG_STATS_EVENTS !== 'true') return
  if (!args.appId) return

  const payload: DebugTurnStatsEvent = {
    type: DEBUG_TURN_STATS_EVENT,
    conversationId: args.conversationId,
    agentName: args.agentName,
    modelName: args.modelName,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    totalTokens: args.totalTokens,
    cachedInputTokens: args.cachedInputTokens,
    cacheWriteInputTokens: args.cacheWriteInputTokens,
    cacheHitRate: args.cacheHitRate,
    contextWindowUtilization: args.contextWindowUtilization,
    costUsd: args.costUsd,
    timestamp: new Date().toISOString(),
  }

  emitToApp(args.appId, DEBUG_TURN_STATS_EVENT, payload)
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @airo/agents test:unit debug-stats-emit`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Wire it into the websocket server**

In `agents/src/server/ai-lib-websocket-server.ts`, add to the imports near the top of the file:

```ts
import { maybeEmitDebugTurnStats } from './debug-stats-emit.js'
```

Then, immediately after the existing `logger.info('websocket.token_usage.tracked', { ... })` call (currently around line 1274–1289), insert:

```ts
          maybeEmitDebugTurnStats({
            appId: metadata.appId,
            conversationId: typeof metadata.conversationId === 'string' ? metadata.conversationId : 'unknown',
            agentName: metadata.agentName,
            modelName: metadata.modelName,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.cachedInputTokens || 0,
            cacheWriteInputTokens: usage.cacheWriteInputTokens || 0,
            cacheHitRate: cacheMetrics.cacheHitRate,
            contextWindowUtilization: contextUtilization,
            costUsd: costEstimate.totalCost,
          })
```

- [ ] **Step 6: Verify agents typecheck and tests**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents test:unit debug-stats-emit`
Expected: typecheck PASS, all 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add agents/src/server/debug-stats-emit.ts agents/src/server/__tests__/debug-stats-emit.test.ts agents/src/server/ai-lib-websocket-server.ts
git commit -m "feat(agents): emit debug_turn_stats WS event when DEBUG_STATS_EVENTS=true"
```

---

## Task 4: Frontend — `DebugStatsContext` reducer

**Files:**
- Create: `app/src/app/[market]/develop/components/chat/DebugStatsContext.tsx`
- Test: `app/src/app/[market]/develop/components/chat/DebugStatsContext.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `app/src/app/[market]/develop/components/chat/DebugStatsContext.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import type { DebugTurnStatsEvent } from '@airo/shared/websocket'
import { debugStatsReducer, type DebugStatsState, MAX_HISTORY } from './DebugStatsContext'

const baseEvent: DebugTurnStatsEvent = {
  type: 'debug_turn_stats',
  conversationId: 'conv-1',
  agentName: 'main_agent',
  modelName: 'claude-sonnet-4-5',
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  cachedInputTokens: 60,
  cacheWriteInputTokens: 40,
  cacheHitRate: 0.6,
  contextWindowUtilization: 0.1,
  costUsd: 0.0010,
  timestamp: '2026-05-18T12:00:00.000Z',
}

const empty: DebugStatsState = { inFlight: null, history: [] }

describe('debugStatsReducer', () => {
  it('LLM_CALL accumulates into a fresh inFlight when null', () => {
    const next = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    expect(next.inFlight).toEqual({
      costUsd: 0.001,
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 40,
      modelName: 'claude-sonnet-4-5',
      conversationId: 'conv-1',
    })
    expect(next.history).toEqual([])
  })

  it('LLM_CALL accumulates additively into an existing inFlight', () => {
    const after1 = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    const after2 = debugStatsReducer(after1, {
      type: 'LLM_CALL',
      event: { ...baseEvent, inputTokens: 200, outputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, costUsd: 0.002 },
    })
    expect(after2.inFlight).toEqual({
      costUsd: 0.003,
      inputTokens: 300,
      outputTokens: 150,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 40,
      modelName: 'claude-sonnet-4-5',
      conversationId: 'conv-1',
    })
  })

  it('USER_MESSAGE_SENT seals inFlight, recomputes cacheHitRate, resets inFlight', () => {
    const accumulating = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    const sealed = debugStatsReducer(accumulating, { type: 'USER_MESSAGE_SENT', sealedAt: '2026-05-18T12:01:00.000Z' })
    expect(sealed.inFlight).toBeNull()
    expect(sealed.history).toHaveLength(1)
    expect(sealed.history[0]).toMatchObject({
      costUsd: 0.001,
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 40,
      cacheHitRate: 0.6,
      modelName: 'claude-sonnet-4-5',
      conversationId: 'conv-1',
      sealedAt: '2026-05-18T12:01:00.000Z',
    })
  })

  it('USER_MESSAGE_SENT with no inFlight is a no-op', () => {
    const next = debugStatsReducer(empty, { type: 'USER_MESSAGE_SENT', sealedAt: 't' })
    expect(next).toEqual(empty)
  })

  it('cacheHitRate is 0 when inputTokens is 0', () => {
    const accumulating = debugStatsReducer(empty, {
      type: 'LLM_CALL',
      event: { ...baseEvent, inputTokens: 0, cachedInputTokens: 0 },
    })
    const sealed = debugStatsReducer(accumulating, { type: 'USER_MESSAGE_SENT', sealedAt: 't' })
    expect(sealed.history[0].cacheHitRate).toBe(0)
  })

  it('history caps at MAX_HISTORY, oldest dropped', () => {
    let s: DebugStatsState = empty
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      s = debugStatsReducer(s, { type: 'LLM_CALL', event: { ...baseEvent, costUsd: i } })
      s = debugStatsReducer(s, { type: 'USER_MESSAGE_SENT', sealedAt: `t-${i}` })
    }
    expect(s.history).toHaveLength(MAX_HISTORY)
    expect(s.history[0].costUsd).toBe(5)
    expect(s.history[MAX_HISTORY - 1].costUsd).toBe(MAX_HISTORY + 4)
  })

  it('CLEAR resets state', () => {
    const accumulating = debugStatsReducer(empty, { type: 'LLM_CALL', event: baseEvent })
    const sealed = debugStatsReducer(accumulating, { type: 'USER_MESSAGE_SENT', sealedAt: 't' })
    const cleared = debugStatsReducer(sealed, { type: 'CLEAR' })
    expect(cleared).toEqual(empty)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter website test DebugStatsContext`
Expected: FAIL with "Cannot find module './DebugStatsContext'".

- [ ] **Step 3: Implement the module**

Create `app/src/app/[market]/develop/components/chat/DebugStatsContext.tsx`:

```tsx
'use client'

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react'
import type { DebugTurnStatsEvent } from '@airo/shared/websocket'

export const MAX_HISTORY = 20

export interface SealedTurnStats {
  costUsd: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  cacheHitRate: number
  modelName: string
  conversationId: string
  sealedAt: string
}

export interface InFlightStats {
  costUsd: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  modelName: string
  conversationId: string
}

export interface DebugStatsState {
  inFlight: InFlightStats | null
  history: SealedTurnStats[]
}

export type DebugStatsAction =
  | { type: 'LLM_CALL'; event: DebugTurnStatsEvent }
  | { type: 'USER_MESSAGE_SENT'; sealedAt: string }
  | { type: 'CLEAR' }

const initialState: DebugStatsState = { inFlight: null, history: [] }

export function debugStatsReducer(state: DebugStatsState, action: DebugStatsAction): DebugStatsState {
  switch (action.type) {
    case 'LLM_CALL': {
      const e = action.event
      const prev = state.inFlight
      const next: InFlightStats = {
        costUsd: (prev?.costUsd ?? 0) + e.costUsd,
        inputTokens: (prev?.inputTokens ?? 0) + e.inputTokens,
        outputTokens: (prev?.outputTokens ?? 0) + e.outputTokens,
        cachedInputTokens: (prev?.cachedInputTokens ?? 0) + e.cachedInputTokens,
        cacheWriteInputTokens: (prev?.cacheWriteInputTokens ?? 0) + e.cacheWriteInputTokens,
        modelName: e.modelName,
        conversationId: e.conversationId,
      }
      return { ...state, inFlight: next }
    }
    case 'USER_MESSAGE_SENT': {
      if (!state.inFlight) return state
      const f = state.inFlight
      const cacheHitRate = f.inputTokens > 0 ? f.cachedInputTokens / f.inputTokens : 0
      const sealed: SealedTurnStats = {
        costUsd: f.costUsd,
        inputTokens: f.inputTokens,
        outputTokens: f.outputTokens,
        cachedInputTokens: f.cachedInputTokens,
        cacheWriteInputTokens: f.cacheWriteInputTokens,
        cacheHitRate,
        modelName: f.modelName,
        conversationId: f.conversationId,
        sealedAt: action.sealedAt,
      }
      const history = [...state.history, sealed]
      const trimmed = history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history
      return { inFlight: null, history: trimmed }
    }
    case 'CLEAR':
      return initialState
  }
}

interface DebugStatsContextValue {
  state: DebugStatsState
  dispatch: Dispatch<DebugStatsAction>
}

const DebugStatsContext = createContext<DebugStatsContextValue | null>(null)

export function DebugStatsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(debugStatsReducer, initialState)
  return <DebugStatsContext.Provider value={{ state, dispatch }}>{children}</DebugStatsContext.Provider>
}

export function useDebugStats(): DebugStatsContextValue {
  const ctx = useContext(DebugStatsContext)
  if (!ctx) throw new Error('useDebugStats must be used within DebugStatsProvider')
  return ctx
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter website test DebugStatsContext`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[market]/develop/components/chat/DebugStatsContext.tsx app/src/app/[market]/develop/components/chat/DebugStatsContext.test.tsx
git commit -m "feat(app): add DebugStatsContext reducer for chat debug drawer"
```

---

## Task 5: Frontend — `CostSparkline` component

**Files:**
- Create: `app/src/app/[market]/develop/components/chat/CostSparkline.tsx`
- Test: `app/src/app/[market]/develop/components/chat/CostSparkline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/app/[market]/develop/components/chat/CostSparkline.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CostSparkline from './CostSparkline'

describe('CostSparkline', () => {
  it('renders placeholder when values is empty', () => {
    render(<CostSparkline values={[]} />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  it('renders one bar per value', () => {
    const { container } = render(<CostSparkline values={[0.001, 0.002, 0.003]} />)
    expect(container.querySelectorAll('rect[data-testid="cost-sparkline-bar"]')).toHaveLength(3)
  })

  it('scales bars relative to max', () => {
    const { container } = render(<CostSparkline values={[1, 2, 4]} />)
    const bars = container.querySelectorAll('rect[data-testid="cost-sparkline-bar"]')
    const heights = Array.from(bars).map((b) => Number(b.getAttribute('height')))
    expect(heights[2]).toBeGreaterThan(heights[1])
    expect(heights[1]).toBeGreaterThan(heights[0])
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter website test CostSparkline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `app/src/app/[market]/develop/components/chat/CostSparkline.tsx`:

```tsx
'use client'

import { type ReactElement } from 'react'

interface CostSparklineProps {
  values: number[]
  width?: number
  height?: number
}

export default function CostSparkline({
  values,
  width = 240,
  height = 40,
}: CostSparklineProps): ReactElement {
  if (values.length === 0) {
    return <div className="text-xs text-muted-foreground">no data yet</div>
  }

  const max = Math.max(...values, 0.0000001)
  const barGap = 2
  const barWidth = Math.max(1, (width - barGap * (values.length - 1)) / values.length)

  return (
    <svg width={width} height={height} role="img" aria-label="cost per prompt">
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * height)
        const x = i * (barWidth + barGap)
        const y = height - h
        return (
          <rect
            key={i}
            data-testid="cost-sparkline-bar"
            x={x}
            y={y}
            width={barWidth}
            height={h}
            className="fill-current text-primary"
          >
            <title>{`$${v.toFixed(4)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter website test CostSparkline`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[market]/develop/components/chat/CostSparkline.tsx app/src/app/[market]/develop/components/chat/CostSparkline.test.tsx
git commit -m "feat(app): add CostSparkline component"
```

---

## Task 6: Frontend — `DebugStatsDrawer` component

**Files:**
- Create: `app/src/app/[market]/develop/components/chat/DebugStatsDrawer.tsx`
- Test: `app/src/app/[market]/develop/components/chat/DebugStatsDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/app/[market]/develop/components/chat/DebugStatsDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DebugStatsDrawer from './DebugStatsDrawer'
import { DebugStatsProvider, useDebugStats } from './DebugStatsContext'
import { useEffect } from 'react'

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}))
import { useSwitchboard } from '@/hooks/useSwitchboard'

function Seed({ withHistory = false }: { withHistory?: boolean }) {
  const { dispatch } = useDebugStats()
  useEffect(() => {
    if (!withHistory) return
    dispatch({
      type: 'LLM_CALL',
      event: {
        type: 'debug_turn_stats',
        conversationId: 'c1',
        agentName: 'main_agent',
        modelName: 'claude-sonnet-4-5',
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        cachedInputTokens: 700,
        cacheWriteInputTokens: 50,
        cacheHitRate: 0.7,
        contextWindowUtilization: 0.1,
        costUsd: 0.0042,
        timestamp: '2026-05-18T12:00:00.000Z',
      },
    })
    dispatch({ type: 'USER_MESSAGE_SENT', sealedAt: '2026-05-18T12:00:01.000Z' })
  }, [dispatch, withHistory])
  return null
}

describe('DebugStatsDrawer', () => {
  it('renders nothing when switchboard flag is off', () => {
    vi.mocked(useSwitchboard).mockReturnValue(false)
    const { container } = render(
      <DebugStatsProvider>
        <DebugStatsDrawer />
      </DebugStatsProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the closed handle when flag is on', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(
      <DebugStatsProvider>
        <DebugStatsDrawer />
      </DebugStatsProvider>
    )
    expect(screen.getByRole('button', { name: /toggle debug stats/i })).toBeInTheDocument()
    expect(screen.queryByText(/last prompt/i)).not.toBeInTheDocument()
  })

  it('opens panel and shows stats from history', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(
      <DebugStatsProvider>
        <Seed withHistory />
        <DebugStatsDrawer />
      </DebugStatsProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /toggle debug stats/i }))
    expect(screen.getByText('$0.0042')).toBeInTheDocument()
    expect(screen.getByText(/1000 in \/ 200 out/)).toBeInTheDocument()
    expect(screen.getByText(/70%/)).toBeInTheDocument()
    expect(screen.getByText(/50/)).toBeInTheDocument()
  })

  it('shows placeholder when history is empty', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(
      <DebugStatsProvider>
        <DebugStatsDrawer />
      </DebugStatsProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /toggle debug stats/i }))
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  it('CLEAR button resets history', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(
      <DebugStatsProvider>
        <Seed withHistory />
        <DebugStatsDrawer />
      </DebugStatsProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /toggle debug stats/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear history/i }))
    expect(screen.queryByText('$0.0042')).not.toBeInTheDocument()
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter website test DebugStatsDrawer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the drawer**

Create `app/src/app/[market]/develop/components/chat/DebugStatsDrawer.tsx`:

```tsx
'use client'

import { useState, type ReactElement } from 'react'
import ChevronLeft from '@ux/icon/chevron-left'
import ChevronRight from '@ux/icon/chevron-right'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { SWITCHBOARD_APPBUILDER_DEBUG_DRAWER } from '@/config/switchboard-flags'
import { useDebugStats } from './DebugStatsContext'
import CostSparkline from './CostSparkline'

export default function DebugStatsDrawer(): ReactElement | null {
  const enabled = useSwitchboard(SWITCHBOARD_APPBUILDER_DEBUG_DRAWER)
  const { state, dispatch } = useDebugStats()
  const [open, setOpen] = useState(false)

  if (!enabled) return null

  const last = state.history[state.history.length - 1]
  const sparkValues = state.history.map((h) => h.costUsd)
  const truncate = (s: string): string => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s)

  return (
    <div className="flex items-stretch" data-testid="debug-stats-drawer">
      <button
        type="button"
        aria-label="Toggle debug stats"
        className="w-6 flex items-center justify-center border-l border-border bg-muted/40 hover:bg-muted text-muted-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronRight /> : <ChevronLeft />}
      </button>
      {open && (
        <div className="w-[280px] p-3 border-l border-border bg-background text-sm space-y-3 overflow-auto">
          <section>
            <div className="text-xs text-muted-foreground">Last prompt</div>
            {last ? (
              <>
                <div className="text-2xl font-semibold tabular-nums">${last.costUsd.toFixed(4)}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {last.inputTokens} in / {last.outputTokens} out tokens
                </div>
                <div className="text-xs text-muted-foreground">model: {last.modelName}</div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">no data yet</div>
            )}
          </section>

          <section>
            <div className="text-xs text-muted-foreground mb-1">Cost per prompt</div>
            <CostSparkline values={sparkValues} />
          </section>

          <section>
            <div className="text-xs text-muted-foreground">Cache</div>
            {last ? (
              <div className="text-xs tabular-nums">
                hit rate: {Math.round(last.cacheHitRate * 100)}% · writes: {last.cacheWriteInputTokens} tokens
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">no data yet</div>
            )}
          </section>

          <footer className="flex items-center justify-between pt-2 border-t border-border">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => dispatch({ type: 'CLEAR' })}
            >
              Clear history
            </button>
            {last && (
              <span className="text-[10px] font-mono text-muted-foreground">{truncate(last.conversationId)}</span>
            )}
          </footer>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter website test DebugStatsDrawer`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[market]/develop/components/chat/DebugStatsDrawer.tsx app/src/app/[market]/develop/components/chat/DebugStatsDrawer.test.tsx
git commit -m "feat(app): add DebugStatsDrawer component"
```

---

## Task 7: Frontend — wire WS event into the context

The `TransportSupervisor` registers handlers per Socket.IO event and re-emits via its own `EventEmitter`. We add a new event `debug:turn-stats` and expose a hook that subscribes a `DebugStatsProvider` consumer to it.

**Files:**
- Modify: `app/src/services/websocket/TransportSupervisor.ts` (around line 478, alongside other `socket.on(...)` handlers)
- Create: `app/src/app/[market]/develop/components/chat/useDebugStatsBridge.ts`

- [ ] **Step 1: Add the socket handler**

In `app/src/services/websocket/TransportSupervisor.ts`, add the import near the top:

```ts
import { DEBUG_TURN_STATS_EVENT, type DebugTurnStatsEvent } from '@airo/shared/websocket'
```

Then inside `attachListeners` (next to the `oauth:result` handler around line 471–477), add:

```ts
    socket.on(DEBUG_TURN_STATS_EVENT, (data: DebugTurnStatsEvent) => {
      this.emit('debug:turn-stats', data)
    })
```

- [ ] **Step 2: Create the bridge hook**

Create `app/src/app/[market]/develop/components/chat/useDebugStatsBridge.ts`:

```ts
'use client'

import { useEffect } from 'react'
import type { DebugTurnStatsEvent } from '@airo/shared/websocket'
import { getTransportSupervisor } from '@/services/websocket/TransportSupervisor'
import { useDebugStats } from './DebugStatsContext'

/**
 * Subscribes to debug:turn-stats from the WebSocket transport and dispatches
 * into the DebugStatsContext reducer. Caller must be inside DebugStatsProvider.
 */
export function useDebugStatsBridge(): void {
  const { dispatch } = useDebugStats()

  useEffect(() => {
    const supervisor = getTransportSupervisor()
    if (!supervisor) return
    const handler = (event: DebugTurnStatsEvent): void => {
      dispatch({ type: 'LLM_CALL', event })
    }
    supervisor.on('debug:turn-stats', handler)
    return () => {
      supervisor.off('debug:turn-stats', handler)
    }
  }, [dispatch])
}
```

If `getTransportSupervisor` does not already exist, locate the existing accessor used elsewhere (search `TransportSupervisor` consumers in `app/src`) and use the same pattern. If only an instance is exposed via a hook, replace `getTransportSupervisor()` with that hook call.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter website typecheck && pnpm --filter @airo/agents typecheck`
Expected: PASS in both.

- [ ] **Step 4: Commit**

```bash
git add app/src/services/websocket/TransportSupervisor.ts app/src/app/[market]/develop/components/chat/useDebugStatsBridge.ts
git commit -m "feat(app): forward debug_turn_stats events into DebugStatsContext"
```

---

## Task 8: Frontend — integrate into `ChatPane`

**Files:**
- Modify: `app/src/app/[market]/develop/components/chat/ChatPane.tsx`

- [ ] **Step 1: Wrap chat input area in `DebugStatsProvider`**

Find the outer container that wraps the two `<ChatInput>` render sites (`ChatPane.tsx:1283` and `ChatPane.tsx:1387`). It's the same component instance rendered conditionally. Identify the smallest enclosing element that contains the chat-input area but not the rest of the page. Wrap that element with:

```tsx
<DebugStatsProvider>
  {/* existing children */}
</DebugStatsProvider>
```

Add the import at the top of the file:

```tsx
import { DebugStatsProvider } from '@/app/[market]/develop/components/chat/DebugStatsContext'
import DebugStatsDrawer from '@/app/[market]/develop/components/chat/DebugStatsDrawer'
import { useDebugStatsBridge } from '@/app/[market]/develop/components/chat/useDebugStatsBridge'
```

- [ ] **Step 2: Render `<DebugStatsDrawer />` next to `<ChatInput>`**

For each of the two `<ChatInput .../>` JSX sites in `ChatPane.tsx` (around lines 1283 and 1387), wrap the `<ChatInput>` element in a horizontal flex container so the drawer sits on its right edge. Example transformation for the first site:

```tsx
<div className="flex items-stretch">
  <div className="flex-1 min-w-0">
    <ChatInput
      // ...existing props unchanged
    />
  </div>
  <DebugStatsDrawer />
</div>
```

Apply the same wrapping at the second `<ChatInput>` site. Do not change any `<ChatInput>` props.

- [ ] **Step 3: Mount the WS bridge once**

Inside the component body of `ChatPane` (top-level, not nested in a conditional), add:

```tsx
useDebugStatsBridge()
```

This must be inside the subtree wrapped by `DebugStatsProvider`. If `ChatPane` is itself the wrapper, extract a small inner component:

```tsx
function ChatPaneInner(/* same props */) {
  useDebugStatsBridge()
  return (/* existing JSX */)
}

export default function ChatPane(props: ChatPaneProps) {
  return (
    <DebugStatsProvider>
      <ChatPaneInner {...props} />
    </DebugStatsProvider>
  )
}
```

If the existing default export structure differs, adapt: the only requirement is that `useDebugStatsBridge` runs inside `DebugStatsProvider`.

- [ ] **Step 4: Dispatch `USER_MESSAGE_SENT` on send**

`handleSendMessage` is defined at `ChatPane.tsx:755`. Inside `ChatPaneInner`, obtain dispatch:

```tsx
import { useDebugStats } from '@/app/[market]/develop/components/chat/DebugStatsContext'
// ...
const { dispatch: debugStatsDispatch } = useDebugStats()
```

At the top of `handleSendMessage`, before any other side effects, add:

```ts
debugStatsDispatch({ type: 'USER_MESSAGE_SENT', sealedAt: new Date().toISOString() })
```

Add `debugStatsDispatch` to the `useCallback` deps array for `handleSendMessage`.

- [ ] **Step 5: Verify typecheck and lint**

Run: `pnpm --filter website typecheck && pnpm --filter website lint`
Expected: PASS.

- [ ] **Step 6: Verify existing chat tests still pass**

Run: `pnpm --filter website test ChatPane && pnpm --filter website test ChatInput`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/[market]/develop/components/chat/ChatPane.tsx
git commit -m "feat(app): mount DebugStatsDrawer alongside ChatInput"
```

---

## Task 9: Full validation

- [ ] **Step 1: Build all**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Run new tests**

Run:
```bash
pnpm --filter @airo/agents test:unit debug-stats-emit
pnpm --filter website test DebugStatsContext
pnpm --filter website test CostSparkline
pnpm --filter website test DebugStatsDrawer
```
Expected: all PASS.

- [ ] **Step 4: Manual smoke (local)**

  1. Set `DEBUG_STATS_EVENTS=true` in `agents/.env`.
  2. Toggle `appbuilder-debug-drawer` on in the local Switchboard mock for your user.
  3. `pnpm run local:test` (grants/billing path), open the builder, send a chat message.
  4. Click the chevron handle to open the drawer; verify cost, sparkline bar, cache hit rate, and cache writes appear after the response.

- [ ] **Step 5: Confirm flag-off behavior**

  1. Toggle the switchboard flag off.
  2. Reload the builder; confirm no handle is rendered and the chat input occupies its full width.

---

## Self-Review Notes

- Spec coverage: switchboard flag (Task 2), backend env-gated emit (Task 3), shared event type (Task 1), reducer with ring buffer + cacheHitRate seal (Task 4), sparkline (Task 5), drawer with all four sections (Task 6), WS subscription (Task 7), integration with ChatPane and USER_MESSAGE_SENT dispatch (Task 8).
- Names consistent across tasks: `SWITCHBOARD_APPBUILDER_DEBUG_DRAWER`, `DEBUG_TURN_STATS_EVENT`, `DebugTurnStatsEvent`, `DebugStatsProvider`, `useDebugStats`, `useDebugStatsBridge`, `DebugStatsDrawer`, `CostSparkline`, `MAX_HISTORY`, `debugStatsReducer`.
- Open dependency: `getTransportSupervisor` accessor — Task 7 instructs the executor to substitute the actual accessor pattern used in the codebase if a function form is not available.
- Persistence to `sessionStorage` for open/closed state was discussed in the spec but is intentionally deferred from this plan (YAGNI for first pass) — `useState` default of closed is fine. Add a follow-up task only if requested.
