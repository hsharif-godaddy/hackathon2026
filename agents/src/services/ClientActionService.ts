/**
 * Client Action Service
 *
 * Enables agents to trigger client-side actions through WebSocket events.
 * This service emits client_action events and waits for client_action_result responses.
 */

import { EventEmitter } from 'events'
import crypto from 'node:crypto'
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
}

/**
 * Service for executing client-side actions via WebSocket
 */
export class ClientActionService {
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: ClientActionResult) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()
  private boundHandler: (data: any) => void

  constructor(
    private socket: Socket,
    private conversationId: string
  ) {
    // Store bound handler for proper cleanup
    this.boundHandler = this.handleClientActionResult.bind(this)
    // Listen for client_action_result messages
    this.socket.on('client_action_result', this.boundHandler)
  }

  /**
   * Execute a client-side action and wait for the result
   */
  async executeAction(request: ClientActionRequest): Promise<ClientActionResult> {
    const { action, params, timeoutMs = 30000 } = request
    const requestId = crypto.randomUUID()

    logger.info('client-action.execute', {
      action,
      requestId,
      conversationId: this.conversationId,
      params: JSON.stringify(params),
    })

    // Create promise that will be resolved when client responds
    const resultPromise = new Promise<ClientActionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        logger.error('client-action.timeout', {
          action,
          requestId,
          conversationId: this.conversationId,
          timeoutMs,
        })
        reject(new Error(`Client action timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(requestId, { resolve, reject, timeout })
    })

    // Emit client_action event to client
    this.socket.emit('message', {
      type: 'client_action',
      content: `Requesting client to execute: ${action}`,
      data: {
        action,
        params,
        requestId,
        conversationId: this.conversationId,
      },
    })

    return resultPromise
  }

  /**
   * Handle client_action_result from client
   */
  private handleClientActionResult(data: {
    requestId: string
    success: boolean
    result?: unknown
    error?: string
  }): void {
    const { requestId, success, result, error } = data
    const pending = this.pendingRequests.get(requestId)

    if (!pending) {
      logger.warn('client-action.unknown_request_id', {
        requestId,
        conversationId: this.conversationId,
      })
      return
    }

    // Clear timeout
    clearTimeout(pending.timeout)
    this.pendingRequests.delete(requestId)

    // Resolve or reject the promise
    if (success) {
      logger.info('client-action.success', {
        requestId,
        conversationId: this.conversationId,
      })
      pending.resolve({ success: true, result })
    } else {
      logger.error('client-action.error', {
        requestId,
        conversationId: this.conversationId,
        error,
      })
      pending.resolve({ success: false, error: error || 'Unknown error' })
    }
  }

  /**
   * Cleanup when conversation ends
   */
  cleanup(): void {
    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Conversation ended'))
      this.pendingRequests.delete(requestId)
    }

    // Remove socket listener using the same bound reference
    this.socket.off('client_action_result', this.boundHandler)
  }
}
