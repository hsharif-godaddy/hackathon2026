/**
 * Simplified Retry Utility with Exponential Backoff + optional Full Jitter.
 *
 * Refactored to reduce configuration surface and remove per-attempt callbacks.
 * Only a unified logger interface is supported for structured events.
 */

import { BudgetExceededError, isTransientBadRequest, containsBudgetExceededPattern } from './errors.js'
import { APICallError } from '@ai-sdk/provider'

/**
 * Configuration for retry behavior
 */
export interface RetryOptions {
  /** Total attempts including initial try (default 5) */
  maxAttempts?: number
  /** Base delay before first retry (default 1000ms) */
  baseDelayMs?: number
  /** Exponential growth factor (default 2) */
  factor?: number
  /** Maximum delay cap (default 16000ms) */
  maxDelayMs?: number
  /** Apply full jitter (random 0..delay) (default true) */
  jitter?: boolean
}

/** Default number of retry attempts (initial + retries) */
const DEFAULT_MAX_ATTEMPTS = 5
/** Default base delay in milliseconds before first retry */
const DEFAULT_BASE_DELAY_MS = 1000
/** Default exponential backoff factor */
const DEFAULT_BACKOFF_FACTOR = 2
/** Default maximum delay cap in milliseconds */
const DEFAULT_MAX_DELAY_MS = 16000

/**
 * Default retry configuration
 * - 5 attempts total (initial + 4 retries)
 * - Exponential backoff: 1s, 2s, 4s, 8s, 16s
 * - With jitter: adds randomness to prevent thundering herd
 * - Total max time: ~63 seconds with jitter
 */
export const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  factor: DEFAULT_BACKOFF_FACTOR,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  jitter: true
}
// Backwards compatible legacy constant name (unreleased branch)
export const DEFAULT_RETRY_CONFIG = DEFAULT_RETRY_OPTIONS

/**
 * Error classification for retry logic
 */
export interface RetryDecision {
  retryable: boolean
  category?: 'transient' | 'rate_limit' | 'budget_exceeded' | undefined
  statusCode?: number | undefined
  message: string
  /** Server-suggested retry delay in ms (from retry-after, x-ratelimit-reset-requests, or x-ratelimit-reset-tokens headers) */
  retryAfterMs?: number | undefined
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null
}

/**
 * Parse retry delay from HTTP response headers.
 * Supports standard `retry-after` (seconds or HTTP-date) and
 * LiteLLM's `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens`
 * (ISO timestamp or duration like "1s", "30s").
 * Returns delay in milliseconds, or undefined if no usable header found.
 */
function parseRetryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined

  // Standard retry-after header (case-insensitive lookup)
  const retryAfter = headers['retry-after'] ?? headers['Retry-After']
  if (retryAfter) {
    // Could be seconds (e.g. "30") or an HTTP-date (e.g. "Fri, 31 Dec 2025 23:59:59 GMT")
    const seconds = Number(retryAfter)
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000
    }
    // Try parsing as HTTP-date
    const date = Date.parse(retryAfter)
    if (!Number.isNaN(date)) {
      const delayMs = date - Date.now()
      return delayMs > 0 ? delayMs : undefined
    }
  }

  // LiteLLM x-ratelimit-reset-requests and x-ratelimit-reset-tokens
  // Check both: requests for RPM limits, tokens for TPM limits (common with LLMs)
  const resetRequests = headers['x-ratelimit-reset-requests']
  const resetTokens = headers['x-ratelimit-reset-tokens']
  const resetValue = resetRequests ?? resetTokens
  if (resetValue) {
    // Duration format: "1s", "30s", "1m", etc.
    const durationMatch = resetValue.match(/^(\d+(?:\.\d+)?)(s|ms|m)$/)
    if (durationMatch && durationMatch[1] && durationMatch[2]) {
      const value = parseFloat(durationMatch[1])
      const unit = durationMatch[2]
      if (unit === 'ms') return value
      if (unit === 's') return value * 1000
      if (unit === 'm') return value * 60_000
    }
    // Try as ISO timestamp
    const date = Date.parse(resetValue)
    if (!Number.isNaN(date)) {
      const delayMs = date - Date.now()
      return delayMs > 0 ? delayMs : undefined
    }
  }

  return undefined
}

