/**
 * Streaming WebSocket Hook
 *
 * React adapter for StreamingWebSocketController.
 * Wires controller events to React state and provides a clean sendMessage API.
 */

import { useCallback, useEffect, useRef } from 'react'

import type { AssetManagerItem } from '@/app/develop/components/chat/AssetTypes'
import type { VisualContext } from '@/app/develop/components/visualContextCapture'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import {
  toWebSocketError,
  WebSocketError,
  WebSocketErrorCode
} from '@/lib/websocket-errors'
import type {
  AIEditContext,
  CustomContext,
  TodoContext,
} from '@/services/websocket/ChatMessageBuilder'
import { ChatMessageBuilder } from '@/services/websocket/ChatMessageBuilder'
import { ConnectionManager } from '@/services/websocket/ConnectionManager'
import { clearController, setController } from '@/services/websocket/controllerRegistry'
import {
  bufferStoreUpdate,
  bufferTextChunk,
  clearStoreUpdateBuffer,
  flushStoreUpdateBufferImmediate,
} from '@/services/websocket/storeUpdateBuffer'
import { StreamingWebSocketController } from '@/services/websocket/StreamingWebSocketController'
import {
  clearToolDeltaBuffer,
  flushToolDeltaBufferImmediate,
  getToolDeltaBuffer,
  scheduleToolDeltaFlush,
} from '@/services/websocket/toolDeltaBuffer'
import { useSitesStore } from '@/stores/useSitesStore'
import {
  useCurrentAppId,
  useStreamingConversationStore,
  useWebSocketState,
} from '@/stores/useStreamingConversationStore'
import {
  useGrantContext,
  useWebSocketHelpers,
} from './websocket'
import { useBudgetUpdate } from './websocket/useBudgetUpdate'
import {
  clearConversationIdCookie,
  getConversationIdFromCookie,
  setConversationIdCookie,
} from './websocket/useWebSocketHelpers'
import { captureVisualContext } from '../app/develop/components/visualContextCapture'

/**
 * Options for sending a message through the WebSocket
 */
export interface SendMessageOptions {
  /** The message content (required) */
  content: string

  /** Visual context captured from iframe preview */
  visualContext?: VisualContext | null

  /** AI edit context for code modifications */
  aiEditContext?: AIEditContext | null

  /** Selected assets (images/videos) to attach */
  selectedAssets?: AssetManagerItem[]

  /** TODO list context for planning */
  todoListContext?: TodoContext

  /** Whether this is an action request (vs conversational) */
  isActionRequest?: boolean

  /** Custom context for extensions */
  customContext?: CustomContext

  /** Template ID for custom initial agent prompts */
  templateId?: string
}

/**
 * Return type for useStreamingWebSocket hook
 * Organized into semantic groups for better DX
 */
export interface UseStreamingWebSocketReturn {
  /** Core actions for interacting with the WebSocket */
  actions: {
    /** Send a message to the agent */
    send: (options: SendMessageOptions) => Promise<void>
    /** Stop the current generation */
    stop: () => void
    /** Load more history messages */
    loadMore: (params: { cursor: string; limit?: number }) => boolean
  }

  /** WebSocket connection state */
  connection: {
    /** Whether the WebSocket is connected */
    isConnected: boolean
    /** Current connection status */
    status: 'idle' | 'connecting' | 'authenticating' | 'streaming' | 'completing' | 'error'
    /** Connection error if any */
    error?: unknown
  }

  /** Streaming state */
  stream: {
    /** Whether actively streaming a response */
    isStreaming: boolean
  }
}

