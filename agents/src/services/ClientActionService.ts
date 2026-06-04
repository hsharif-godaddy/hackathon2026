/**
 * Client Action Service
 *
 * Enables agents to trigger client-side actions through WebSocket events.
 * This service emits client_action events and waits for client_action_result responses.
 */

import { ClientActionRegistry } from '@airo/ai-transport'
import { logger } from '../logging/index.js'
import type { Socket } from 'socket.io'

export interface ClientActionRequest {
  action: string
  params: Record<string, unknown>
  timeoutMs?: number
}

export interface ClientActionResult {
  success: boolean
  result?: unknown
  error?: string
  errorDetails?: string
  logs?: Array<{ message: string; source?: string; timestamp?: string }>
  exitCode?: number
  requiresUpgrade?: boolean
  reason?: string
}

/**
 * Shared surface implemented by both the WebSocket `ClientActionService`
 * and the HTTP/SSE `SSEClientActionService`. Tool code retrieves a service
 * via `getActionService(key)` and only needs these members.
 */
export interface IClientActionService {
  executeAction(request: ClientActionRequest): Promise<ClientActionResult>
  resetTimeout(requestId: string, newTimeoutMs?: number): boolean
  getPendingRequestIds(): string[]
  cleanup(): void
}

/**
 * Service for executing client-side actions via WebSocket.
 * Delegates to ClientActionRegistry for timeout/pending management.
 */
export class ClientActionService implements IClientActionService {
  private registry: ClientActionRegistry
  private boundHandler: (data: any) => void

  constructor(
    private socket: Socket,
    private conversationId: string
  ) {
    this.registry = new ClientActionRegistry((request) => {
      logger.info('client-action.execute', {
        action: request.action,
        requestId: request.requestId,
        conversationId: this.conversationId,
        params: JSON.stringify(request.params),
      })
      this.socket.emit('message', {
        type: 'client_action',
        content: `Requesting client to execute: ${request.action}`,
        data: {
          action: request.action,
          params: request.params,
          requestId: request.requestId,
          conversationId: this.conversationId,
        },
      })
    }, {
      onTimeout: (requestId, timeoutMs) => {
        logger.error('client-action.timeout', {
          requestId,
          conversationId: this.conversationId,
          timeoutMs,
        })
      },
    })

    this.boundHandler = this.handleClientActionResult.bind(this)
    this.socket.on('client_action_result', this.boundHandler)
  }

  async executeAction(request: ClientActionRequest): Promise<ClientActionResult> {
    return this.registry.executeAction(request)
  }

  private handleClientActionResult(data: {
    requestId: string
    success: boolean
    result?: unknown
    error?: string
    errorDetails?: string
    logs?: Array<{ message: string; source?: string; timestamp?: string }>
    exitCode?: number
    requiresUpgrade?: boolean
    reason?: string
  }): void {
    const { requestId, success, result, error, errorDetails, logs, exitCode, requiresUpgrade, reason } = data

    const actionResult: ClientActionResult = success
      ? { success: true, result }
      : { success: false, error: error || 'Unknown error', errorDetails, logs, exitCode, requiresUpgrade, reason }

    const resolved = this.registry.resolveAction(requestId, actionResult)
    if (!resolved) {
      logger.warn('client-action.unknown_request_id', { requestId, conversationId: this.conversationId })
      return
    }

    if (success) {
      logger.info('client-action.success', { requestId, conversationId: this.conversationId })
    } else {
      logger.error('client-action.error', {
        requestId,
        conversationId: this.conversationId,
        error,
        hasErrorDetails: !!errorDetails,
        hasLogs: !!logs,
        exitCode,
      })
    }
  }

  resetTimeout(requestId: string, newTimeoutMs?: number): boolean {
    return this.registry.resetTimeout(requestId, newTimeoutMs)
  }

  getPendingRequestIds(): string[] {
    return this.registry.getPendingRequestIds()
  }

  cleanup(): void {
    this.registry.cleanup()
    this.socket.off('client_action_result', this.boundHandler)
  }
}