function classify(error: unknown): RetryDecision {
  // Check for BudgetExceededError first
  if (BudgetExceededError.isInstance(error)) {
    return {
      retryable: false,
      category: 'budget_exceeded',
      statusCode: error.statusCode,
      message: error.responseBody || error.message
    }
  }

  // Check for AI SDK's APICallError for direct access to structured error data
  if (APICallError.isInstance(error)) {
    const message = error.message
    const statusCode = error.statusCode
    const messageLower = message.toLowerCase()
    const retryAfterMs = parseRetryAfterMs(error.responseHeaders)

    // Rate limiting
    if (statusCode === 429 || messageLower.includes('rate limit') || messageLower.includes('too many requests')) {
      return { retryable: true, category: 'rate_limit', statusCode, message, retryAfterMs }
    }

    // Transient server errors and 408 Request Timeout
    if (statusCode === 408 || (statusCode && statusCode >= 500)) {
      return { retryable: true, category: 'transient', statusCode, message, retryAfterMs }
    }

    // Client errors - check for transient 400s before marking as non-retryable
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      // Budget exceeded from raw API response (before normalization to BudgetExceededError)
      // LiteLLM returns 400 for model budgets and 401 for key/team budgets
      if ((statusCode === 400 || statusCode === 401) && error.responseBody && containsBudgetExceededPattern(error.responseBody)) {
        return { retryable: false, category: 'budget_exceeded', statusCode, message }
      }
      // Check if this is a transient 400 that might succeed on retry
      if (statusCode === 400 && isTransientBadRequest(message, error.responseBody)) {
        return { retryable: true, category: 'transient', statusCode, message }
      }
      return { retryable: false, statusCode, message }
    }

    // If no statusCode, honor the SDK's isRetryable flag (e.g., network errors)
    // Otherwise treat as non-retryable
    return {
      retryable: statusCode === undefined ? error.isRetryable : false,
      statusCode,
      message
    }
  }

  // Fall back to manual extraction for non-SDK errors
  const message: string =
    isObject(error) && typeof error.message === 'string'
      ? error.message
      : String(error);

  const statusCode: number | undefined =
    isObject(error) && typeof error.status === 'number'
      ? error.status
      : isObject(error) && typeof error.statusCode === 'number'
        ? error.statusCode
        : isObject(error) && isObject(error.response) && typeof (error.response as Record<string, unknown>).status === 'number'
          ? (error.response as Record<string, unknown>).status as number
          : undefined;
  const errorCode =
    isObject(error) && typeof error.code === 'string'
      ? error.code
      : undefined;
  const name: string =
    isObject(error) && typeof error.name === 'string'
      ? error.name
      : '';

  const messageLower = message.toLowerCase();

  if (statusCode === 429 || messageLower.includes('rate limit') || messageLower.includes('too many requests') || /ThrottlingException/i.test(name)) {
    return { retryable: true, category: 'rate_limit', statusCode, message }
  }

  const networkCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE']
  const transientByName = /TimeoutError|ServiceUnavailableException|OverloadedException|GatewayTimeout|ModelTimeout/i.test(name)
  const timeoutText = /timeout|timed out|socket hang up/i.test(message)
  const statusTransient = statusCode === 408 || (statusCode !== undefined && statusCode >= 500)
  if ((errorCode && networkCodes.includes(errorCode)) || transientByName || timeoutText || statusTransient || messageLower.includes('service unavailable') || messageLower.includes('temporarily unavailable') || messageLower.includes('overloaded')) {
    return { retryable: true, category: 'transient', statusCode, message }
  }

  // Client errors - check for transient 400s before marking as non-retryable
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    if (statusCode === 400 && isTransientBadRequest(message)) {
      return { retryable: true, category: 'transient', statusCode, message }
    }
    return { retryable: false, statusCode, message }
  }
  return { retryable: false, statusCode, message }
}

export function isRetryableError(error: unknown): boolean {
  return classify(error).retryable
}

/**
 * Calculate delay with exponential backoff and optional jitter.
 * If the server provided a retry-after hint, use it (clamped to maxDelayMs)
 * instead of the computed backoff — the server knows its own capacity best.
 */
function computeDelay(retryOrdinal: number, opts: Required<RetryOptions>, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    // Use server-suggested delay, clamped to our max to avoid absurd waits
    const clamped = Math.min(retryAfterMs, opts.maxDelayMs)
    // Add small jitter (10%) even on server-suggested delays to avoid thundering herd
    // when multiple clients get the same retry-after value
    if (!opts.jitter) return Math.round(clamped)
    const jitter = Math.floor(clamped * 0.1 * Math.random())
    return Math.round(clamped + jitter)
  }
  // Fallback: exponential backoff with full jitter
  const raw = Math.min(opts.maxDelayMs, opts.baseDelayMs * Math.pow(opts.factor, retryOrdinal - 1))
  if (!opts.jitter) return raw
  return Math.floor(Math.random() * raw) // full jitter
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

/**
 * Retry metadata attached to errors when retries are exhausted
 */
