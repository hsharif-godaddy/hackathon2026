/**
 * XState WebSocket State Machine Types
 *
 * Type definitions for the unified state machine that manages WebSocket
 * connection and streaming lifecycle.
 *
 * IMPORTANT: This module must remain framework-agnostic (no React imports)
 * to enable reuse outside the Next.js hook layer.
 */

/**
 * Server configuration received during WebSocket handshake
 * Defines timeout values for synchronization between client and server
 */
export interface ServerConfig {
  streamRecoveryWindow: number
  ackTimeout: number
}

/**
 * Machine context - single source of truth for all WebSocket state
 */
export interface MachineContext {
  // Identity
  appId: string | null
  socketId: string | null
  conversationId: string | null
  messageId: string | null

  // Recovery
  recoveryId: string | null
  expectedReplayEvents: number
  receivedReplayEvents: number
  replayComplete: boolean
  catchupId: string | null

  // Retry
  retryCount: number
  retryDelayMs: number
  pendingMessage: unknown | null

  // Config
  serverConfig: ServerConfig | null

  // Errors
  lastError: Error | null
}

/**
 * Machine events - all possible events the machine can receive
 */
export type MachineEvent =
  // Connection events
  | { type: 'CONNECT'; appId: string }
  | { type: 'CONNECTION_ESTABLISHED'; socketId: string }
  | { type: 'CONNECTION_FAILED'; error: Error }
  | { type: 'DISCONNECT'; reason: string }
  | { type: 'TOKEN_REFRESHED' }
  | { type: 'TOKEN_REFRESH_FAILED'; error: Error }

  // Streaming events
  | { type: 'SEND_MESSAGE'; message: unknown; conversationId: string }
  | { type: 'STREAM_STARTED'; conversationId: string; messageId: string }
  | { type: 'STREAM_COMPLETE' }
  | { type: 'STREAM_ERROR'; error: Error; retryable: boolean }

  // Recovery events
  | { type: 'RECOVERY_STATUS'; recoveryId: string; expectedEvents: number }
  | { type: 'REPLAY_EVENT_RECEIVED' }
  | { type: 'REPLAY_COMPLETE' }
  | { type: 'CATCHUP_STATUS'; catchupId: string }
  | { type: 'CATCHUP_COMPLETE' }
  | { type: 'RECOVERY_ACK_SENT' }

  // Config events
  | { type: 'SERVER_CONFIG_RECEIVED'; config: ServerConfig }

/**
 * Type exports for XState machine
 *
 * Note: WebSocketMachine, WebSocketActor, and WebSocketSnapshot are exported from webSocketMachine.ts to avoid circular dependency.
 * Import them from there: `import { type WebSocketMachine, type WebSocketActor, type WebSocketSnapshot } from './webSocketMachine'`
 *
 * Re-export for convenience:
 */
export type { WebSocketActor, WebSocketMachine, WebSocketSnapshot } from './webSocketMachine'
