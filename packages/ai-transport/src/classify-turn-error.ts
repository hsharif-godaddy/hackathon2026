import { APICallError, RetryError } from 'ai'
import { BudgetExceededError } from '@airo/ai-common'
import { isBudgetServiceError, mapBudgetErrorToResponse, type BudgetErrorType } from '@airo/shared/budget'
import { AgentNotFoundError } from './agent-execution-loop.js'

/** Canonical set of errorType strings `classifyTurnError` can return.
 * Narrowed over `string` so consumers that branch on the errorType
 * (wire-metadata assembly, Langfuse emission) get compiler help. */
export type TurnErrorType =
  | 'AGENT_NOT_FOUND'
  | 'APP_NOT_FOUND'
  | 'BUDGET_EXCEEDED'
  | 'RETRY_ERROR'
  | BudgetErrorType

/** Result of classifying a turn-terminating error. `isRetryable` is always
 * derivable; other fields are error-class specific. `clientMessage` is
 * populated when the raw `error.message` would leak internal detail
 * (e.g. BMS API paths in budget-service errors) — transports should
 * prefer it over `error.message` when writing to the wire. */
export interface ClassifiedTurnError {
  errorType?: TurnErrorType
  statusCode?: number
  isRetryable: boolean
  retryAttempts?: number
  retryReason?: string
  clientMessage?: string
}

/** Classify a turn-terminating error into the shape both transports emit
 * (wire metadata + Langfuse `emitTurnError`).
 *
 * **No-throw contract:** both transports call this from their outer turn
 * catch, so a throw here would propagate out of the catch and skip the
 * error-publish path (leaving the client hanging). All branches return
 * synchronously; the only remaining hazard is a throwing `instanceof` /
 * duck-type check, which none of these error classes trigger. If you
 * extend the helper, preserve the contract. */
export function classifyTurnError(error: unknown): ClassifiedTurnError {
  if (error instanceof AgentNotFoundError) {
    return { errorType: 'AGENT_NOT_FOUND', statusCode: 500, isRetryable: false }
  }

  if (error instanceof Error && 'errorType' in error && (error as { errorType?: unknown }).errorType === 'APP_NOT_FOUND') {
    return { errorType: 'APP_NOT_FOUND', statusCode: 404, isRetryable: false }
  }

  if (BudgetExceededError.isInstance(error)) {
    return { errorType: 'BUDGET_EXCEEDED', statusCode: error.statusCode, isRetryable: false }
  }

  if (isBudgetServiceError(error)) {
    const response = mapBudgetErrorToResponse(error)
    // BMS transient failures (UNAVAILABLE/timeout map to 503, and generic
    // BUDGET_SERVICE_ERROR at 5xx) should trigger a client retry. Matches
    // the pre-refactor `statusCode === 503 || BUDGET_SERVICE_ERROR && >=500`
    // rail the WS catch used.
    const isTransient5xx = response.statusCode !== undefined && response.statusCode >= 500
    return {
      errorType: response.errorType,
      statusCode: response.statusCode,
      isRetryable: response.errorType === 'BUDGET_SERVICE_UNAVAILABLE' || (response.errorType === 'BUDGET_SERVICE_ERROR' && isTransient5xx),
      clientMessage: response.message,
    }
  }

  if (RetryError.isInstance(error)) {
    return {
      errorType: 'RETRY_ERROR',
      statusCode: 500,
      isRetryable: true,
      retryAttempts: error.errors.length,
      retryReason: error.reason,
    }
  }

  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode
    return {
      ...(statusCode !== undefined && { statusCode }),
      isRetryable: statusCode === 503 || statusCode === 429,
    }
  }

  return { isRetryable: false }
}
