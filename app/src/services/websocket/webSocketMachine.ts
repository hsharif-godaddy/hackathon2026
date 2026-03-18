/**
 * XState WebSocket State Machine
 *
 * Unified state machine managing WebSocket connection and streaming lifecycle.
 * Single source of truth for all connection/streaming state.
 *
 * Architecture:
 * - Parallel regions: transport (connection) + stream (messaging)
 * - Nested states: recovery flow, retry logic
 * - Guards: validation logic for transitions
 * - Actions: context updates (assign)
 *
 * External effects (handled by controller/adapter):
 * - Socket operations (connect, disconnect, emit)
 * - Store updates (via StoreSyncAdapter)
 * - Tool delta buffering (performance optimization)
 */

import { type ActorRefFrom, assign, setup, type SnapshotFrom } from 'xstate'

import { logger } from '@/lib/request-context'
import type { MachineContext, MachineEvent } from './stateMachineTypes'

const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 10000
const MAX_RETRY_COUNT = 15
const RECOVERY_ACK_TIMEOUT_MS = 30000
const STREAM_COMPLETE_DELAY_MS = 100

export const webSocketMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as MachineEvent,
  },

  actions: {
    // Connection context updates
    setAppId: assign({
      appId: ({ event }) => {
        if (event.type === 'CONNECT') {
          return event.appId
        }
        return null
      },
    }),

    setSocketId: assign({
      socketId: ({ event }) => {
        if (event.type === 'CONNECTION_ESTABLISHED' || event.type === 'AUTH_SUCCESS') {
          return event.socketId
        }
        return null
      },
    }),

    clearSocketId: assign({
      socketId: null,
    }),

    // Streaming context updates
    setConversationId: assign({
      conversationId: ({ event }) => {
        if (event.type === 'SEND_MESSAGE') {
          return event.conversationId
        }
        if (event.type === 'STREAM_STARTED') {
          return event.conversationId
        }
        return null
      },
    }),

    setMessageId: assign({
      messageId: ({ event }) => {
        if (event.type === 'STREAM_STARTED') {
          return event.messageId
        }
        return null
      },
    }),

    clearMessageId: assign({
      messageId: null,
    }),

    // Recovery tracking
    startRecovery: assign({
      recoveryId: ({ event }) => {
        if (event.type === 'RECOVERY_STATUS') {
          return event.recoveryId
        }
        return null
      },
      expectedReplayEvents: ({ event }) => {
        if (event.type === 'RECOVERY_STATUS') {
          return event.expectedEvents
        }
        return 0
      },
      receivedReplayEvents: 0,
      replayComplete: false,
    }),

    trackReplayEvent: assign({
      receivedReplayEvents: ({ context }) => context.receivedReplayEvents + 1,
    }),

    markReplayComplete: assign({
      replayComplete: true,
    }),

    setCatchupId: assign({
      catchupId: ({ event }) => {
        if (event.type === 'CATCHUP_STATUS') {
          return event.catchupId
        }
        return null
      },
    }),

    clearRecovery: assign({
      recoveryId: null,
      expectedReplayEvents: 0,
      receivedReplayEvents: 0,
      replayComplete: false,
      catchupId: null,
    }),

    // Retry tracking
    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1,
      retryDelayMs: ({ context }) =>
        Math.min(context.retryDelayMs * 2, MAX_RETRY_DELAY_MS),
    }),

    resetRetry: assign({
      retryCount: 0,
      retryDelayMs: INITIAL_RETRY_DELAY_MS,
      pendingMessage: null,
    }),

    savePendingMessage: assign({
      pendingMessage: ({ event }) => {
        if (event.type === 'SEND_MESSAGE') {
          return event.message
        }
        return null
      },
    }),

    // Error handling
    setError: assign({
      lastError: ({ event }) => {
        if ('error' in event) {
          return event.error
        }
        return null
      },
    }),

    clearError: assign({
      lastError: null,
    }),

    // Config
    setServerConfig: assign({
      serverConfig: ({ event }) => {
        if (event.type === 'SERVER_CONFIG_RECEIVED') {
          return event.config
        }
        return null
      },
    }),

    // Logging actions (basic structured logging for observability)
    logConnectionStart: ({ context }) => {
      logger.info('websocket.machine.connection.start', {
        appId: context.appId,
      })
    },

    logConnectionEstablished: ({ context }) => {
      logger.info('websocket.machine.connection.established', {
        appId: context.appId,
        socketId: context.socketId,
      })
    },

    logConnectionFailed: ({ context, event }) => {
      logger.error('websocket.machine.connection.failed', {
        appId: context.appId,
        error: 'error' in event ? event.error?.message : 'Unknown error',
      })
    },

    logDisconnect: ({ context, event }) => {
      logger.warn('websocket.machine.connection.disconnect', {
        appId: context.appId,
        socketId: context.socketId,
        reason: event.type === 'DISCONNECT' ? event.reason : 'unknown',
      })
    },

    logReconnecting: ({ context }) => {
      logger.info('websocket.machine.connection.reconnecting', {
        appId: context.appId,
        retryCount: context.retryCount,
        retryDelayMs: context.retryDelayMs,
      })
    },

    logStreamStart: ({ context }) => {
      logger.info('websocket.machine.stream.start', {
        appId: context.appId,
        conversationId: context.conversationId,
        messageId: context.messageId,
      })
    },

    logStreamComplete: ({ context }) => {
      logger.info('websocket.machine.stream.complete', {
        appId: context.appId,
        conversationId: context.conversationId,
        messageId: context.messageId,
      })
    },

    logStreamError: ({ context, event }) => {
      // Type guard for TypeScript - action only called for STREAM_ERROR events
      if (event.type !== 'STREAM_ERROR') return

      logger.error('websocket.machine.stream.error', {
        appId: context.appId,
        conversationId: context.conversationId,
        error: event.error?.message ?? 'Unknown error',
        retryable: event.retryable,
      })
    },

    logRecoveryStart: ({ context }) => {
      logger.info('websocket.machine.recovery.start', {
        appId: context.appId,
        recoveryId: context.recoveryId,
        expectedEvents: context.expectedReplayEvents,
      })
    },

    logRecoveryComplete: ({ context }) => {
      logger.info('websocket.machine.recovery.complete', {
        appId: context.appId,
        recoveryId: context.recoveryId,
        receivedEvents: context.receivedReplayEvents,
        expectedEvents: context.expectedReplayEvents,
      })
    },

    logRetryExhausted: ({ context }) => {
      logger.error('websocket.machine.retry.exhausted', {
        appId: context.appId,
        retryCount: context.retryCount,
        maxRetries: MAX_RETRY_COUNT,
      })
    },
  },

  guards: {
    // Recovery guards
    allReplayEventsReceived: ({ context }) =>
      context.receivedReplayEvents >= context.expectedReplayEvents,

    replayCompleteFlag: ({ context }) => context.replayComplete === true,

    shouldSendRecoveryAck: ({ context }) =>
      context.receivedReplayEvents >= context.expectedReplayEvents ||
      context.replayComplete,

    // Retry guards
    canRetry: ({ context }) => context.retryCount < MAX_RETRY_COUNT,

    retryExhausted: ({ context }) => context.retryCount >= MAX_RETRY_COUNT,

    // Error guards
    isRetryableError: ({ event }) => {
      if (event.type === 'STREAM_ERROR') {
        return event.retryable === true
      }
      return false
    },

    isNonRetryableError: ({ event }) => {
      if (event.type === 'STREAM_ERROR') {
        return event.retryable === false
      }
      return false
    },
  },

  delays: {
    RETRY_DELAY: ({ context }) => context.retryDelayMs,
    RECOVERY_ACK_TIMEOUT: RECOVERY_ACK_TIMEOUT_MS,
    STREAM_COMPLETE_DELAY: STREAM_COMPLETE_DELAY_MS,
  },
}).createMachine({
  id: 'webSocket',

  type: 'parallel',

  context: {
    appId: null,
    socketId: null,
    conversationId: null,
    messageId: null,
    recoveryId: null,
    expectedReplayEvents: 0,
    receivedReplayEvents: 0,
    replayComplete: false,
    catchupId: null,
    retryCount: 0,
    retryDelayMs: INITIAL_RETRY_DELAY_MS,
    pendingMessage: null,
    serverConfig: null,
    lastError: null,
  },

  states: {
    // ============ TRANSPORT REGION ============
    // Manages connection lifecycle
    transport: {
      initial: 'disconnected',

      // Handle CONNECT from ANY state (enables app switching)
      on: {
        CONNECT: {
          target: '.connecting',
          actions: ['setAppId', 'logConnectionStart'],
        },
      },

      states: {
        disconnected: {
          entry: ['clearSocketId', 'clearError'],
          // CONNECT is now handled at parent level
        },

        connecting: {
          on: {
            CONNECTION_ESTABLISHED: {
              target: 'authenticating',
              actions: ['setSocketId'],
            },
            CONNECTION_FAILED: {
              target: 'reconnecting',
              actions: ['setError', 'logConnectionFailed'],
            },
            DISCONNECT: {
              target: 'reconnecting',
              actions: ['setError', 'logDisconnect'],
            },
          },
        },

        authenticating: {
          on: {
            AUTH_SUCCESS: {
              target: 'connected',
              actions: ['setSocketId', 'resetRetry', 'logConnectionEstablished'],
            },
            AUTH_FAILED: {
              target: 'reconnecting',
              actions: ['setError', 'logConnectionFailed'],
            },
            DISCONNECT: {
              target: 'reconnecting',
              actions: ['setError', 'logDisconnect'],
            },
          },
        },

        connected: {
          initial: 'idle',

          on: {
            DISCONNECT: {
              target: 'reconnecting',
              actions: ['setError', 'logDisconnect'],
            },
            SERVER_CONFIG_RECEIVED: {
              actions: ['setServerConfig'],
            },
          },

          states: {
            idle: {
              entry: ['clearError'],
              on: {
                RECOVERY_STATUS: {
                  target: 'recovering',
                  actions: ['startRecovery'],
                },
              },
            },

            recovering: {
              initial: 'pendingAck',
              entry: 'logRecoveryStart',

              states: {
                pendingAck: {
                  on: {
                    REPLAY_EVENT_RECEIVED: {
                      actions: ['trackReplayEvent'],
                    },

                    REPLAY_COMPLETE: {
                      actions: ['markReplayComplete'],
                    },

                    CATCHUP_STATUS: {
                      target: 'catchup',
                      actions: ['setCatchupId'],
                    },
                  },

                  // Auto-transition when conditions met
                  always: {
                    target: 'sendingAck',
                    guard: 'shouldSendRecoveryAck',
                  },

                  // Timeout fallback
                  after: {
                    RECOVERY_ACK_TIMEOUT: 'sendingAck',
                  },
                },

                sendingAck: {
                  on: {
                    RECOVERY_ACK_SENT: {
                      target: '#webSocket.transport.connected.idle',
                      actions: ['clearRecovery', 'logRecoveryComplete'],
                    },
                  },
                },

                catchup: {
                  on: {
                    CATCHUP_COMPLETE: {
                      target: '#webSocket.transport.connected.idle',
                      actions: ['clearRecovery', 'logRecoveryComplete'],
                    },
                  },
                },
              },
            },
          },
        },

        reconnecting: {
          initial: 'retrying',
          entry: 'logReconnecting',

          on: {
            CONNECTION_ESTABLISHED: {
              target: '#webSocket.transport.authenticating',
              actions: ['setSocketId'],
            },
            AUTH_SUCCESS: {
              target: '#webSocket.transport.connected',
              actions: ['setSocketId', 'resetRetry', 'logConnectionEstablished'],
            },
          },

          states: {
            retrying: {
              entry: ['incrementRetry'],

              after: {
                RETRY_DELAY: [
                  {
                    target: '#webSocket.transport.connecting',
                    guard: 'canRetry',
                  },
                  {
                    target: 'exhausted',
                    guard: 'retryExhausted',
                  },
                ],
              },

            },

            exhausted: {
              type: 'final',
              entry: 'logRetryExhausted',
            },
          },
        },

      },
    },

    // ============ STREAM REGION ============
    // Manages streaming lifecycle
    // Note: Starts in 'completed' state (not 'idle') to align with unified WebSocket
    // history architecture where initial connection and recovery are identical
    stream: {
      initial: 'completed',

      states: {
        streaming: {
          initial: 'receiving',

          states: {
            receiving: {
              on: {
                // Allow starting a new stream even if one was active
                // This handles app switching where the previous stream was interrupted
                SEND_MESSAGE: {
                  target: 'receiving',
                  actions: ['setConversationId', 'savePendingMessage', 'logStreamStart'],
                },

                STREAM_COMPLETE: {
                  target: 'completing',
                  actions: 'logStreamComplete',
                },

                STREAM_ERROR: [
                  {
                    target: '#webSocket.stream.error',
                    actions: ['setError', 'logStreamError'],
                    guard: 'isNonRetryableError',
                  },
                  {
                    // Retryable errors stay in receiving state
                    actions: ['setError', 'logStreamError'],
                    guard: 'isRetryableError',
                  },
                ],
              },
            },

            completing: {
              after: {
                STREAM_COMPLETE_DELAY: '#webSocket.stream.completed',
              },
            },
          },
        },

        completed: {
          entry: ['clearMessageId', 'clearError'],
          on: {
            SEND_MESSAGE: {
              target: 'streaming',
              actions: ['setConversationId', 'savePendingMessage', 'logStreamStart'],
            },
            STREAM_STARTED: {
              target: 'streaming',
              actions: ['setConversationId', 'setMessageId', 'logStreamStart'],
            },
          },
        },

        error: {
          entry: ['setError'],
          on: {
            SEND_MESSAGE: {
              target: 'streaming',
              actions: ['setConversationId', 'savePendingMessage', 'clearError'],
            },
            STREAM_STARTED: {
              target: 'streaming',
              actions: ['setConversationId', 'setMessageId', 'clearError'],
            },
          },
        },
      },
    },
  },
})

/**
 * Properly typed machine export
 * Use this instead of the generic WebSocketMachine from stateMachineTypes
 */
export type WebSocketMachine = typeof webSocketMachine

/**
 * Properly typed actor export
 * Use this for machine instances (e.g., in MessageContext)
 */
export type WebSocketActor = ActorRefFrom<typeof webSocketMachine>

/**
 * Properly typed snapshot export
 * Use this for strongly typing snapshot.value and snapshot.context
 */
export type WebSocketSnapshot = SnapshotFrom<typeof webSocketMachine>

/**
 * Exported constants for testing and external configuration
 */
export { MAX_RETRY_COUNT, MAX_RETRY_DELAY_MS }
