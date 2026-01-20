/**
 * WebSocket Message Handler Types
 *
 * Defines interfaces for the message handler registry pattern.
 * Enables clean separation of message handling logic into focused handler classes.
 */

import type { MutableRefObject } from 'react'
import type { Socket } from 'socket.io-client'

import type { ServerConfig, WebSocketActor } from '@/services/websocket/stateMachineTypes'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { StructuredError } from '@/types/errors'

/**
 * WebSocket message format from server
 */
export interface WebSocketMessage {
  type: string
  content: string
  data?: Record<string, unknown>
}

// Re-export ServerConfig for backward compatibility
export type { ServerConfig }

/**
 * Recovery control message types - these are protocol messages that shouldn't be counted
 * as replay events during recovery.
 */
export const RECOVERY_CONTROL_MESSAGE_TYPES = [
  'recovery_status',
  'replay_complete',
  'catchup_status',
  'catchup_complete',
  'history_message',
  'history_complete',
] as const;

export type RecoveryControlMessageType = typeof RECOVERY_CONTROL_MESSAGE_TYPES[number];

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
 * WebSocket state update
 */
export interface WebSocketStateUpdate {
  connected?: boolean
  status?: 'idle' | 'streaming' | 'connecting' | 'error'
  error?: StructuredError
}

/**
 * Stream finalization data
 */
export interface FinalizeStreamData {
  agentId?: string
  usage?: unknown
  totalSteps?: number
}

/**
 * Actions available to message handlers
 * These are the hook actions that handlers can call to update state
 */
export interface MessageHandlerActions {
  setWebSocketState: (state: WebSocketStateUpdate) => void
  setStreamingState: (state: string) => void
  setIsLoading: (loading: boolean) => void
  startNewStream: (content: string) => void
  appendTextSegment: (content: string) => void
  addToolStartSegment: (toolCall: ToolCall) => void
  addToolCallSegment: (toolCall: ToolCall) => void
  addToolResultSegment: (toolCall: ToolCall) => void
  markMaxStepsReached: () => void
  markUpstreamError: (error: StructuredError) => void
  markBudgetExceeded: () => void
  finalizeStream: (data?: FinalizeStreamData) => void
  flushToolDeltaBufferImmediate: () => void
  scheduleToolDeltaFlush: () => void
}

/**
 * Helper functions available to message handlers
 */
export interface MessageHandlerHelpers {
  maybeSendRecoveryAck: (socket: Socket | null, force?: boolean) => void
  trackReplayEventReceipt: (socket: Socket | null, eventType: string) => void
  clearStoredSocketId: () => void
  handleCommitComplete: (commitHash?: string) => Promise<void>
  setConversationIdCookie: (appId: string, conversationId: string) => void
  clearConversationIdCookie: (appId: string | null) => void
  getConversationIdFromCookie: (appId: string | null) => string | null
  clearRetryState: () => void
  sendToolImpression: (tool: string) => void
}

/**
 * Refs available to message handlers
 */
export interface MessageHandlerRefs {
  serverConfig: MutableRefObject<ServerConfig | null>
  pendingRecoveryAck: MutableRefObject<RecoveryAck | null>
  toolDeltaBuffer: MutableRefObject<Map<string, { name: string; delta: string; hasExplicitName: boolean }>>
  retryState: MutableRefObject<{
    pendingMessage?: { chatMessage: unknown; startTime: number }
    retryCount: number
    retryTimer?: NodeJS.Timeout
  }>
  /**
   * Controller reference for deduplication during recovery replay
   * Optional to maintain backwards compatibility with tests
   */
  controller?: {
    isInReplayMode(): boolean
    startReplayDeduplication(): void
    clearReplayDeduplication(): void
    hasSeenEvent(eventKey: string | undefined): boolean
    markEventSeen(eventKey: string | undefined): void
  }
  /**
   * Batch buffer for incremental history loading
   * Accumulates history messages before flushing to store
   */
  historyBatch?: MutableRefObject<any[]>
  /**
   * Timer for flushing history batch
   * Ensures batch flushes even if threshold not reached
   */
  historyBatchTimer?: MutableRefObject<NodeJS.Timeout | null>
  /**
   * Tracks if we've received and flushed history for the current recovery session
   * Reset when recovery starts, set to true after first flush
   * This prevents duplicate history appends when store is pre-populated
   */
  historyReceivedForRecovery?: MutableRefObject<boolean>
}

/**
 * Context provided to message handlers
 * Contains all dependencies needed to handle messages
 */
export interface MessageContext {
  socket: Socket
  currentAppId: string | null
  actions: MessageHandlerActions
  helpers: MessageHandlerHelpers
  refs: MessageHandlerRefs
  // XState machine actor for sending lifecycle events (Tier 1)
  machine: WebSocketActor
}

/**
 * Interface for message handlers
 * Each handler processes one message type
 */
export interface MessageHandler {
  /**
   * The message type this handler processes
   */
  readonly type: string

  /**
   * Handle a message of this type
   * @param data - The WebSocket message data
   * @param context - Context containing dependencies
   * @param ack - Optional acknowledgement callback
   */
  handle(
    data: WebSocketMessage,
    context: MessageContext,
    ack?: () => void
  ): Promise<void>
}