export interface RetryFailureMeta {
  attempts: number
  elapsedMs: number
  lastMessage: string
  statusCode?: number | undefined
  category?: string | undefined
}

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @param fn - Async function to execute
 * @param config - Retry configuration (optional, uses defaults)
 * @param context - Optional context for logging (e.g., { operation: 'generate', model: 'claude4' })
 * @returns Promise resolving to the function's return value
 * @throws Error with retry metadata when all attempts fail
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   async () => await agent.generate({ messages }),
 *   DEFAULT_RETRY_CONFIG,
 *   { operation: 'generate', model: 'claude4' }
 * )
 * ```
 */
export interface RetryContext {
  operation: 'generate' | 'stream'
  agentName?: string
  modelName?: string
  logger?: {
    info: (event: string, data: unknown) => void
    warn: (event: string, data: unknown) => void
    error: (event: string, data: unknown) => void
  } | undefined
}

export async function retryWithBackoff<T>(fn: () => Promise<T> | T, options: RetryOptions = {}, context: RetryContext): Promise<T> {
  const opts: Required<RetryOptions> = { ...DEFAULT_RETRY_OPTIONS, ...options }
  const start = Date.now()
  let attempt = 1
  while (attempt <= opts.maxAttempts) {
    try {
  const result = await Promise.resolve(fn())
      if (attempt > 1 && context.logger) {
        context.logger.info('llm.api_call.retry_success', {
          attempt,
          elapsedMs: Date.now() - start,
          operation: context.operation,
          agentName: context.agentName,
          modelName: context.modelName
        })
      }
      return result
  } catch (err) {
      const decision = classify(err)
      const isLast = attempt === opts.maxAttempts || !decision.retryable
      if (isLast) {
        const failure: RetryFailureMeta = {
          attempts: attempt,
          elapsedMs: Date.now() - start,
          lastMessage: decision.message,
          statusCode: decision.statusCode,
          category: decision.category
        }
        if (context.logger) {
          context.logger.error('llm.api_call.retry_exhausted', {
            attempt,
            operation: context.operation,
            agentName: context.agentName,
            modelName: context.modelName,
            ...failure
          })
        }
        if (err instanceof Error) {
          // Attach structured retry metadata without suppressing type system broadly
          ;(err as Error & { retryFailureMeta?: RetryFailureMeta }).retryFailureMeta = failure
        }
        throw err
      }
      const nextAttempt = attempt + 1
      const delay = computeDelay(nextAttempt - 1, opts, decision.retryAfterMs)
      if (context.logger) {
        context.logger.warn('llm.api_call.retry', {
          attempt,
          nextAttempt,
          maxAttempts: opts.maxAttempts,
          delayMs: delay,
          ...(decision.retryAfterMs !== undefined && { serverRetryAfterMs: decision.retryAfterMs }),
          category: decision.category,
          statusCode: decision.statusCode,
          message: decision.message,
          elapsedMs: Date.now() - start,
          operation: context.operation,
          agentName: context.agentName,
          modelName: context.modelName
        })
      }
      await sleep(delay)
      attempt = nextAttempt
    }
  }
  throw new Error('Unexpected fallthrough in retry loop')
}

/**
 * Check if an error has retry metadata attached
 */
export type RetryConfig = RetryOptions
export type RetryMetadata = RetryFailureMeta
export function hasRetryMetadata(error: unknown): error is Error & { retryFailureMeta: RetryFailureMeta } {
  return error instanceof Error && 'retryFailureMeta' in error
}
export function getRetryMetadata(error: unknown): RetryFailureMeta | null {
  return hasRetryMetadata(error) ? (error as Error & { retryFailureMeta: RetryFailureMeta }).retryFailureMeta : null
}

/**
 * Check if an error is a budget exceeded error
 * Budget errors are non-retryable and should be surfaced to the user
 *
 * Traverses the .cause chain since AI SDK 6.x wraps fetch errors.
 *
 * @param error - The error to check (including its .cause chain)
 * @returns true if this is a BudgetExceededError
 */
export function isBudgetExceededError(error: unknown): error is BudgetExceededError {
  return BudgetExceededError.isInstance(error)
}

/**
 * Find the BudgetExceededError in an error or its .cause chain
 * Returns the actual BudgetExceededError instance for accessing its properties
 *
 * @param error - The error to search (including its .cause chain)
 * @returns The BudgetExceededError if found, undefined otherwise
 */
export function findBudgetExceededError(error: unknown): BudgetExceededError | undefined {
  return BudgetExceededError.isInstance(error) ? error : undefined
}

/**
 * Classify an error for handling purposes
 * Returns category: 'transient' | 'rate_limit' | 'budget_exceeded' | undefined
 */
export function classifyError(error: unknown): RetryDecision {
  return classify(error)
}
