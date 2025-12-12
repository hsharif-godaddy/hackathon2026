/**
 * Simplified Retry Utility with Exponential Backoff + optional Full Jitter.
 *
 * Refactored to reduce configuration surface and remove per-attempt callbacks.
 * Only a unified logger interface is supported for structured events.
 */

import { BudgetExceededError } from './errors.js'

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

/**
 * Default retry configuration
 * - 5 attempts total (initial + 4 retries)
 * - Exponential backoff: 1s, 2s, 4s, 8s, 16s
 * - With jitter: adds randomness to prevent thundering herd
 * - Total max time: ~63 seconds with jitter
 */
export const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  factor: 2,
  maxDelayMs: 16000,
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
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null
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

  // Use type guards to safely extract properties from error
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

  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return { retryable: false, statusCode, message }
  }
  return { retryable: false, statusCode, message }
}

export function isRetryableError(error: unknown): boolean {
  return classify(error).retryable
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function computeDelay(retryOrdinal: number, opts: Required<RetryOptions>): number {
  // retryOrdinal: 1 for first retry after initial attempt
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
      const delay = computeDelay(nextAttempt - 1, opts)
      if (context.logger) {
        context.logger.warn('llm.api_call.retry', {
          attempt,
          nextAttempt,
          maxAttempts: opts.maxAttempts,
          delayMs: delay,
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
export interface RetryMetadata extends RetryFailureMeta {}
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
  return BudgetExceededError.findInChain(error)
}

/**
 * Classify an error for handling purposes
 * Returns category: 'transient' | 'rate_limit' | 'budget_exceeded' | undefined
 */
export function classifyError(error: unknown): RetryDecision {
  return classify(error)
}
