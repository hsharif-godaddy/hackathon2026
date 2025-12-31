/**
 * WebSocket Recovery Hook
 *
 * Manages WebSocket connection recovery logic including:
 * - Recovery acknowledgement tracking and sending
 * - Replay event tracking
 * - Recovery state management
 */

import { type MutableRefObject,useCallback, useRef } from 'react'
import type { Socket } from 'socket.io-client'

import { logger } from '@/lib/request-context'

/**
 * Pending recovery acknowledgement tracking
 */
export interface RecoveryAck {
  conversationId: string
  lastSequence: number
  expectedCount: number
  receivedCount: number
  replayComplete: boolean
  ackEvent: 'recovery_ack' | 'catchup_ack'
}

/**
 * Server configuration for timeout synchronization
 */
export interface ServerConfig {
  streamRecoveryWindow: number
  ackTimeout: number
}

export interface UseWebSocketRecoveryReturn {
  /**
   * Ref to track if connection was recovered
   */
  wasRecoveredRef: MutableRefObject<boolean>

  /**
   * Ref to store server configuration
   */
  serverConfigRef: MutableRefObject<ServerConfig | null>

  /**
   * Ref to track pending recovery acknowledgement
   */
  pendingRecoveryAckRef: MutableRefObject<RecoveryAck | null>

  /**
   * Send recovery acknowledgement if conditions are met
   */
  maybeSendRecoveryAck: (socket: Socket | null, force?: boolean) => void

  /**
   * Track receipt of replay events and send ack when complete
   */
  trackReplayEventReceipt: (socket: Socket | null, eventType: string) => void
}

/**
 * Hook for managing WebSocket recovery state and logic
 */
export function useWebSocketRecovery(): UseWebSocketRecoveryReturn {
  const wasRecoveredRef = useRef<boolean>(false)
  const serverConfigRef = useRef<ServerConfig | null>(null)
  const pendingRecoveryAckRef = useRef<RecoveryAck | null>(null)

  /**
   * Send recovery acknowledgement to server if all events have been replayed
   * Called after receiving all buffered events or when forcing acknowledgement
   */
  const maybeSendRecoveryAck = useCallback((socket: Socket | null, force = false) => {
    const pending = pendingRecoveryAckRef.current
    if (!pending || !socket) return
    if (!pending.replayComplete) return

    // Only check counts if not forced - when server says replay is complete, trust it
    if (!force && pending.expectedCount > 0 && pending.receivedCount < pending.expectedCount) {
      return
    }

    socket.emit(pending.ackEvent, {
      conversationId: pending.conversationId,
      lastSequence: pending.lastSequence,
    })
    logger.info('websocket.recovery.ack_sent', {
      conversationId: pending.conversationId,
      lastSequence: pending.lastSequence,
      expectedCount: pending.expectedCount,
      receivedCount: pending.receivedCount,
      forced: force,
    })
    pendingRecoveryAckRef.current = null
  }, [])

  /**
   * Track receipt of replay events and automatically send ack when all received
   * Handles both buffered event replay (recovery_ack) and catchup (catchup_ack)
   */
  const trackReplayEventReceipt = useCallback(
    (socket: Socket | null, eventType: string) => {
      const pending = pendingRecoveryAckRef.current
      if (!pending || !socket) return
      // Skip control messages - these don't count toward replay
      if (
        eventType === 'recovery_status' ||
        eventType === 'replay_complete' ||
        eventType === 'catchup_status' ||
        eventType === 'catchup_complete'
      )
        return

      pending.receivedCount++
      maybeSendRecoveryAck(socket)
    },
    [maybeSendRecoveryAck]
  )

  return {
    wasRecoveredRef,
    serverConfigRef,
    pendingRecoveryAckRef,
    maybeSendRecoveryAck,
    trackReplayEventReceipt,
  }
}
