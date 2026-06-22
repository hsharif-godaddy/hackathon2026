'use client'

import { createContext, type Dispatch,type ReactNode, useContext, useReducer, useState } from 'react'
import type { DebugTurnStatsEvent } from '@airo/shared/chat'

export const MAX_HISTORY = 50

export interface LLMCallRecord {
  agentName: string
  modelName: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  cacheHitRate: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  steps?: number
  timestamp: string
}

export interface DebugStatsState {
  calls: LLMCallRecord[]
}

export type DebugStatsAction =
  | { type: 'LLM_CALL'; event: DebugTurnStatsEvent }
  | { type: 'CLEAR' }

const initialState: DebugStatsState = { calls: [] }

export function debugStatsReducer(state: DebugStatsState, action: DebugStatsAction): DebugStatsState {
  switch (action.type) {
    case 'LLM_CALL': {
      const e = action.event
      const record: LLMCallRecord = {
        agentName: e.agentName,
        modelName: e.modelName,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        costUsd: e.costUsd,
        cacheHitRate: e.cacheHitRate,
        cachedInputTokens: e.cachedInputTokens,
        cacheWriteInputTokens: e.cacheWriteInputTokens,
        steps: e.steps,
        timestamp: e.timestamp,
      }
      const calls = [...state.calls, record]
      const trimmed = calls.length > MAX_HISTORY ? calls.slice(calls.length - MAX_HISTORY) : calls
      return { calls: trimmed }
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

const noopContextValue: DebugStatsContextValue = {
  state: { calls: [] },
  dispatch: () => undefined,
  open: false,
  setOpen: () => undefined,
}

export function useDebugStats(): DebugStatsContextValue {
  const ctx = useContext(DebugStatsContext)
  return ctx ?? noopContextValue
}
