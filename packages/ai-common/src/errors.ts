/**
 * Custom error types for ai-lib
 *
 * Provides typed error classes for specific error conditions that need
 * special handling throughout the application.
 */

import { APICallError } from '@ai-sdk/provider'

/**
 * Check if a value is a plain object
 */
function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

/**
 * Strings that indicate a budget exceeded error in API responses.
 * LiteLLM uses several formats:
 *   - "ExceededTokenBudget" / "ExceededBudget" (status 401, key/team budgets)
 *   - "type": "budget_exceeded" (status 400, model budgets)
 *   - "exceeded budget" (general)
 */
export const BUDGET_EXCEEDED_PATTERNS = [
  'exceededbudget',     // matches "ExceededTokenBudget" and "ExceededBudget" (case-insensitive, no-space)
  'budget_exceeded',    // matches JSON type field: "type":"budget_exceeded"
  'exceeded budget',    // matches "exceeded budget for model=..."
  'over budget',
] as const;

/**
 * Check if text contains any budget exceeded pattern
 */
export function containsBudgetExceededPattern(text: string): boolean {
  const lower = text.toLowerCase();
  return BUDGET_EXCEEDED_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Patterns in 400 error messages that indicate non-retryable validation errors.
 * These are specific error conditions where retrying would not help.
 *
 * Observed in:
 * - AI SDK v4.x/v5.x/v6.x (@ai-sdk/provider, @ai-sdk/anthropic, @ai-sdk/openai)
 * - LiteLLM proxy responses
 *
 * Patterns:
 * - toolUse.input: AI SDK tool input validation failure (malformed JSON in tool call)
 * - JSON parsing: JSON syntax error in request/response parsing
 */
export const NON_RETRYABLE_400_PATTERNS = ['toolUse.input', 'JSON parsing'] as const;

/**
 * Check if a 400 Bad Request error is potentially transient and worth retrying.
 *
 * Context: LLM APIs (OpenAI, Claude) sometimes return 400 errors during streaming
 * when clients disconnect mid-request. These are not true validation errors but
 * rather artifacts of the interrupted connection. A retry often succeeds.
 *
 * Transient 400s are retried using the standard retry infrastructure (retry-with-backoff.ts)
 * with the same backoff settings as other transient errors. This is appropriate because:
 * - The retry infrastructure already handles exponential backoff and jitter
 * - Consistent retry behavior across all transient error types
 * - Proper logging and metadata tracking via RetryContext
 *
 * Returns true if the error:
 * - Contains "bad request" in the message (generic 400 indicator)
 * - Does NOT contain known non-retryable validation patterns (toolUse.input, JSON parsing)
 * - Does NOT indicate a budget exceeded error
 *
 * @param message - The error message from the API
 * @param responseBody - Optional response body to check for budget patterns
 * @returns true if the error may be transient and worth retrying
 */
export function isTransientBadRequest(message: string, responseBody?: string): boolean {
  const messageLower = message.toLowerCase();

  // Must be a generic "bad request" error
  if (!messageLower.includes('bad request')) {
    return false;
  }

  // Check for known non-retryable patterns
  const hasNonRetryablePattern = NON_RETRYABLE_400_PATTERNS.some(
    pattern => message.includes(pattern)
  );
  if (hasNonRetryablePattern) {
    return false;
  }

  // Check for budget exceeded in response body
  if (responseBody && containsBudgetExceededPattern(responseBody)) {
    return false;
  }

  return true;
}

/**
 * Safely serialize an error for logging, avoiding circular references
 * and extracting only serializable properties
 *
 * @param error - The error to serialize
 * @returns A plain object with error details that can be safely JSON.stringify'd
 *
 * @example
 * try {
 *   await someOperation();
 * } catch (error) {
 *   logger.error('Operation failed', { error: serializeError(error) });
 * }
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    };

    if (error.stack) {
      serialized.stack = error.stack;
    }

    // Include any additional enumerable properties (like statusCode, etc.)
    // but avoid circular references
    for (const key of Object.keys(error)) {
      if (key !== 'stack' && key !== 'message' && key !== 'name') {
        try {
          const value = (error as any)[key];
          // Only include primitives and simple objects
          if (value !== undefined && value !== null) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              serialized[key] = value;
            } else if (typeof value === 'object') {
              // Try to stringify to detect circular references
              JSON.stringify(value);
              serialized[key] = value;
            }
          }
        } catch {
          // Skip properties that can't be serialized
          serialized[key] = '[Non-serializable]';
        }
      }
    }

    return serialized;
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (isObject(error)) {
    try {
      // Try to serialize the object
      JSON.stringify(error);
      return error;
    } catch {
      // If serialization fails, extract what we can
      return { message: String(error) };
    }
  }

  return { message: String(error) };
}

/**
 * Error thrown when a user exceeds their AI usage budget
 *
 * This error is created from AI SDK's APICallError when we detect a budget
 * exceeded pattern in the response body. It provides a typed error for UI handling.
 */
export class BudgetExceededError extends Error {
  /** HTTP status code (typically 400) */
  readonly statusCode: number;

  /** Raw response body from the API */
  readonly responseBody: string;

  /** Marker property for type checking across module boundaries */
  readonly isBudgetExceeded = true as const;

  /** Error type for frontend handling */
  readonly errorType = 'BUDGET_EXCEEDED' as const;

  /**
   * Create a BudgetExceededError
   *
   * @param message - Human-readable error message
   * @param statusCode - HTTP status code from the API response
   * @param responseBody - Raw response body containing budget details
   */
  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'BudgetExceededError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    // Maintains proper stack trace in V8 environments
    Error.captureStackTrace?.(this, BudgetExceededError);
  }

  /**
   * Type guard to check if an error is a BudgetExceededError
   *
   * Checks both instanceof and duck-typing (isBudgetExceeded property)
   * to handle cases where errors cross module boundaries.
   *
   * @param error - The error to check
   * @returns true if the error is a BudgetExceededError
   */
  static isInstance(error: unknown): error is BudgetExceededError {
    return error instanceof BudgetExceededError ||
      (isObject(error) && error.isBudgetExceeded === true);
  }
}

/**
 * Check if an error is an APICallError with a budget exceeded pattern in the response body.
 * LiteLLM returns budget errors as either 400 (model budgets) or 401 (key/team budgets).
 */
export function isBudgetExceededAPIError(error: unknown): error is APICallError & { responseBody: string } {
  return APICallError.isInstance(error) &&
    (error.statusCode === 400 || error.statusCode === 401) &&
    !!error.responseBody &&
    containsBudgetExceededPattern(error.responseBody)
}

/**
 * Get a user-friendly error message from any error
 * @param error - The error to get a message from
 * @returns A string error message
 */
export function getErrorMessage(error: unknown | undefined): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
