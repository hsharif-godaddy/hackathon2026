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
 * Error thrown when a user exceeds their AI usage budget
 *
 * This error is thrown at the fetch level (in unified-provider.ts) when the
 * GoCode API returns a 400 status with "ExceededBudget" in the response body.
 * We intercept early because the AI SDK wraps errors and loses the original
 * statusCode/responseBody in NoOutputGeneratedError.
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

