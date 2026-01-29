/**
 * Client Action Handler
 *
 * Handles client_action messages from the agents service.
 * Executes client-side actions that require browser context or user authentication.
 */

import { logger } from '@/lib/request-context'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'
import { clientActionExecutors } from '../actions'

export class ClientActionHandler implements MessageHandler {
  readonly type = 'client_action'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    // Validate message structure
    if (!data.data || typeof data.data !== 'object') {
      logger.error('websocket.client-action.invalid-message', {
        message: 'Message data is missing or not an object',
        data,
      })
      return
    }

    const { action, params, requestId } = data.data as {
      action: string
      params: Record<string, unknown>
      requestId: string
    }

    // Validate required fields
    if (!action || typeof action !== 'string') {
      logger.error('websocket.client-action.missing-action', {
        message: 'Action is missing or not a string',
        data: data.data,
      })
      return
    }

    if (!requestId || typeof requestId !== 'string') {
      logger.error('websocket.client-action.missing-request-id', {
        message: 'Request ID is missing or not a string',
        action,
        data: data.data,
      })
      return
    }

    logger.info('websocket.client-action.received', {
      action,
      requestId,
      params: JSON.stringify(params),
    })

    // Look up the executor
    const executor = clientActionExecutors[action]
    if (!executor) {
      logger.warn('websocket.client-action.unknown', {
        action,
        requestId,
      })
      await this.sendResult(context, requestId, {
        success: false,
        error: `Unknown action: ${action}`,
      })
      return
    }

    try {
      // Execute the action with full context
      const result = await executor(params, context)

      logger.info('websocket.client-action.success', {
        action,
        requestId,
      })

      await this.sendResult(context, requestId, {
        success: true,
        result,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Extract additional error metadata if available
      const errorDetails = (error as any)?.errorDetails
      const logs = (error as any)?.logs
      const exitCode = (error as any)?.exitCode

      logger.error('websocket.client-action.error', {
        action,
        requestId,
        error: errorMessage,
        hasErrorDetails: !!errorDetails,
        hasLogs: !!logs,
        exitCode,
      })

      await this.sendResult(context, requestId, {
        success: false,
        error: errorMessage,
        errorDetails,
        logs,
        exitCode,
      })
    }
  }

  private async sendResult(
    context: MessageContext,
    requestId: string,
    result: {
      success: boolean
      result?: unknown
      error?: string
      errorDetails?: string
      logs?: Array<{ message: string; source?: string; timestamp?: string }>
      exitCode?: number
    }
  ): Promise<void> {
    context.socket.emit('client_action_result', {
      requestId,
      ...result,
    })
  }
}
