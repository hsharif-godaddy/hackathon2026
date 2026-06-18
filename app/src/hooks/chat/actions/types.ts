/**
 * Client Action Types
 *
 * Type definitions for client-side action executors.
 * These actions are triggered by agents and executed in the browser.
 */

/** Minimal execution context for client actions. Replaces the former DataHandlerContext dependency (AIROBUILD-2631). */
export interface ClientActionContext {
  currentAppId: string
  resetActionTimeout?: (requestId: string) => void
}

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
  (params: Record<string, unknown>, context: ClientActionContext, requestId?: string): Promise<unknown>
}

/**
 * Result of a client action execution
 */
export interface ClientActionResult {
  success: boolean
  result?: unknown
  error?: string
}
