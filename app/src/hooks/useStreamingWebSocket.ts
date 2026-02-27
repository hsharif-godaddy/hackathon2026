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
import { StreamingWebSocketController } from '@/services/websocket/StreamingWebSocketController'
import { useSitesStore } from '@/stores/useSitesStore'
import {
  useAddToolCallSegment,
  useAddToolResultSegment,
  useAddToolStartSegment,
  useAppendTextSegment,
  useCurrentAppId,
  useFinalizeStream,
  useMarkBudgetExceeded,
  useMarkMaxStepsReached,
  useMarkUpstreamError,
  useSetIsLoading,
  useSetStreamingState,
  useSetWebSocketState,
  useStartNewStream,
  useStreamingConversationStore,
  useWebSocketState,
} from '@/stores/useStreamingConversationStore'
import {
  useGrantContext,
  useToolDeltaBuffer,
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
  const isTransitioningRef = useRef(false)

  const webSocketState = useWebSocketState()
  const currentAppId = useCurrentAppId()

  // Get subscription_id from site store for grant context
  const subscriptionId = useSitesStore((state) => {
    if (!currentAppId) return undefined
    return state.getSite(currentAppId)?.subscription_id
  })

  // Store actions
  const startNewStream = useStartNewStream()
  const appendTextSegment = useAppendTextSegment()
  const addToolStartSegment = useAddToolStartSegment()
  const addToolCallSegment = useAddToolCallSegment()
  const addToolResultSegment = useAddToolResultSegment()
  const markMaxStepsReached = useMarkMaxStepsReached()
  const markUpstreamError = useMarkUpstreamError()
  const markBudgetExceeded = useMarkBudgetExceeded()
  const finalizeStream = useFinalizeStream()
  const setWebSocketState = useSetWebSocketState()
  const setStreamingState = useSetStreamingState()
  const setIsLoading = useSetIsLoading()

  const t = useTranslations()

  // Sub-hooks for focused concerns
  const { toolDeltaBufferRef, scheduleToolDeltaFlush, flushToolDeltaBufferImmediate } = useToolDeltaBuffer()
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
    const store = useStreamingConversationStore.getState() // eslint-disable-line @typescript-eslint/no-unused-vars

    controllerRef.current = new StreamingWebSocketController({
      connectionManager: connectionManagerRef.current,
      messageBuilder: messageBuilderRef.current,
      actions: {
        setWebSocketState,
        setStreamingState,
        setIsLoading,
        startNewStream,
        appendTextSegment,
        addToolStartSegment,
        addToolCallSegment,
        addToolResultSegment,
        markMaxStepsReached,
        markUpstreamError,
        markBudgetExceeded,
        finalizeStream,
        flushToolDeltaBufferImmediate,
        scheduleToolDeltaFlush,
      },
      getHelpers: () => helpersRef.current,
      t,
      toolDeltaBufferRef,
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
  }

  useEffect(() => {
    if (!currentAppId) return

    const controller = controllerRef.current
    if (!controller) return

    const previousAppId = previousAppIdRef.current

    // Handle app switching - disconnect before connecting to new app
    if (previousAppId && previousAppId !== currentAppId) {
      isTransitioningRef.current = true;
      controller.disconnect();
    }

    // Connect to the new app
    void controller.connect(currentAppId).then(() => {
      if (isTransitioningRef.current) {
        isTransitioningRef.current = false;
      }
    });

    previousAppIdRef.current = currentAppId;

    return () => {
      controller.disconnect();
    };
  }, [currentAppId])

  useEffect(() => {
    return () => {
      controllerRef.current?.destroy()
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

      setIsLoading(true)

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
        setIsLoading(false)
      }
    },
    [setIsLoading]
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
