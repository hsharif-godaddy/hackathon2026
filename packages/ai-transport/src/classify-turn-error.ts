import { APICallError, RetryError, TypeValidationError } from 'ai'
import { BudgetExceededError } from '@airo/ai-common'
import { isBudgetServiceError, mapBudgetErrorToResponse, type BudgetErrorType } from '@airo/shared/budget'
import { AgentNotFoundError } from './agent-execution-loop.js'
import { isNetworkError, isUpstreamTimeoutError } from './analyze-stream-error.js'

/** Canonical set of errorType strings `classifyTurnError` can return.
 * Narrowed over `string` so consumers that branch on the errorType
 * (wire-metadata assembly, Langfuse emission) get compiler help. */
export type TurnErrorType =
  | 'AGENT_NOT_FOUND'
  | 'APP_NOT_FOUND'
  | 'BUDGET_EXCEEDED'
  | 'RETRY_ERROR'
  | 'STREAM_TYPE_VALIDATION'
  | 'CONTENT_FILTERED'
  | 'NETWORK_ERROR'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | BudgetErrorType

/** User-facing fallback messages for upstream-class errors. The client renders
 * its own i18n copy keyed off `errorType`; these are the wire-level fallback
 * (and the value stored as the message's `error` string), so they must already
 * be safe to show — never a raw upstream/proxy string. */
const UPSTREAM_TIMEOUT_MESSAGE =
  'The AI took too long to respond and the request timed out. Please send your message again.'
const NETWORK_ERROR_MESSAGE =
  'A network error interrupted the connection. Please send your message again.'
const UPSTREAM_UNAVAILABLE_MESSAGE =
  'The AI service is temporarily unavailable. Please send your message again.'
const STREAM_VALIDATION_MESSAGE =
  'The AI service returned an unexpected response. Please send your message again.'
const CONTENT_FILTERED_MESSAGE =
  'The AI service could not process this request. Please rephrase your message and try again.'

/** Classify the offending stream chunk behind an AI-SDK `TypeValidationError`.
 * The GoCode/LiteLLM proxy leaks Bedrock exception envelopes as non-Anthropic
 * stream chunks; the dominant shape is a transient `internalServerException`
 * ("Try your request again"), the minority a `validationException` (a content
 * guardrail / request-validation rejection that will not change on retry).
 * Matched against the JSON-serialized value rather than an exact shape so it
 * survives envelope-format drift. */
function describeValidationChunk(value: unknown): 'transient' | 'content' | 'unknown' {
  let serialized: string
  try {
    serialized = (JSON.stringify(value) ?? '').toLowerCase()
  } catch {
    return 'unknown'
  }
  if (serialized.includes('validationexception')) return 'content'
  if (
    serialized.includes('internalserverexception') ||
    serialized.includes('serviceunavailable') ||
    serialized.includes('service unavailable') ||
    serialized.includes('throttlingexception') ||
    serialized.includes('try your request again')
  ) {
    return 'transient'
  }
  return 'unknown'
}

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
    // Upstream proxy enforced its own request-timeout: 408/504. Non-retryable
    // at this point (retryWithBackoff already exhausted), but carries a friendly
    // timeout message and a distinct errorType so the client renders timeout copy.
    if (isUpstreamTimeoutError(error)) {
      return { errorType: 'UPSTREAM_TIMEOUT', ...(statusCode !== undefined && { statusCode }), isRetryable: false, clientMessage: UPSTREAM_TIMEOUT_MESSAGE }
    }
    // 5xx other than 504 (e.g. 500/502/503, including the Akamai-edge 503): the
    // upstream gateway is unavailable. Genuinely retryable.
    if (statusCode !== undefined && statusCode >= 500) {
      return { errorType: 'UPSTREAM_UNAVAILABLE', statusCode, isRetryable: true, clientMessage: UPSTREAM_UNAVAILABLE_MESSAGE }
    }
    // Transport-level failure with no HTTP status (connect/socket timeout, DNS,
    // reset). Surface as NETWORK_ERROR so the client renders connection copy.
    if (statusCode === undefined && isNetworkError(error)) {
      return { errorType: 'NETWORK_ERROR', isRetryable: true, clientMessage: NETWORK_ERROR_MESSAGE }
    }
    return {
      ...(statusCode !== undefined && { statusCode }),
      isRetryable: statusCode === 429,
    }
  }

  // Non-SDK network/socket failure (e.g. a raw undici `TypeError: terminated`
  // or a `UND_ERR_CONNECT_TIMEOUT` that never got wrapped as an APICallError).
  // Without this branch it falls through to a blank-status `{ isRetryable:
  // false }` terminal error with no errorType.
  if (isNetworkError(error)) {
    return { errorType: 'NETWORK_ERROR', isRetryable: true, clientMessage: NETWORK_ERROR_MESSAGE }
  }

  // In-band stream validation failure from the AI SDK provider parser
  // (`@ai-sdk/anthropic` validates each SSE chunk against a
  // `discriminatedUnion("type", ...)`; a chunk whose `type` is not in the
  // pinned schema fails with "No matching discriminator"). This surfaces as a
  // TypeValidationError emitted in-band, which is none of the classes above,
  // so without this branch it falls through to a blank-status terminal error.
  // The offending chunk is logged separately via `analyzeStreamError`'s
  // `validationValue`. 502 = upstream/proxy returned a response we can't parse.
  // We sub-classify the leaked Bedrock envelope: a transient
  // `internalServerException` is retryable (the client auto-resends), whereas a
  // content-guardrail `validationException` is not — retrying re-trips the
  // filter, so the user is asked to rephrase instead.
  if (TypeValidationError.isInstance(error)) {
    const chunkKind: 'transient' | 'content' | 'unknown' = describeValidationChunk(error.value)
    if (chunkKind === 'content') {
      return { errorType: 'CONTENT_FILTERED', statusCode: 502, isRetryable: false, clientMessage: CONTENT_FILTERED_MESSAGE }
    }
    return {
      errorType: 'STREAM_TYPE_VALIDATION',
      statusCode: 502,
      isRetryable: chunkKind === 'transient',
      clientMessage: STREAM_VALIDATION_MESSAGE,
    }
  }

  return { isRetryable: false }
}
