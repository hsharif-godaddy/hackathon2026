/**
 * Client Action Service Contract
 *
 * Transport-neutral types and interface for executing client-side actions.
 * Agents request actions through this contract and await results. The live
 * implementation is `SSEClientActionService` (see `src/server/sse/`).
 */

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
 * Shared surface implemented by the SSE `SSEClientActionService`. Tool code
 * retrieves a service via `getActionService(key)` and only needs these members.
 */
export interface IClientActionService {
  executeAction(request: ClientActionRequest): Promise<ClientActionResult>
  resetTimeout(requestId: string, newTimeoutMs?: number): boolean
  getPendingRequestIds(): string[]
  cleanup(): void
}
