'use client'

import { useEffect } from 'react'
import type { DebugTurnStatsEvent } from '@airo/shared/websocket'

import { useDebugStats } from './DebugStatsContext'

/**
 * Subscribes to the airo:debug-turn-stats window CustomEvent (dispatched by
 * TransportSupervisor on debug_turn_stats Socket.IO events) and forwards each
 * event into the DebugStatsContext reducer. Caller must be inside DebugStatsProvider.
 */
export function useDebugStatsBridge(): void {
  const { dispatch } = useDebugStats()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: Event): void => {
      const event = (e as CustomEvent<DebugTurnStatsEvent>).detail
      if (!event) return
      dispatch({ type: 'LLM_CALL', event })
    }
    window.addEventListener('airo:debug-turn-stats', handler)
    return () => {
      window.removeEventListener('airo:debug-turn-stats', handler)
    }
  }, [dispatch])
}
