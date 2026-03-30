/**
 * Error Handler
 *
 * Handles error messages from the server.
 * Manages different error types with specific handling:
 * - TOOL_VALIDATION_ERROR: Non-terminal, backend auto-retries
 * - BUDGET_EXCEEDED: Show immediately, no retry
 * - APP_NOT_FOUND: Retry with exponential backoff up to 30s
 * - Other errors: Mark as error and finalize
 */

import type { AgentsAppChatMessage, AgentsAppContext } from '@airo/shared/websocket'

import { logger } from '@/lib/request-context'
import { logImpressionEvent } from '@/utils/instrumentation'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ErrorHandler implements MessageHandler {
  readonly type = 'error'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    // Flush any buffered tool deltas
    context.actions.flushToolDeltaBufferImmediate()

    // Extract error metadata
    const errorType = data.data?.errorType as string | undefined
    const errorCode = data.data?.statusCode as number | undefined
    const errorTimestamp = data.data?.timestamp as string | undefined
    const retryAttempts = data.data?.retryAttempts as number | undefined
    const retryReason = data.data?.retryReason as string | undefined
    const isBudgetError = errorType === 'BUDGET_EXCEEDED'
    const isAppNotFound = errorType === 'APP_NOT_FOUND'
    const isToolValidationError = errorType === 'TOOL_VALIDATION_ERROR'

    // Handle tool validation errors - non-terminal, backend auto-retries
    if (isToolValidationError) {
      logger.info('websocket.error.tool_validation', {
        message: 'Tool validation error - agent will retry',
        content: data.content,
        details: data.data?.details,
      })
      // Continue streaming - don't mark as error since backend retries
      return
    }

    // Handle budget exceeded errors - show immediately, no retry
    if (isBudgetError) {
      this.handleBudgetExceeded(data, context)
      return
    }

    // Handle APP_NOT_FOUND with retry logic
    const retryState = context.refs.retryState.current
    const elapsedTime = retryState.pendingMessage
      ? Date.now() - retryState.pendingMessage.startTime
      : 0
    const shouldRetry = isAppNotFound && elapsedTime < 30000 // Retry for up to 30 seconds

    if (shouldRetry && retryState.pendingMessage) {
      this.handleAppNotFoundRetry(data, context, retryState, elapsedTime)
    } else {
      // Not retryable or exceeded retry time - show error
      this.handleTerminalError(
        data,
        context,
        isAppNotFound,
        elapsedTime,
        retryState,
        errorType,
        errorCode,
        errorTimestamp,
        retryAttempts,
        retryReason
      )
    }
  }

  /**
   * Handle BUDGET_EXCEEDED errors
   */
  private handleBudgetExceeded(
    data: WebSocketMessage,
    context: LifecycleHandlerContext,
  ): void {
    logger.warn('websocket.error.budget_exceeded', {
      message: 'Budget exceeded error received',
      content: data.content,
    })

    logImpressionEvent('credits.budget.exceeded')()

    context.machine.send({
      type: 'STREAM_ERROR',
      error: new Error(data.content),
      retryable: false
    })

    context.helpers.clearRetryState()
    context.actions.markBudgetExceeded()
    context.actions.finalizeStream({
      agentId: data.data?.agentId as string | undefined,
      totalSteps: data.data?.step as number | undefined,
    })
    context.helpers.sendToolImpression('error')

    context.refs.pendingRecoveryAck.current = null
  }

  /**
   * Handle APP_NOT_FOUND with retry logic
   */
  private handleAppNotFoundRetry(
    data: WebSocketMessage,
    context: LifecycleHandlerContext,
    retryState: {
      pendingMessage?: { chatMessage: any; startTime: number }
      retryCount: number
      retryTimer?: NodeJS.Timeout
    },
    elapsedTime: number
  ): void {
    retryState.retryCount++
    const retryDelay = Math.min(500 * Math.pow(2, retryState.retryCount - 1), 5000) // Exponential backoff, max 5s

    // Send STREAM_ERROR event to machine (retryable)
    context.machine.send({
      type: 'STREAM_ERROR',
      error: new Error(data.content),
      retryable: true
    })

    logger.warn('websocket.error.app_not_found.retry', {
      message: 'App not found, will retry',
      retryCount: retryState.retryCount,
      retryDelay,
      elapsedTime,
      data,
    })

    // Clear any existing retry timer
    if (retryState.retryTimer) {
      clearTimeout(retryState.retryTimer)
    }

    // Schedule retry
    retryState.retryTimer = setTimeout(() => {
      const pendingMessage = retryState.pendingMessage

      if (context.socket && context.socket.connected && pendingMessage) {
        const messageToSend: AgentsAppChatMessage = {
          ...pendingMessage.chatMessage,
          // Refresh timestamp for retry visibility
          timestamp: new Date().toISOString(),
          context: {
            ...(pendingMessage.chatMessage.context || {}),
            metadata: {
              ...((pendingMessage.chatMessage.context?.metadata as
                | AgentsAppContext['metadata']
                | undefined) || {}),
              appId: context.currentAppId,
              sessionId: context.socket.id,
              userId: 'current-user',
            },
          },
        }

        context.socket.emit('chat_message', messageToSend)
        // Update stored message timestamp for potential subsequent retries
        retryState.pendingMessage = {
          chatMessage: messageToSend,
          startTime: pendingMessage.startTime,
        }
        // Clear timer reference after successful retry to allow proper cleanup in tests
        retryState.retryTimer = undefined
      }
    }, retryDelay)
  }

  /**
   * Handle terminal errors (non-retryable or exceeded retry time)
   */
  private handleTerminalError(
    data: WebSocketMessage,
    context: LifecycleHandlerContext,
    isAppNotFound: boolean,
    elapsedTime: number,
    retryState: {
      retryCount: number
    },
    errorType: string | undefined,
    errorCode: number | undefined,
    errorTimestamp: string | undefined,
    retryAttempts: number | undefined,
    retryReason: string | undefined
  ): void {
    if (isAppNotFound && elapsedTime >= 30000) {
      logger.error('websocket.error.app_not_found.timeout', {
        appId: context.currentAppId,
        message: 'App not found after 30 seconds of retries',
        retryCount: retryState.retryCount,
        elapsedTime,
      })
    } else {
      logger.error('websocket.error', { appId: context.currentAppId, message: 'Socket.IO error', data })
    }

    // Send STREAM_ERROR event to machine (not retryable)
    context.machine.send({
      type: 'STREAM_ERROR',
      error: new Error(data.content),
      retryable: false
    })

    // Clear retry state
    context.helpers.clearRetryState()

    context.actions.markUpstreamError({
      message: data.content,
      type: errorType as 'BUDGET_EXCEEDED' | 'APP_NOT_FOUND' | 'TOOL_VALIDATION_ERROR' | 'UPSTREAM_ERROR' | 'RETRY_ERROR' | 'NETWORK_ERROR' | 'DATA_LOSS' | undefined,
      statusCode: errorCode,
      timestamp: errorTimestamp,
      retryAttempts,
      retryReason,
    })
    context.actions.finalizeStream({
      agentId: data.data?.agentId as string | undefined,
      totalSteps: data.data?.step as number | undefined,
    })
    context.helpers.sendToolImpression('error')

    // Machine handles UI state transitions via STREAM_ERROR event (already sent above)
    // Adapter syncs: setWebSocketState, setStreamingState, setIsLoading

    // Note: We intentionally preserve the stored socket ID for recovery attempts.
    // The server handles stale recovery gracefully.
    context.refs.pendingRecoveryAck.current = null
  }
}
