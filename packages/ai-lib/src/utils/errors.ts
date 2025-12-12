/**
 * Custom error types for ai-lib
 *
 * Provides typed error classes for specific error conditions that need
 * special handling throughout the application.
 */

/**
 * Check if a value is a plain object
 */
function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

/**
 * Strings that indicate a budget exceeded error in API responses
 * GoCode/LiteLLM returns 400 with these patterns in the response body
 */
export const BUDGET_EXCEEDED_PATTERNS = ['exceededbudget', 'over budget', 'budget exceeded'] as const;

/**
 * Check if text contains any budget exceeded pattern
 */
export function containsBudgetExceededPattern(text: string): boolean {
  const lower = text.toLowerCase();
  return BUDGET_EXCEEDED_PATTERNS.some(pattern => lower.includes(pattern));
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
