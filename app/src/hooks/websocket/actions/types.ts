/**
 * Client Action Types
 *
 * Type definitions for client-side action executors.
 * These actions are triggered by agents via WebSocket and executed in the browser.
 */

import type { DataHandlerContext } from '../handlers/types'

/**
 * Client action executor function
 * Executes a client-side action with parameters and context
 */
export interface ClientActionExecutor {
  (params: Record<string, unknown>, context: DataHandlerContext): Promise<unknown>
}

/**
 * Result of a client action execution
 */
export interface ClientActionResult {
  success: boolean
  result?: unknown
  error?: string
}
