/**
 * WebSocket Retry Hook
 *
 * Manages retry state for APP_NOT_FOUND errors that occur during app registration.
 * Handles exponential backoff retry logic for transient errors.
 */

import { type MutableRefObject,useCallback, useRef } from 'react'

import type { AgentsAppChatMessage } from '@/types/websocket-context'

export interface RetryState {
  pendingMessage?: { chatMessage: AgentsAppChatMessage; startTime: number }
  retryCount: number
  retryTimer?: NodeJS.Timeout
}

export interface UseWebSocketRetryReturn {
  /**
   * Ref to track retry state
   */
  retryStateRef: MutableRefObject<RetryState>

  /**
   * Clear retry timer and reset retry state
   */
  clearRetryState: () => void
}

/**
 * Hook for managing WebSocket retry state and logic
 */
export function useWebSocketRetry(): UseWebSocketRetryReturn {
  const retryStateRef = useRef<RetryState>({ retryCount: 0 })

  /**
   * Helper function to clear retry timer and reset retry state
   * Extracted to avoid duplication across multiple cleanup locations
   */
  const clearRetryState = useCallback(() => {
    if (retryStateRef.current.retryTimer) {
      clearTimeout(retryStateRef.current.retryTimer)
    }
    retryStateRef.current = { retryCount: 0 }
  }, [])

  return {
    retryStateRef,
    clearRetryState,
  }
}
