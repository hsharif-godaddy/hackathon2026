/**
 * App-specific WebSocket context types (agents extensions)
 * Base types come from @airo/shared/websocket
 */

import type { ChatMessage } from '@airo/ai-transport'
import type { AgentsAppContext as BaseAgentsAppContext } from '@airo/shared/websocket'
import type { IClientActionService } from '../services/ClientActionService.js'

/**
 * Agents-specific extension of AgentsAppContext with server-only fields
 */
export interface AgentsAppContext extends BaseAgentsAppContext {
  metadata?: BaseAgentsAppContext['metadata'] & {
    clientActionService?: IClientActionService
    budgetServiceEnabled?: boolean
    subscriptionId?: string
    marketingCampaignsEnabled?: boolean
    asmDualWriteEnabled?: boolean
  }
}

/**
 * Agents-specific ChatMessage with typed context (extends ai-lib ChatMessage)
 */
export interface AgentsAppChatMessage extends Omit<ChatMessage, 'context'> {
  context?: AgentsAppContext
}

/**
 * Type guard to check if context is AgentsAppContext
 */
export function isAgentsAppContext(context: unknown): context is AgentsAppContext {
  return typeof context === 'object' && context !== null
}

/**
 * Helper to safely extract app-specific context from generic context
 */
export function extractAgentsAppContext(context: Record<string, unknown> | undefined): AgentsAppContext | undefined {
  if (!context || !isAgentsAppContext(context)) {
    return undefined
  }
  return context
}
