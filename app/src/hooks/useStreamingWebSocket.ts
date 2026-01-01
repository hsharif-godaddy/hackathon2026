/**
 * Streaming WebSocket Hook
 *
 * React adapter for StreamingWebSocketController.
 * Wires controller events to React state and provides a clean sendMessage API.
 */

import { useCallback, useEffect, useRef } from 'react'

import { logger } from '@/lib/request-context'
import { ConnectionManager } from '@/services/websocket/ConnectionManager'
import { ChatMessageBuilder } from '@/services/websocket/ChatMessageBuilder'
import { StreamingWebSocketController } from '@/services/websocket/StreamingWebSocketController'
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
  useToolDeltaBuffer,
  useWebSocketHelpers,
} from './websocket'
import { captureVisualContext } from '../app/develop/components/visualContextCapture'
import {
  getConversationIdFromCookie,
  setConversationIdCookie,
  clearConversationIdCookie,
} from './websocket/useWebSocketHelpers'

export function useStreamingWebSocket() {
  const controllerRef = useRef<StreamingWebSocketController | null>(null)
  const connectionManagerRef = useRef<ConnectionManager | null>(null)
  const messageBuilderRef = useRef<ChatMessageBuilder | null>(null)

  const webSocketState = useWebSocketState()
  const currentAppId = useCurrentAppId()

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
      toolDeltaBufferRef,
      getStoreState: () => useStreamingConversationStore.getState(),
    })
  }

  const controller = controllerRef.current

  // Connect/disconnect on appId change
  useEffect(() => {
    if (!currentAppId) return

    void controller.connect(currentAppId)

    return () => {
      controller.disconnect()
    }
  }, [currentAppId, controller])


  /**
   * Send message - the main streaming function
   */
  const sendMessage = useCallback(
    async (
      content: string,
      aiEditContext?: any,
      selectedAsset?: any,
      todoListContext?: any,
      isActionRequest?: boolean,
      customContext?: any
    ) => {
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

      await controller.sendMessage({
        content,
        visualContext,
        aiEditContext,
        selectedAsset,
        todoListContext,
        isActionRequest,
        customContext,
      })
    },
    [controller]
  )

  return {
    sendMessage,
    webSocketState,
    isConnected: webSocketState.connected,
    isStreaming: webSocketState.status === 'streaming'
  }
}
