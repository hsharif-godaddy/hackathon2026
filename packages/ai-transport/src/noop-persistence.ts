/**
 * No-op implementation of ConversationPersistence for tests and examples
 *
 * This implementation provides a minimal persistence layer that:
 * - Stores nothing to a database
 * - Generates conversation IDs locally using crypto.randomUUID()
 * - Allows streaming to work without persistence infrastructure
 *
 * Use this when you need WebSocket functionality without database persistence:
 * - Unit tests
 * - Integration tests
 * - Examples and demos
 * - Prototyping
 *
 * @example
 * ```typescript
 * import { createWebSocketServer, createNoOpPersistence } from '@airo/ai-transport'
 *
 * const wsServer = createWebSocketServer(httpServer, {
 *   agents,
 *   messagePersistence: createNoOpPersistence()
 * })
 * ```
 */

import { randomUUID } from 'node:crypto'
import type {
  ConversationPersistenceWithCleanup,
  PersistenceStreamingEvent,
  ConversationContext
} from './interfaces.js'

/**
 * No-op persistence implementation for tests and examples
 *
 * Does not persist any data - all operations are no-ops
 * Generates conversation IDs locally using crypto.randomUUID()
 */
export class NoOpPersistence implements ConversationPersistenceWithCleanup {
  async startConversation(
    _message: string,
    _context: ConversationContext
  ): Promise<string> {
    // Generate a local conversation ID
    return `noop-${randomUUID()}`
  }

  async continueConversation(
    _conversationId: string,
    _message: string,
    _context: ConversationContext
  ): Promise<void> {
    // No-op
  }

  async startAgentTurn(
    _conversationId: string,
    _context: ConversationContext
  ): Promise<string> {
    // Generate a local message ID
    return `noop-msg-${randomUUID()}`
  }

  async updateAgentTurn(
    _conversationId: string,
    _messageId: string,
    _updates: {
      content?: string
      segments?: any[]
      toolCalls?: any[]
    },
    _context: ConversationContext
  ): Promise<void> {
    // No-op
  }

  async completeConversation(
    _conversationId: string,
    _events: PersistenceStreamingEvent[],
    _result: any,
    _context: ConversationContext
  ): Promise<void> {
    // No-op
  }

  async handleConversationError(
    _conversationId: string,
    _error: Error,
    _message: string,
    _context: ConversationContext
  ): Promise<void> {
    // No-op
  }

  async captureStreamingEvent(
    _conversationId: string,
    _event: PersistenceStreamingEvent,
    _context: ConversationContext
  ): Promise<void> {
    // No-op
  }

  async handleDisconnection(
    _socketId: string,
    _conversationIds: string[]
  ): Promise<void> {
    // No-op
  }
}

/**
 * Factory function to create a no-op persistence instance
 *
 * @returns A new NoOpPersistence instance
 *
 * @example
 * ```typescript
 * const wsServer = createWebSocketServer(httpServer, {
 *   agents,
 *   messagePersistence: createNoOpPersistence()
 * })
 * ```
 */
export function createNoOpPersistence(): ConversationPersistenceWithCleanup {
  return new NoOpPersistence()
}
