/**
 * Streaming WebSocket Hook
 *
 * Connects Socket.IO events directly to the streaming store.
 * Clean, direct mapping without message array manipulation.
 */

import { useCallback, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { validate as validateUUID } from 'uuid'
import { useQueryClient } from '@tanstack/react-query'
import {
  useWebSocketState,
  useCurrentAppId,
  useStartNewStream,
  useAppendTextSegment,
  useAddToolStartSegment,
  useAddToolCallSegment,
  useAddToolResultSegment,
  useMarkMaxStepsReached,
  useMarkUpstreamError,
  useFinalizeStream,
  useSetWebSocketState,
  useSetStreamingState,
  useSetIsLoading,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { useTodoListStore } from '@/stores/useTodoListStore'
import { useGitStore } from '@/stores/useGitStore'
import type { AgentsAppContext, AgentsAppChatMessage } from '../types/websocket-context'
import { captureVisualContext } from '../app/develop/components/visualContextCapture'
import { logImpressionEvent } from '@/utils/instrumentation'
import { logger } from '@/lib/request-context'
import { setSharedSocket, getSharedSocket } from '@/lib/socketRegistry'
import { AgentService } from '@/services/AgentService'

// Constants
const RAF_FALLBACK_DELAY_MS = 16 // ~60fps frame duration for setTimeout fallback

/**
 * Get short-lived JWT token for WebSocket authentication (12 hours)
 */
const getAgentJWTToken = async (siteId: string): Promise<string | null> => {
  if (typeof document === 'undefined') return null;

  try {
    const response = await fetch('/api/auth/agent-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, expiresInSeconds: (12 * 60 * 60) })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('websocket.token.request_failed', {
        message: 'Failed to get WebSocket agent token',
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        siteId
      });
      return null;
    }

    const data = await response.json();
    const token = data.token;

    if (!token) {
      logger.error('websocket.token.missing_field', {
        message: 'WebSocket agent token response missing token field',
        responseData: data
      });
      return null;
    }

    return token;
  } catch (error) {
    logger.error('websocket.token.exception', {
      message: 'Failed to get WebSocket auth token',
      error: error instanceof Error ? error.message : String(error),
      siteId
    });
    return null;
  }
};

/**
 * Get conversationId from browser cookies
 * @returns Conversation ID string or null if not found or invalid
 */
function getConversationIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null

  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === 'conversationId' && value) {
      const decodedValue = decodeURIComponent(value)
      if (validateUUID(decodedValue)) {
        return decodedValue
      }
    }
  }
  return null
}

/**
 * Delete conversationId cookie from browser
 */
function deleteConversationIdCookie(): void {
  if (typeof document === 'undefined') return

  // Delete cookie by setting it with past expiration date
  document.cookie = 'conversationId=; path=/; max-age=0; SameSite=Lax'
}

