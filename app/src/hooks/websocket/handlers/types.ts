/**
 * WebSocket Message Handler Types
 *
 * Defines interfaces for the message handler registry pattern.
 * Enables clean separation of message handling logic into focused handler classes.
 */

import type { MutableRefObject } from 'react'
import type { Socket } from 'socket.io-client'
import type { MessageOrigin } from '@airo/shared/auth'

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
  'history_loaded',
  'history_complete',
  'stream_retry',
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
  /** Server-authoritative: true when no in-progress messages exist in the event channel */
  streamCompleted?: boolean
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
  finishReason?: string
  usedFreeGrants?: boolean
  commitHash?: string
}

/**
 * Actions available to message handlers
 * These are the hook actions that handlers can call to update state
 */
export interface MessageHandlerActions {
  setWebSocketState: (state: WebSocketStateUpdate) => void
  setStreamingState: (state: string) => void
  setIsLoading: (loading: boolean) => void
  startNewStream: (
    content: string,
    selectedAssets?: any[],
    referencedFiles?: Array<{ path: string; content: string }>,
    origin?: MessageOrigin,
    uploadedFileName?: string,
    userMessageMetadata?: Record<string, unknown>,
  ) => void
  appendTextSegment: (content: string) => void
  addToolStartSegment: (toolCall: ToolCall) => void
  addToolCallSegment: (toolCall: ToolCall) => void
  addToolResultSegment: (toolCall: ToolCall) => void
  markMaxStepsReached: () => void
  markUpstreamError: (error: StructuredError) => void
  markBudgetExceeded: () => void
  clearStreamForRetry: () => void
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
  t: (id: string, values?: Record<string, any>) => string
  /**
   * Transport-agnostic, best-effort signal asking the agent to reset the
   * timeout on a pending client action (named by requestId). Used by long
   * human-in-the-loop executors (e.g. publish approval) so that human
   * think-time does not consume the budget meant for the actual work.
   *
   * Each transport wires its own reverse channel (WS socket.emit vs SSE HTTP
   * POST). Optional because not every context provides it (SSE minimal
   * context, tests, older paths) — always call via optional chaining.
   *
   * The browser names WHICH action to refresh, never HOW LONG: the agent always
   * reuses the action's original server-owned timeout. A client-chosen duration
   * is deliberately not part of this protocol (it would let page code extend or
   * collapse a pending action).
   */
  resetActionTimeout?: (requestId: string) => void
}

/**
 * Context for data-only handlers (Tier 2)
 * These handlers process streaming data (chunks, tools, steps) and MUST NOT
 * send machine events or read machine state.
 */
export type DataHandlerContext = Omit<MessageContext, 'machine'>

/**
 * Context for lifecycle handlers (Tier 1)
 * These handlers manage connection/streaming lifecycle and CAN send machine events.
 * Identical to MessageContext - this alias makes the intent explicit.
 */
export type LifecycleHandlerContext = MessageContext

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
