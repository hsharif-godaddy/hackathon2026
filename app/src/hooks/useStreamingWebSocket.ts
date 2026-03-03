/**
 * Streaming WebSocket Hook
 *
 * React adapter for StreamingWebSocketController.
 * Wires controller events to React state and provides a clean sendMessage API.
 */

import { useCallback, useEffect, useRef } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { ChatMessageBuilder } from '@/services/websocket/ChatMessageBuilder'
import { ConnectionManager } from '@/services/websocket/ConnectionManager'
import { clearController, setController } from '@/services/websocket/controllerRegistry'
import { StreamingWebSocketController } from '@/services/websocket/StreamingWebSocketController'
import {
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
import {
  clearConversationIdCookie,
  getConversationIdFromCookie,
  setConversationIdCookie,
} from './websocket/useWebSocketHelpers'
import { captureVisualContext } from '../app/develop/components/visualContextCapture'

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
          appendTextSegment: state.appendTextSegment,
          addToolStartSegment: state.addToolStartSegment,
          addToolCallSegment: state.addToolCallSegment,
          addToolResultSegment: state.addToolResultSegment,
          markMaxStepsReached: state.markMaxStepsReached,
          markUpstreamError: state.markUpstreamError,
          markBudgetExceeded: state.markBudgetExceeded,
          finalizeStream: state.finalizeStream,
          flushToolDeltaBufferImmediate,
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

    // Handle app switching - flush stale tool deltas and disconnect before connecting to new app
    if (previousAppId && previousAppId !== currentAppId) {
      flushToolDeltaBufferImmediate()
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
  useGrantContext({
    controller: controllerRef.current,
    subscriptionId,
    isConnected: webSocketState.connected,
  })


	  /**
	   * Send message - the main streaming function
	   *
	   * This function has a STABLE reference across renders. It is SAFE to use in
	   * useEffect dependency arrays without causing infinite loops or duplicate sends.
	   */
  const sendMessage = useCallback(
    async (
      content: string,
      aiEditContext?: any,
      selectedAssets?: any[],
      todoListContext?: any,
      isActionRequest?: boolean,
      customContext?: any
    ) => {
      const controller = controllerRef.current
      if (!controller) {
        return
      }

      const hasContent = Boolean(content?.trim())
      const { currentAppId: activeAppId } = useStreamingConversationStore.getState()

      if (!hasContent || !activeAppId) {
        return
      }

      useStreamingConversationStore.getState().setIsLoading(true)

      // Capture visual context from iframe (with error handling)
      let visualContext: ReturnType<typeof captureVisualContext> extends Promise<infer T> ? T : never = null
      try {
        visualContext = await captureVisualContext()
      } catch (error) {
        // Log but don't fail - visual context is optional
        logger.warn('websocket.visual_context.capture_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      try {
        await controller.sendMessage({
          content,
          visualContext,
          aiEditContext,
          selectedAssets,
          todoListContext,
          isActionRequest,
          customContext,
        })
      } catch (error) {
        logger.error('websocket.send_message.invoke_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        useStreamingConversationStore.getState().setIsLoading(false)
      }
    },
    []
  )

  /**
   * Load more history messages (pagination)
   * Returns true if the request was sent, false if not connected
   */
  const loadMoreHistory = useCallback(
    (params: { cursor: string; limit?: number }): boolean => {
      const controller = controllerRef.current
      if (!controller) {
        return false
      }
      return controller.loadMoreHistory(params)
    },
    []
  )

  return {
    sendMessage,
    loadMoreHistory,
    webSocketState,
    isConnected: webSocketState.connected,
    isStreaming: webSocketState.status === 'streaming'
  }
}
