'use client'

import { createContext, type Dispatch,type ReactNode, useContext, useReducer, useState } from 'react'
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
  open: boolean
  setOpen: (open: boolean) => void
}

const DebugStatsContext = createContext<DebugStatsContextValue | null>(null)

export function DebugStatsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(debugStatsReducer, initialState)
  const [open, setOpen] = useState(false)
  return (
    <DebugStatsContext.Provider value={{ state, dispatch, open, setOpen }}>
      {children}
    </DebugStatsContext.Provider>
  )
}

/**
 * No-op fallback used when a consumer (e.g. ChatInput's debug toggle button)
 * is rendered outside a DebugStatsProvider — typically in unit tests that
 * mount the component in isolation. The toggle button is gated by the
 * switchboard flag, so this fallback is only ever read in test setups
 * where the flag is off; production code paths always run inside the
 * provider mounted by ChatPane.
 */
const noopContextValue: DebugStatsContextValue = {
  state: { inFlight: null, history: [] },
  dispatch: () => undefined,
  open: false,
  setOpen: () => undefined,
}

export function useDebugStats(): DebugStatsContextValue {
  const ctx = useContext(DebugStatsContext)
  return ctx ?? noopContextValue
}
