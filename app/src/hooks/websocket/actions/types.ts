/**
 * Client Action Types
 *
 * Type definitions for client-side action executors.
 * These actions are triggered by agents via WebSocket and executed in the browser.
 */

import type { DataHandlerContext } from '../handlers/types'

/**
 * Client action executor function
 * Executes a client-side action with parameters and context.
 *
 * `requestId` identifies the pending agent-side client action this execution
 * corresponds to. It is optional so executors that don't need it (and older
 * call sites/tests) can ignore it; executors that want to signal the agent
 * mid-execution (e.g. reset the action timeout via `context.resetActionTimeout`)
 * use it to name the pending request.
 */
export interface ClientActionExecutor {
  (params: Record<string, unknown>, context: DataHandlerContext, requestId?: string): Promise<unknown>
}

/**
 * Result of a client action execution
 */
export interface ClientActionResult {
  success: boolean
  result?: unknown
  error?: string
}
