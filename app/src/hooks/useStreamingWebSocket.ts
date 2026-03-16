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
import {
  getActiveHelpers,
  getController,
  getControllerAppId,
  scheduleControllerDestroy,
  setActiveHelpers,
  setController,
  updateControllerAppId,
} from '@/services/websocket/controllerRegistry'
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

  // Keep module-level helpers in sync so a reused controller reads fresh values
  // even when the component-instance helpersRef has been replaced by a remount.
  // Called in the render body (not useEffect) because:
  //   - useEffect(…, []) only fires on mount — helpers rebuild every render with
  //     fresh closures over currentAppId, so empty deps would leave them stale.
  //   - useEffect(…) (no deps) would work but delays the write to commit phase,
  //     and the controller may read helpers during render-phase initialization.
  // This is O(1) and the helpers are stable function refs, so speculative renders
  // in Concurrent Mode would write functionally identical values.
  setActiveHelpers(helpersRef.current)

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
    const existingController = getController()

    if (existingController) {
      controllerRef.current = existingController
      setController(existingController, currentAppId ?? getControllerAppId())
    } else {
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
        getHelpers: () => getActiveHelpers() ?? helpersRef.current,
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
  }

  useEffect(() => {
    updateControllerAppId(currentAppId ?? null)
  }, [currentAppId])

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
      if (controllerRef.current) {
        scheduleControllerDestroy(controllerRef.current)
      }
      controllerRef.current = null
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
