/**
 * Message Handler Registry
 *
 * Central dispatcher for WebSocket messages using the Strategy pattern.
 * Replaces massive switch statements with clean, testable handler classes.
 */

import { logger } from '@/lib/request-context'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class MessageHandlerRegistry {
  private handlers = new Map<string, MessageHandler>()

  /**
   * Register a message handler
   * @param handler - Handler to register
   */
  register(handler: MessageHandler): void {
    if (this.handlers.has(handler.type)) {
      logger.warn('websocket.registry.duplicate_handler', {
        type: handler.type,
        message: 'Handler already registered for this type, overwriting'
      })
    }

    this.handlers.set(handler.type, handler)
    logger.debug('websocket.registry.handler_registered', {
      type: handler.type
    })
  }

  /**
   * Dispatch a message to the appropriate handler
   * @param type - Message type
   * @param data - Message data
   * @param context - Message context
   * @param ack - Optional acknowledgement callback
   */
  async dispatch(
    type: string,
    data: WebSocketMessage,
    context: MessageContext,
    ack?: () => void
  ): Promise<void> {
    const handler = this.handlers.get(type)

    if (!handler) {
      logger.warn('websocket.registry.unknown_type', {
        type,
        message: 'No handler registered for this message type'
      })
      return
    }

    try {
      await handler.handle(data, context, ack)
    } catch (error) {
      logger.error('websocket.registry.handler_error', {
        type,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      throw error
    }
  }

  /**
   * Check if a handler is registered for a message type
   * @param type - Message type
   */
  hasHandler(type: string): boolean {
    return this.handlers.has(type)
  }

  /**
   * Get all registered message types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * Clear all registered handlers
   * Useful for testing
   */
  clear(): void {
    this.handlers.clear()
  }
}