export function useStreamingWebSocket() {
  const socketRef = useRef<Socket | null>(null)
  const wasRecoveredRef = useRef<boolean>(false)
  const createdHereRef = useRef<boolean>(false) // Track if this instance created the socket

  // Track retry state for APP_NOT_FOUND errors (race condition during app registration)
  const retryStateRef = useRef<{
    pendingMessage?: { content: string; aiEditContext?: any; startTime: number }
    retryCount: number
    retryTimer?: NodeJS.Timeout
  }>({ retryCount: 0 })
  // Guard flag to prevent concurrent initialization attempts
  const initializingRef = useRef<boolean>(false)
  // Timer ref for delayed initialization
  const initTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Track if we were streaming when disconnect happened
  const wasStreamingOnDisconnectRef = useRef<boolean>(false)
  // Track disconnect time to determine if we should show error after 5 minutes
  const disconnectTimeRef = useRef<number | null>(null)
  // Timer to switch from warning to error after 5 minutes
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const webSocketState = useWebSocketState()
  const currentAppId = useCurrentAppId()
  const queryClient = useQueryClient()
  // Hook setters & streaming state (declared early for use in callbacks)
  const startNewStream = useStartNewStream()
  const appendTextSegment = useAppendTextSegment()
  const addToolStartSegment = useAddToolStartSegment()
  const addToolCallSegment = useAddToolCallSegment()
  const addToolResultSegment = useAddToolResultSegment()
  const markMaxStepsReached = useMarkMaxStepsReached()
  const markUpstreamError = useMarkUpstreamError()
  const finalizeStream = useFinalizeStream()
  const setWebSocketState = useSetWebSocketState()
  const setStreamingState = useSetStreamingState()
  const setIsLoading = useSetIsLoading()
  const sendToolImpression = (tool: string) => logImpressionEvent(`develop.tool.${tool}`)()
  const toolDeltaBufferRef = useRef<Map<string, { name: string; delta: string; hasExplicitName: boolean }>>(new Map())
  // hasExplicitName prevents later deltas that omit a tool name from overwriting a previously captured explicit name.
  const toolDeltaFlushScheduledRef = useRef<boolean>(false)
  const updateToolDeltaRef = useRef(useStreamingConversationStore.getState().updateToolDelta)

  useEffect(() => {
    const unsubscribe = useStreamingConversationStore.subscribe((state) => {
      updateToolDeltaRef.current = state.updateToolDelta
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const flushToolDeltaBuffer = useCallback(() => {
    if (toolDeltaBufferRef.current.size === 0) {
      return
    }

    const updateToolDeltaFn = updateToolDeltaRef.current
    if (!updateToolDeltaFn) {
      logger.warn('websocket.tool_delta.flush_unavailable', {
        message: 'Tool delta buffer cleared without update function - user-facing output lost',
        bufferedToolCount: toolDeltaBufferRef.current.size,
        toolIds: Array.from(toolDeltaBufferRef.current.keys())
      })
      toolDeltaBufferRef.current.clear()
      return
    }

    try {
      // hasExplicitName is only needed while accumulating, so we ignore it during flush.
      toolDeltaBufferRef.current.forEach(({ name, delta }, toolId) => {
        if (delta.length > 0) {
          updateToolDeltaFn(toolId, name, delta)
        }
      })

      toolDeltaBufferRef.current.clear()
    } catch (error) {
      logger.error('websocket.tool_delta.flush_error', {
        message: 'Failed to flush tool delta buffer',
        error: error instanceof Error ? error.message : String(error),
        bufferedToolCount: toolDeltaBufferRef.current.size,
        toolIds: Array.from(toolDeltaBufferRef.current.keys())
      })
      // Clear buffer even on error to prevent permanent stuck state
      toolDeltaBufferRef.current.clear()
    }
  }, [])

  const flushToolDeltaBufferImmediate = useCallback(() => {
    if (toolDeltaFlushScheduledRef.current) {
      toolDeltaFlushScheduledRef.current = false
    }
    flushToolDeltaBuffer()
  }, [flushToolDeltaBuffer])

  const scheduleToolDeltaFlush = useCallback(() => {
    if (toolDeltaFlushScheduledRef.current) {
      return
    }

    toolDeltaFlushScheduledRef.current = true

    const runFlush = () => {
      try {
        toolDeltaFlushScheduledRef.current = false
        flushToolDeltaBuffer()
      } catch (error) {
        logger.error('websocket.tool_delta.flush_execution_error', {
          message: 'Failed to execute scheduled flush',
          error: error instanceof Error ? error.message : String(error)
        })
        // Reset flag to allow future flush attempts
        toolDeltaFlushScheduledRef.current = false
        // Attempt immediate fallback flush
        try {
          flushToolDeltaBuffer()
        } catch (fallbackError) {
          logger.error('websocket.tool_delta.flush_fallback_error', {
            message: 'Fallback flush also failed',
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          })
        }
      }
    }

    // Try requestAnimationFrame with fallback to setTimeout
    try {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(runFlush)
      } else {
        setTimeout(runFlush, RAF_FALLBACK_DELAY_MS)
      }
    } catch (schedulingError) {
      logger.error('websocket.tool_delta.flush_scheduling_error', {
        message: 'Failed to schedule flush, attempting immediate fallback',
        error: schedulingError instanceof Error ? schedulingError.message : String(schedulingError)
      })
      // Reset flag and attempt immediate flush as fallback
      toolDeltaFlushScheduledRef.current = false
      try {
        flushToolDeltaBuffer()
      } catch (fallbackError) {
        logger.error('websocket.tool_delta.flush_immediate_fallback_error', {
          message: 'Immediate fallback flush failed',
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        })
      }
    }
  }, [flushToolDeltaBuffer])

  // Create Socket.IO connection (stable)
  const createConnection = useCallback(async (appId: string): Promise<Socket> => {
    return new Promise(async (resolve, reject) => {
      // Clean up existing socket first to prevent duplicate handlers
      if (socketRef.current) {
        logger.info('websocket.connection.cleanup', { message: 'Cleaning up existing socket before creating new one' })
        socketRef.current.removeAllListeners()
        socketRef.current.disconnect()
        socketRef.current = null
      }

      // Get the dynamic config to extract the baseUrl
      const { dynamicApiConfigService } = await import('../config/dynamic-api')
      const config = await dynamicApiConfigService.getConfigForSite(appId)
      const socketUrl = config.baseUrl
      logger.info('websocket.connection.create', { message: 'Creating Socket.IO connection', url: socketUrl })

      let authToken: string | null = null
      try {
        authToken = await getAgentJWTToken(appId)
      } catch (e) {
        logger.error('websocket.token.error', { message: 'Failed to get WebSocket JWT token', error: e instanceof Error ? e.message : String(e) })
      }

      // Feature flag for manual recovery (disabled by default until fully tested)
      const enableManualRecovery = process.env.NEXT_PUBLIC_ENABLE_MANUAL_RECOVERY === 'true'

      // Check if we have a previous socket ID from before page reload (only if feature enabled)
      const previousSocketId = enableManualRecovery ? sessionStorage.getItem(`socket_id_${appId}`) : null
      if (previousSocketId) {
        logger.info('websocket.recovery.attempt', {
          message: 'Found previous socket ID, will attempt recovery',
          previousSocketId,
          appId
        })
      }

      const socketOptions: any = {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 20,  // 20 attempts over ~90 seconds
        reconnectionDelay: 2000,   // Start with 2 second delay
        reconnectionDelayMax: 5000, // Max 5 second delay between attempts
        randomizationFactor: 0.5,
        // Enable connection state recovery to preserve socket ID across reconnections
        // This allows the server to replay buffered events after brief disconnections
        connectionStateRecovery: {},
        // Pass previous socket ID for manual recovery after page reload (feature flagged)
        auth: {
          ...(authToken && { token: authToken }),
          ...(enableManualRecovery && previousSocketId && { previousSocketId })
        }
      }
      if (authToken) {
        socketOptions.extraHeaders = { Authorization: `Bearer ${authToken}` }
      }
      const socket = io(socketUrl, socketOptions)
      if (process.env.NODE_ENV === 'development') {
        // Disabled noisy websocket logging
        // socket.onAny((event, ...args) => logger.debug('websocket.event.incoming', { event, argsPreview: JSON.stringify(args).slice(0, 500), timestamp: Date.now() }))
        // socket.onAnyOutgoing((event, ...args) => logger.debug('websocket.event.outgoing', { event, argsCount: args.length, timestamp: Date.now() }))
      }
      socket.on('connect', () => {
        // Check if this is a recovered connection (socket ID preserved)
        if (socket.recovered) {
          logger.info('websocket.connection.recovered', {
            message: 'Connection recovered with preserved socket ID (automatic)',
            socketId: socket.id,
            appId
          })
          // Mark that this connection was recovered so message handler knows to initialize stream
          wasRecoveredRef.current = true
          // Connection was recovered - buffered events will be replayed by server
          // Update UI state to show we're reconnected
          setWebSocketState({ connected: true, status: 'idle' })
        } else if (previousSocketId && previousSocketId !== socket.id) {
          // Manual recovery after page reload - new socket ID but we had a previous one
          logger.info('websocket.connection.manual_recovery', {
            message: 'New connection after page reload, attempting manual recovery',
            newSocketId: socket.id,
            previousSocketId,
            appId
          })
          // Mark as recovered so we initialize stream when messages arrive
          wasRecoveredRef.current = true
          setWebSocketState({ connected: true, status: 'idle' })
          // Update sessionStorage with new socket ID for next potential recovery (if feature enabled)
          if (enableManualRecovery) {
            sessionStorage.setItem(`socket_id_${appId}`, socket.id)
          }
        } else {
          logger.info('websocket.connection.new', {
            message: 'New connection established',
            socketId: socket.id,
            appId
          })
          wasRecoveredRef.current = false
          setWebSocketState({ connected: true, status: 'idle' })
          // Store new socket ID in sessionStorage (if feature enabled)
          if (enableManualRecovery) {
            sessionStorage.setItem(`socket_id_${appId}`, socket.id)
          }
        }
        resolve(socket)
      })
      socket.on('connect_error', (error) => {
        setWebSocketState({ connected: false, status: 'error', error: error.message })
        reject(error)
      })
      socket.on('disconnect', () => {
        const state = useStreamingConversationStore.getState()
        const isStreaming = state.streamingState === 'streaming' || state.activeStream !== null

        if (isStreaming) {
          // Connection dropped during active streaming - mark that we were streaming
          wasStreamingOnDisconnectRef.current = true
          disconnectTimeRef.current = Date.now()

          // Show warning (yellow) initially - we'll retry for 5 minutes
          setWebSocketState({ connected: false, status: 'connecting', error: 'Connection lost, retrying...' })
          setStreamingState('retrying')

          // Set timeout to switch to error after 5 minutes (300000ms)
          reconnectTimeoutRef.current = setTimeout(() => {
            const state = useStreamingConversationStore.getState()
            if (state.streamingState === 'retrying') {
              setWebSocketState({ connected: false, status: 'error', error: 'Connection lost - retry timeout exceeded' })
              setStreamingState('error')
              setIsLoading(false)
            }
          }, 300000) // 5 minutes
        } else {
          // Normal disconnect when idle
          wasStreamingOnDisconnectRef.current = false
          setWebSocketState({ connected: false, status: 'idle' })
        }
      })
      socket.on('reconnect_attempt', () => setWebSocketState({ connected: false, status: 'connecting' }))
      socket.on('reconnect', () => {
        setWebSocketState({ connected: true, status: 'idle' })

        // Clear the 5-minute timeout if reconnection succeeded
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
        disconnectTimeRef.current = null

        // If we were streaming when disconnect happened, check if stream was recovered
        if (wasStreamingOnDisconnectRef.current) {
          const state = useStreamingConversationStore.getState()
          // If we're still in retrying state, the stream was successfully recovered
          if (state.streamingState === 'retrying') {
            setStreamingState('streaming')
            setIsLoading(true)
          } else {
            // Otherwise, mark as error
            setStreamingState('error')
            setIsLoading(false)
          }
          wasStreamingOnDisconnectRef.current = false // Reset after handling
        }
      })
      socket.on('reconnect_error', (error) => setWebSocketState({ connected: false, status: 'connecting', error: error.message }))
      socket.on('reconnect_failed', () => {
        const state = useStreamingConversationStore.getState()
        const isStreaming = state.streamingState === 'streaming' || state.streamingState === 'retrying' || state.activeStream !== null

        // Clear the timeout since we've given up
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
        disconnectTimeRef.current = null

        setWebSocketState({ connected: false, status: 'error', error: 'Failed to reconnect' })
        if (isStreaming || wasStreamingOnDisconnectRef.current) {
          // This is a connection error, not an upstream service error
          setStreamingState('error')
          setIsLoading(false)
          wasStreamingOnDisconnectRef.current = false // Reset after handling
        }
      })
    })
  }, [setWebSocketState])

  /**
   * Handle commit selection and preview refresh after message completion
   *
   * MESSAGE_COMPLETE must fire AFTER commit selection completes to ensure files are synced
   *
   * @param commitHash - Optional commit hash from the completed message
   */
  const handleCommitComplete = useCallback(async (commitHash?: string) => {
    if (commitHash && currentAppId) {
      logger.info('websocket.commit_created', {
        appId: currentAppId,
        commitHash: commitHash.substring(0, 7),
        message: 'Commit created during conversation, invalidating and selecting'
      })

      try {
        // Invalidate to get fresh commit list
        await queryClient.invalidateQueries({
          queryKey: ['git-history', currentAppId],
          refetchType: 'active'
        })

        // Select the new commit
        await useGitStore.getState().selectCommit(currentAppId, commitHash)

        logger.info('websocket.commit_selected', {
          appId: currentAppId,
          commitHash: commitHash.substring(0, 7),
          message: 'Successfully selected new commit, triggering preview refresh'
        })

        // Now trigger preview refresh - files are synced
        window.postMessage({
          type: 'MESSAGE_COMPLETE',
          source: 'websocket'
        }, window.location.origin)
      } catch (error) {
        logger.error('websocket.commit_selection_error', {
          appId: currentAppId,
          commitHash: commitHash.substring(0, 7),
          error: error instanceof Error ? error.message : String(error),
          message: 'Failed to select commit after conversation'
        })

        // Still trigger preview refresh on error
        window.postMessage({
          type: 'MESSAGE_COMPLETE',
          source: 'websocket'
        }, window.location.origin)
      }
    } else if (currentAppId) {
      logger.info('websocket.no_commit', {
        appId: currentAppId,
        message: 'No commit created (no file changes)'
      })

      // No commit - trigger preview refresh immediately
      window.postMessage({
        type: 'MESSAGE_COMPLETE',
        source: 'websocket'
      }, window.location.origin)
    } else {
      // No appId - still trigger preview refresh for any other listeners
      window.postMessage({
        type: 'MESSAGE_COMPLETE',
        source: 'websocket'
      }, window.location.origin)
    }
  }, [currentAppId, queryClient])

  // Set up Socket.IO event handlers for streaming (defined before useEffect to satisfy dependency ordering)
  const setupEventHandlers = useCallback((socket: Socket) => {
    // Track if we've initialized stream for replayed events
    let hasInitializedReplayStream = false

    socket.on('status', (data) => {
      if (data.data?.status === 'thinking') {
        setWebSocketState({ status: 'streaming' })
        setStreamingState('streaming')
      }
    })
    socket.on('message', async (data) => {
      switch (data.type) {
        case 'recovery_status':
          // Server is telling us about recovery state
          logger.info('websocket.recovery_status', {
            message: 'Received recovery status from server',
            hasBufferedEvents: data.data?.hasBufferedEvents,
            bufferedEventCount: data.data?.bufferedEventCount,
            conversationId: data.data?.conversationId,
            streamCompleted: data.data?.streamCompleted
          })

          if (data.data?.streamCompleted) {
            // Stream already completed - just load history and stay idle
            logger.info('websocket.recovery.completed', {
              message: 'Stream already completed, loading history only'
            })
            // TODO: Load conversation history here if needed
            wasRecoveredRef.current = false
            setStreamingState('idle')
            setIsLoading(false)
          } else if (data.data?.hasBufferedEvents) {
            // Stream is still active - load history then prepare for replay
            logger.info('websocket.recovery.active', {
              message: 'Stream still active, loading history before replay',
              conversationId: data.data.conversationId
            })

            // Load conversation history from API if we have conversationId
            if (data.data.conversationId && currentAppId) {
              try {
                const agentService = AgentService.getInstance()

                // Load the specific conversation
                const conversation = await agentService.getConversation(currentAppId, data.data.conversationId)

                logger.info('websocket.recovery.history_loaded', {
                  message: 'Loaded conversation history',
                  messageCount: conversation.messages?.length || 0
                })

                // Add messages to store if we have them
                if (conversation.messages && conversation.messages.length > 0) {
                  // Set messages directly in the store (they're already complete messages from DB)
                  // Type assertion needed because conversation.messages comes from API
                  useStreamingConversationStore.setState({ messages: conversation.messages as any[] })

                  // Initialize an empty activeStream to receive buffered events
                  // Don't create a new user message - we're resuming an existing conversation
                  const streamingMessage = {
                    id: `recovered_${Date.now()}`,
                    role: 'assistant' as const,
                    content: '',
                    segments: [],
                    toolCalls: [],
                    timestamp: new Date(),
                    isComplete: false
                  }

                  useStreamingConversationStore.setState({
                    activeStream: streamingMessage,
                    streamingState: 'streaming',
                    currentStep: 1,
                    isLoading: true
                  })

                  logger.info('websocket.recovery.stream_initialized', {
                    message: 'Initialized activeStream for buffered events',
                    streamId: streamingMessage.id
                  })
                }
              } catch (error) {
                logger.error('websocket.recovery.history_failed', {
                  message: 'Failed to load conversation history',
                  error: error instanceof Error ? error.message : String(error)
                })
              }
            } else {
              // No conversation history - still initialize stream for buffered events
              const streamingMessage = {
                id: `recovered_${Date.now()}`,
                role: 'assistant' as const,
                content: '',
                segments: [],
                toolCalls: [],
                timestamp: new Date(),
                isComplete: false
              }

              useStreamingConversationStore.setState({
                activeStream: streamingMessage,
                streamingState: 'streaming',
                currentStep: 1,
                isLoading: true
              })
            }

            setStreamingState('streaming')
            hasInitializedReplayStream = true
          }

          // Reset recovery flag
          wasRecoveredRef.current = false
          break

        case 'step_start':
          sendToolImpression('start')
          // Clear any retrying state and resume streaming
          setStreamingState('streaming')
          // Clear reconnection timeout if still active
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = null
          }
          break
        case 'chunk':
          // Ensure we're in streaming state (in case we recovered and are receiving chunks)
          const currentState = useStreamingConversationStore.getState()
          if (currentState.streamingState === 'retrying') {
            setStreamingState('streaming')
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current)
              reconnectTimeoutRef.current = null
            }
          }
          appendTextSegment(data.content)
          break
        case 'tool_start':
          if (data.data?.tool) {
            const toolCall: ToolCall = {
              id: data.data.tool.id || `tool_${Date.now()}`,
              name: data.data.tool.name,
              input: data.data.tool.input || {},
              status: 'running',
              startTime: Date.now()
            }
            addToolStartSegment(toolCall)
          }
          break
        case 'tool_input_delta':
          // Tool input streaming delta - update partial input accumulation
          // Only require toolId and delta - toolName can be looked up from existing tool calls
          // Skip empty deltas (they don't add any information)
          if (data.data?.toolId && data.data?.delta !== undefined && data.data.delta.length > 0) {
            const toolId = data.data.toolId
            const incomingName = data.data.toolName
            const normalizedName = incomingName || 'unknown-tool'
            const hasExplicitName = !!incomingName && incomingName !== 'unknown-tool'
            const existingDelta = toolDeltaBufferRef.current.get(toolId)

            if (existingDelta) {
              existingDelta.delta += data.data.delta
              if (hasExplicitName) {
                existingDelta.name = normalizedName
                existingDelta.hasExplicitName = true
              }
            } else {
              toolDeltaBufferRef.current.set(toolId, {
                name: normalizedName,
                delta: data.data.delta,
                hasExplicitName
              })
            }

            scheduleToolDeltaFlush()
          }
          break
        case 'tool_call':
          // Tool call with complete input - update existing tool start segment
          if (data.data?.tool) {
            flushToolDeltaBufferImmediate()
            const toolCall: ToolCall = {
              id: data.data.tool.id,
              name: data.data.tool.name,
              input: data.data.tool.input || {},
              status: 'running'
            }
            addToolCallSegment(toolCall)
          }
          break
        case 'tool_result':
          if (data.data?.tool) {
            flushToolDeltaBufferImmediate()
            const hasError = data.data.tool.error || data.data.tool.is_error

            const toolCall: ToolCall = {
              id: data.data.tool.id,
              name: data.data.tool.name,
              input: data.data.tool.input || {},
              result: data.data.tool.output || data.data.tool.result,
              error: data.data.tool.error,
              status: hasError ? 'error' : 'completed',
              startTime: data.data.tool.startTime,
              endTime: Date.now()
            }
            sendToolImpression(data.data.tool.name)
            addToolResultSegment(toolCall)
            // Update persistent todo list if this is a todoList tool
            if (data.data.tool.name === 'todoList' && !hasError) {
              try {
                const { updateFromToolCall } = useTodoListStore.getState()
                updateFromToolCall(toolCall.result)
              } catch (error) {
                logger.error('websocket.todo-list.update.failure', {
                  error: error instanceof Error ? error.message : String(error)
                })
              }
            }
          }
          break
        case 'step_complete':
          if (data.data?.maxStepsReached === true) {
            logger.info('websocket.steps.max-reached', { message: 'Max steps reached - marking in state' })
            markMaxStepsReached()
          }
          break
        case 'complete':
          // Log what we received from the WebSocket
          flushToolDeltaBufferImmediate()
          logger.info('websocket.complete_received', {
            appId: currentAppId,
            hasCommitHash: !!data.data?.commitHash,
            commitHash: data.data?.commitHash ? data.data.commitHash.substring(0, 7) : null,
            message: 'Received complete event from WebSocket'
          })

          // Clear retry state on successful completion
          if (retryStateRef.current.retryTimer) {
            clearTimeout(retryStateRef.current.retryTimer)
          }
          retryStateRef.current = { retryCount: 0 }

          finalizeStream({
            agentId: data.data?.agentId,
            usage: data.data?.usage,
            totalSteps: data.data?.step
          })
          sendToolImpression('complete');
          setWebSocketState({ status: 'idle' });
          setStreamingState('idle');
          setIsLoading(false);

          // Handle commit selection and preview refresh
          handleCommitComplete(data.data?.commitHash)
          break
        case 'error':
          flushToolDeltaBufferImmediate()
          // Check if this is an APP_NOT_FOUND error that we should retry
          const errorType = data.data?.errorType
          const isAppNotFound = errorType === 'APP_NOT_FOUND'
          const retryState = retryStateRef.current
          const elapsedTime = retryState.pendingMessage
            ? Date.now() - retryState.pendingMessage.startTime
            : 0
          const shouldRetry = isAppNotFound && elapsedTime < 30000 // Retry for up to 30 seconds

          if (shouldRetry && retryState.pendingMessage) {
            retryState.retryCount++
            const retryDelay = Math.min(500 * Math.pow(2, retryState.retryCount - 1), 5000) // Exponential backoff, max 5s

            logger.warn('websocket.error.app_not_found.retry', {
              message: 'App not found, will retry',
              retryCount: retryState.retryCount,
              retryDelay,
              elapsedTime,
              data
            })

            // Clear any existing retry timer
            if (retryState.retryTimer) {
              clearTimeout(retryState.retryTimer)
            }

            // Schedule retry
            retryState.retryTimer = setTimeout(() => {
              logger.info('websocket.error.app_not_found.retrying', {
                message: 'Retrying message after APP_NOT_FOUND error',
                retryCount: retryState.retryCount
              })

              // Re-send the message using the stored pending message
              const { content, aiEditContext } = retryState.pendingMessage!
              const socket = socketRef.current

              if (socket && socket.connected) {
                // Build the same rich context as in sendMessage
                const state = useStreamingConversationStore.getState()
                const { conversations } = state
                const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
                let conversationId = currentConversation?.id

                // If conversationId is null, check cookie and delete it
                if (!conversationId) {
                  conversationId = getConversationIdFromCookie()
                  if (conversationId) {
                    deleteConversationIdCookie()
                  }
                }

                const richContext: AgentsAppContext = {
                  metadata: {
                    appId: currentAppId,
                    userId: 'current-user',
                    sessionId: socket.id
                  },
                  conversation: {
                    conversationId,
                    maxMessages: 10,
                    includeHistory: true
                  },
                  appContext: {
                    includeDirectoryListing: true,
                    includePackageInfo: true,
                    includeDependencyStatus: true,
                    maxDirectoryDepth: 3
                  },
                  ...(aiEditContext && { aiEditContext })
                }

                const chatMessage: AgentsAppChatMessage = {
                  message: content,
                  timestamp: new Date().toISOString(),
                  agentId: 'develop',
                  context: richContext
                }

                socket.emit('chat_message', chatMessage)
              }
            }, retryDelay)
          } else {
            // Not retryable or exceeded retry time - show error
            if (isAppNotFound && elapsedTime >= 30000) {
              logger.error('websocket.error.app_not_found.timeout', {
                message: 'App not found after 30 seconds of retries',
                retryCount: retryState.retryCount,
                elapsedTime
              })
            } else {
              logger.error('websocket.error', { message: 'Socket.IO error', data })
            }

            // Clear retry state
            if (retryState.retryTimer) {
              clearTimeout(retryState.retryTimer)
            }
            retryStateRef.current = { retryCount: 0 }

            markUpstreamError();
            sendToolImpression('error')
            setWebSocketState({ status: 'error', error: data.content })
            setStreamingState('error')
            setIsLoading(false)
          }
          break
        default:
          break
      }
    })
  }, [
    appendTextSegment,
    addToolStartSegment,
    addToolResultSegment,
    addToolCallSegment,
    markMaxStepsReached,
    markUpstreamError,
    finalizeStream,
    setWebSocketState,
    setStreamingState,
    setIsLoading,
    currentAppId,
    handleCommitComplete,
    scheduleToolDeltaFlush,
    flushToolDeltaBufferImmediate,
  ])

  useEffect(() => {
    // Effect intentionally depends ONLY on currentAppId to avoid recreating connection on stable callback identity changes.
    // createConnection & setupEventHandlers are stable (useCallback with static deps) and exclusion prevents unnecessary reconnects.
    if (!currentAppId) return

    const initializeConnection = async () => {
      const initAppId = currentAppId
      try {
        logger.info('websocket.connection.initialize', {
          message: 'Initializing persistent WebSocket connection',
          appId: initAppId
        })

        const socket = await createConnection(initAppId)

        // Check if app changed during async initialization
        const currentState = useStreamingConversationStore.getState()
        if (currentState.currentAppId !== initAppId) {
          logger.info('websocket.connection.abort', {
            message: 'App changed during initialization, aborting socket setup',
            initAppId,
            currentAppId: currentState.currentAppId
          })
          socket.removeAllListeners()
          socket.disconnect()
          return
        }

        socketRef.current = socket
        createdHereRef.current = true // Mark that this instance created the socket

        // Register socket globally for OAuth popup access
        setSharedSocket(socket)

        // Set up event handlers once for the lifetime of this connection
        setupEventHandlers(socket)

        logger.info('websocket.connection.ready', {
          message: 'Persistent WebSocket connection established and ready',
          appId: initAppId,
          socketId: socket.id
        })
      } catch (error) {
        logger.error('websocket.connection.init_failed', {
          message: 'Failed to initialize persistent connection',
          error: error instanceof Error ? error.message : String(error),
          appId: initAppId
        })
      } finally {
        initializingRef.current = false
      }
    }

    // Reuse existing shared socket if available (prevents duplicate connections)
    const existingSocket = getSharedSocket()
    if (existingSocket && !socketRef.current) {
      logger.info('websocket.connection.reuse', {
        message: 'Reusing existing shared socket',
        socketId: existingSocket.id,
        appId: currentAppId
      })
      socketRef.current = existingSocket
      createdHereRef.current = false // We didn't create this socket
      return;
    }
    // Only create connection if we don't have one and not already initializing
    if (!socketRef.current && !initializingRef.current) {
      initializingRef.current = true
      // Delay initialization by 500ms for eliminating race condition during app switch
      initTimerRef.current = setTimeout(() => {
        void initializeConnection()
      }, 500)
    }

    // Cleanup when app changes or component unmounts
    return () => {
      // Clear initialization timer if pending
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current)
        initTimerRef.current = null
        // Reset initialization flag if timer is cleared before initialization
        initializingRef.current = false
      }

      if (socketRef.current) {
        // Only disconnect and clear shared socket if this instance created it
        if (createdHereRef.current && getSharedSocket() === socketRef.current) {
          logger.info('websocket.cleanup', {
            message: 'Cleaning up Socket.IO connection (created by this instance)',
            reason: 'app change or unmount',
            appId: currentAppId
          })

          // Clear shared socket reference
          setSharedSocket(null)

          socketRef.current.removeAllListeners()
          socketRef.current.disconnect()
        } else {
          logger.info('websocket.cleanup.skip', {
            message: 'Not cleaning up socket (reused from shared registry)',
            appId: currentAppId
          })
        }

        socketRef.current = null
        createdHereRef.current = false
      }
      // Reset initialization flag to allow re-initialization with new appId
      initializingRef.current = false
    }
    // Including createConnection & setupEventHandlers satisfies exhaustive-deps; guard prevents duplicate initialization.
  }, [currentAppId, createConnection, setupEventHandlers])

  /**
   * Send message - the main streaming function
   */
  const sendMessage = useCallback(async (
    content: string,
    aiEditContext?: any,
    selectedAsset?: any,
    todoListContext?: any,
    isActionRequest?: boolean
  ) => {
    if (!content.trim() || !currentAppId) return

    try {
      setIsLoading(true)
      setStreamingState('streaming')

      // Store message for potential retry on APP_NOT_FOUND error
      retryStateRef.current = {
        pendingMessage: { content, aiEditContext, startTime: Date.now() },
        retryCount: 0
      }

      // Start new stream (adds user message + creates activeStream)
      startNewStream(content)

      // Reuse existing Socket.IO connection
      const socket = socketRef.current

      if (!socket) {
        throw new Error('WebSocket connection not initialized. Please wait for connection to establish.')
      }

      if (!socket.connected) {
        throw new Error('WebSocket not connected. Connection may be reconnecting...')
      }

      logger.info('websocket.message.send', {
        message: 'Sending Socket.IO message using existing connection',
        appId: currentAppId,
        socketId: socket.id
      })

      // Get current state for rich context
      const state = useStreamingConversationStore.getState()
      const { conversations, buildErrorContext } = state

      // Find current conversation ID
      const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
      let conversationId = currentConversation?.id

      // If conversationId is null, check cookie and delete it
      if (!conversationId) {
        conversationId = getConversationIdFromCookie()
        if (conversationId) {
          deleteConversationIdCookie()
        }
      }

      // Capture visual context from iframe
      const visualContext = await captureVisualContext()

      // Transform selected asset to include https protocol
      const transformedAsset = selectedAsset ? {
        ...selectedAsset,
        imageUrl: selectedAsset.imageUrl.startsWith('//')
          ? `https:${selectedAsset.imageUrl}`
          : selectedAsset.imageUrl,
        ...(selectedAsset.thumbnailUrl && {
          thumbnailUrl: selectedAsset.thumbnailUrl.startsWith('//')
            ? `https:${selectedAsset.thumbnailUrl}`
            : selectedAsset.thumbnailUrl
        }),
        ...(selectedAsset.videoUrl && {
          videoUrl: selectedAsset.videoUrl.startsWith('//')
            ? `https:${selectedAsset.videoUrl}`
            : selectedAsset.videoUrl
        })
      } : null

      // Build context attachments array using new framework
      const contextAttachments: any[] = []

      // Add AI Edit context as attachment (persisted)
      if (aiEditContext) {
        contextAttachments.push({
          type: 'ai_edit_context',
          data: aiEditContext,
          persistence: 'save',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'ai-edit-dialog'
          }
        })
      }

      // Add Visual context as attachment (ephemeral)
      if (visualContext) {
        contextAttachments.push({
          type: 'visual_context',
          data: visualContext,
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'iframe-capture'
          }
        })
      }

      // Add Selected Assets as attachment (ephemeral)
      if (transformedAsset) {
        contextAttachments.push({
          type: 'selected_assets',
          data: [transformedAsset],
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'asset-manager'
          }
        })
      }

      // Add Build Error as attachment (ephemeral - from publish failures)
      if (buildErrorContext) {
        contextAttachments.push({
          type: 'build_error',
          data: {
            error: buildErrorContext.error,
            details: buildErrorContext.details,
            exitCode: buildErrorContext.exitCode
          },
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'publish-failure'
          }
        })
      }

      if(todoListContext) {
        contextAttachments.push({
          type: 'todo_list_context',
          data: todoListContext,
          persistence: 'save',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'todo-list-tool'
          }
        })
      }

      // Add action request context when user selects a suggested response
      if (isActionRequest) {
        contextAttachments.push({
          type: 'action_request',
          data: { instruction: '[Action Request] Execute this request immediately. Do not summarize previous work.' },
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'suggested_response'
          }
        })
      }

      // Build rich context object with proper typing
      const richContext: AgentsAppContext = {
        // Basic metadata
        metadata: {
          appId: currentAppId,
          userId: 'current-user', // TODO: Get from auth context
          sessionId: socket.id
        },

        // Conversation context
        conversation: {
          conversationId,
          maxMessages: 10,
          includeHistory: true
        },

        // App context - enable rich project understanding
        appContext: {
          includeDirectoryListing: true,
          includePackageInfo: true,
          includeDependencyStatus: true,
          maxDirectoryDepth: 3
        },

        // Generic context attachments (new framework)
        ...(contextAttachments.length > 0 && { contextAttachments }),
      }

      // Send the message to start streaming with rich context
      const chatMessage: AgentsAppChatMessage = {
        message: content,
        timestamp: new Date().toISOString(),
        agentId: 'develop', // Default agent
        context: richContext
      }

      // Use Socket.IO acknowledgement for delivery confirmation
      socket.emit('chat_message', chatMessage, (response: any) => {
        if (response?.status === 'ok') {
          logger.info('websocket.message.acknowledged', {
            message: 'Message delivery confirmed by server',
            messageLength: content.length
          })
        } else if (response?.error) {
          logger.error('websocket.message.ack_error', {
            message: 'Server rejected message',
            error: response.error
          })
        }
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('websocket.message.failure', { message: 'Failed to send message', error: errorMessage })

      setWebSocketState({
        status: 'error',
        error: errorMessage
      })
      setStreamingState('error')
      setIsLoading(false)
    }
  }, [
    currentAppId,
    startNewStream,
    setIsLoading,
    setStreamingState,
    setWebSocketState,
  ])

  return {
    sendMessage,
    webSocketState,
    isConnected: webSocketState.connected,
    isStreaming: webSocketState.status === 'streaming'
  }
}