export function useStreamingWebSocket() {
  const controllerRef = useRef<StreamingWebSocketController | null>(null)
  const connectionManagerRef = useRef<ConnectionManager | null>(null)
  const messageBuilderRef = useRef<ChatMessageBuilder | null>(null)
  const previousAppIdRef = useRef<string | null>(null)

  const webSocketState = useWebSocketState()
  const currentAppId = useCurrentAppId()

  // Get subscription_id from site store for grant context
  const subscriptionId = useSitesStore((state) => {
    if (!currentAppId) return undefined
    return state.getSite(currentAppId)?.subscription_id
  })

  const { data: isBudgetServiceEnabled = false } = useSwitchboard('app-builder-budget-service')

  const t = useTranslations()

  // Sub-hooks for focused concerns
  const { clearStoredSocketId, handleCommitComplete, sendToolImpression } = useWebSocketHelpers(currentAppId)

  // Store helpers in ref so controller always has latest versions (fixes stale closure bug)
  const helpersRef = useRef({
    clearStoredSocketId,
    handleCommitComplete,
    sendToolImpression,
    setConversationIdCookie,
    clearConversationIdCookie,
    getConversationIdFromCookie,
  })

  // Update helpers ref every render to track currentAppId changes
  helpersRef.current = {
    clearStoredSocketId,
    handleCommitComplete,
    sendToolImpression,
    setConversationIdCookie,
    clearConversationIdCookie,
    getConversationIdFromCookie,
  }

  // Initialize services once
  if (!connectionManagerRef.current) {
    connectionManagerRef.current = new ConnectionManager({
      getConversationId: (appId: string) => getConversationIdFromCookie(appId),
    })
  }

  if (!messageBuilderRef.current) {
    messageBuilderRef.current = new ChatMessageBuilder()
  }

  if (!controllerRef.current) {
    controllerRef.current = new StreamingWebSocketController({
      connectionManager: connectionManagerRef.current,
      messageBuilder: messageBuilderRef.current,
      getActions: () => {
        const state = useStreamingConversationStore.getState()
        return {
          setWebSocketState: state.setWebSocketState,
          setStreamingState: state.setStreamingState,
          setIsLoading: state.setIsLoading,
          startNewStream: state.startNewStream,
          // Hot-path actions buffered via RAF to avoid React Error #185
          appendTextSegment: (content: string) => bufferTextChunk(content),
          addToolStartSegment: (tc: Parameters<typeof state.addToolStartSegment>[0]) =>
            bufferStoreUpdate(() => state.addToolStartSegment(tc)),
          addToolCallSegment: (tc: Parameters<typeof state.addToolCallSegment>[0]) =>
            bufferStoreUpdate(() => state.addToolCallSegment(tc)),
          addToolResultSegment: (tc: Parameters<typeof state.addToolResultSegment>[0]) =>
            bufferStoreUpdate(() => state.addToolResultSegment(tc)),
          markMaxStepsReached: state.markMaxStepsReached,
          markUpstreamError: state.markUpstreamError,
          markBudgetExceeded: state.markBudgetExceeded,
          finalizeStream: state.finalizeStream,
          flushToolDeltaBufferImmediate: () => {
            flushToolDeltaBufferImmediate()
            flushStoreUpdateBufferImmediate()
          },
          scheduleToolDeltaFlush,
        }
      },
      getHelpers: () => helpersRef.current,
      t,
      toolDeltaBufferRef: { current: getToolDeltaBuffer() },
      getStoreState: () => {
        const state = useStreamingConversationStore.getState()
        return {
          streamingState: state.streamingState,
          activeStream: state.activeStream,
          buildErrorContext: state.buildErrorContext,
          connectionRetry: state.connectionRetry,
          // Lifecycle actions (Tier 1)
          setWebSocketState: state.setWebSocketState,
          setStreamingState: state.setStreamingState,
          setIsLoading: state.setIsLoading,
          markUpstreamError: state.markUpstreamError,
          finalizeStream: state.finalizeStream,
          startStream: state.startStream,
          setError: state.setError,
          setRecoveryState: state.setRecoveryState,
          setRetryState: state.setRetryState,
          // Application-level actions
          startConnectionRetry: state.startConnectionRetry,
          clearConnectionRetry: state.clearConnectionRetry,
          setEscalationTimeout: state.setEscalationTimeout,
        }
      },
    })
    setController(controllerRef.current, currentAppId ?? null)
  }

  useEffect(() => {
    if (!currentAppId) return

    const controller = controllerRef.current
    if (!controller) return

    const previousAppId = previousAppIdRef.current

    // Handle app switching - discard stale buffers and disconnect before connecting to new app
    // We clear (not flush) to prevent data from the old app bleeding into the new app's store
    if (previousAppId && previousAppId !== currentAppId) {
      clearToolDeltaBuffer()
      clearStoreUpdateBuffer()
      controller.disconnect();
    }

    // Connect to the new app
    void controller.connect(currentAppId);

    previousAppIdRef.current = currentAppId;

    return () => {
      controller.disconnect();
    };
  }, [currentAppId])

  useEffect(() => {
    return () => {
      controllerRef.current?.destroy()
      controllerRef.current = null
      clearController()
    }
  }, [])

  // Synchronize grant context with agent via controller interface
  // Disabled when budget-service flag is ON to avoid unnecessary grant API calls
  useGrantContext({
    controller: controllerRef.current,
    subscriptionId,
    isConnected: webSocketState.connected,
    enabled: !isBudgetServiceEnabled,
  })

  // Listen for budget_update WS events and update query cache
  useBudgetUpdate({
    controller: controllerRef.current,
    subscriptionId,
    enabled: isBudgetServiceEnabled,
  })



  /**
   * Send message - the main streaming function
   *
   * This function has a STABLE reference across renders. It is SAFE to use in
   * useEffect dependency arrays without causing infinite loops or duplicate sends.
   *
   * @example
   * sendMessage({
   *   content: 'Build a login page',
   *   selectedAssets: [asset1, asset2],
   *   aiEditContext: editContext
   * })
   */
  const sendMessage = useCallback(
    async (options: SendMessageOptions) => {
      const controller = controllerRef.current
      const { currentAppId: activeAppId } = useStreamingConversationStore.getState()

      // Validate preconditions
      if (!controller) {
        const error = new WebSocketError(WebSocketErrorCode.SOCKET_NOT_INITIALIZED, {
          context: { appId: activeAppId }
        })
        logger.error('websocket.send_message.no_controller', error.toLogObject())
        return
      }

      if (!options.content?.trim()) {
        const error = new WebSocketError(WebSocketErrorCode.MESSAGE_EMPTY, {
          context: { appId: activeAppId }
        })
        logger.error('websocket.send_message.empty_content', error.toLogObject())
        return
      }

      if (!activeAppId) {
        const error = new WebSocketError(WebSocketErrorCode.APP_ID_MISSING)
        logger.error('websocket.send_message.no_app_id', error.toLogObject())
        return
      }

      useStreamingConversationStore.getState().setIsLoading(true)

      // Capture visual context from iframe (with error handling)
      // Only capture if not explicitly provided
      let visualContext: VisualContext | null = options.visualContext ?? null
      if (options.visualContext === undefined) {
        try {
          visualContext = await captureVisualContext()
        } catch (error) {
          // Convert to structured error but don't fail - visual context is optional
          const wsError = toWebSocketError(
            error,
            WebSocketErrorCode.VISUAL_CONTEXT_CAPTURE_FAILED,
            { appId: activeAppId }
          )
          logger.warn('websocket.visual_context.capture_failed', wsError.toLogObject())
        }
      }

      try {
        await controller.sendMessage({
          content: options.content,
          visualContext,
          aiEditContext: options.aiEditContext ?? undefined,
          selectedAssets: options.selectedAssets,
          todoListContext: options.todoListContext,
          isActionRequest: options.isActionRequest,
          customContext: options.customContext,
          templateId: options.templateId,
        })
      } catch (error) {
        // Convert to structured error with context
        const wsError = toWebSocketError(
          error,
          WebSocketErrorCode.MESSAGE_SEND_FAILED,
          {
            appId: activeAppId,
            messageLength: options.content.length,
            hasVisualContext: Boolean(visualContext),
            hasAiEditContext: Boolean(options.aiEditContext),
            hasAssets: Boolean(options.selectedAssets?.length),
          }
        )
        logger.error('websocket.send_message.invoke_failed', wsError.toLogObject())
        useStreamingConversationStore.getState().setIsLoading(false)
      }
    },
    []
  )

  /**
   * Stop generation - abort the current agent turn
   */
  const stopGeneration = useCallback(() => {
    controllerRef.current?.stopGeneration()
  }, [])

  /**
   * Emits load_history. Without cursor: initial load. With cursor: pagination.
   * Returns true if the request was sent, false if not connected.
   */
  const loadHistory = useCallback(
    (params: { cursor?: string; limit?: number } = {}): boolean => {
      const controller = controllerRef.current
      if (!controller) {
        return false
      }
      return controller.loadHistory(params)
    },
    []
  )

  return {
    actions: {
      send: sendMessage,
      stop: stopGeneration,
      loadHistory
    },
    connection: {
      isConnected: webSocketState.connected,
      status: webSocketState.status,
      error: webSocketState.error
    },
    stream: {
      isStreaming: webSocketState.status === 'streaming'
    }
  }
}
