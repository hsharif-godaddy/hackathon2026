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
 * GoCode returns 400 with these patterns in the response body
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
 * Traverse the error .cause chain to find a specific error type
 * AI SDK 6.x wraps errors from custom fetch handlers in .cause property
 *
 * @param error - The error to check (including its .cause chain)
 * @param predicate - Function to check if an error matches the criteria
 * @returns The matching error from the chain, or undefined
 */
function findInCauseChain<T>(
  error: unknown,
  predicate: (e: unknown) => e is T
): T | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>(); // Prevent infinite loops on circular references

  while (current && !seen.has(current)) {
    seen.add(current);
    if (predicate(current)) {
      return current;
    }
    current = isObject(current) ? current.cause : undefined;
  }
  return undefined;
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
   * Also traverses the .cause chain since AI SDK 6.x wraps fetch errors.
   *
   * @param error - The error to check (including its .cause chain)
   * @returns true if the error is a BudgetExceededError
   */
  static isInstance(error: unknown): error is BudgetExceededError {
    return BudgetExceededError.findInChain(error) !== undefined;
  }

  /**
   * Find a BudgetExceededError in the error or its .cause chain
   *
   * AI SDK 6.x wraps errors thrown from custom fetch handlers, storing
   * the original error in the .cause property. This method traverses
   * the chain to find the original BudgetExceededError.
   *
   * @param error - The error to search (including its .cause chain)
   * @returns The BudgetExceededError if found, undefined otherwise
   */
  static findInChain(error: unknown): BudgetExceededError | undefined {
    const isBudgetError = (e: unknown): e is BudgetExceededError =>
      e instanceof BudgetExceededError ||
      (isObject(e) && e.isBudgetExceeded === true);

    return findInCauseChain(error, isBudgetError);
  }
}

/**
 * Extract errorType from an error or its .cause chain
 *
 * AI SDK 6.x wraps errors, so the original errorType property may be
 * buried in the .cause chain. This function traverses the chain to
 * find the first errorType property.
 *
 * @param error - The error to extract errorType from
 * @returns The errorType string if found, undefined otherwise
 */
export function extractErrorType(error: unknown): string | undefined {
  const hasErrorType = (e: unknown): e is { errorType: string } =>
    isObject(e) && typeof e.errorType === 'string';

  return findInCauseChain(error, hasErrorType)?.errorType;
}

/** Return type for extractErrorDetails */
type ErrorDetails = { message: string; statusCode?: number; responseBody?: string };

/**
 * Build an ErrorDetails result, only including optional properties if defined
 */
function buildResult(message: string, statusCode?: unknown, responseBody?: string): ErrorDetails {
  const result: ErrorDetails = { message };
  if (typeof statusCode === 'number') {
    result.statusCode = statusCode;
  }
  if (responseBody !== undefined) {
    result.responseBody = responseBody;
  }
  return result;
}

/**
 * Extract the actual error message from AI SDK wrapped errors
 *
 * AI SDK 6.x wraps API errors in NoOutputGeneratedError with generic messages.
 * The actual error details are often in .responseBody, .data, or .cause properties.
 * This function traverses the error and its cause chain to find meaningful error info.
 *
 * @param error - The error to extract a message from
 * @returns An object with the best available error message and optional status code
 */
export function extractErrorDetails(error: unknown): ErrorDetails {
  let current: unknown = error;
  const seen = new Set<unknown>();

  // Default to the error's own message
  const defaultMessage = error instanceof Error ? error.message : String(error);

  while (current && !seen.has(current)) {
    seen.add(current);

    if (isObject(current)) {
      // Check for our custom APIResponseError (has isAPIResponseError marker)
      if (current.isAPIResponseError === true &&
          typeof current.message === 'string' &&
          typeof current.statusCode === 'number') {
        return buildResult(
          current.message,
          current.statusCode,
          typeof current.responseBody === 'string' ? current.responseBody : undefined
        );
      }

      // Check for responseBody with actual error message (AI SDK pattern)
      if (typeof current.responseBody === 'string' && current.responseBody) {
        try {
          const parsed = JSON.parse(current.responseBody);
          // AWS/Bedrock errors have "Message" field
          if (parsed.Message) {
            return buildResult(parsed.Message, current.statusCode, current.responseBody);
          }
          // GoCode errors might have "error" or "message" field
          if (parsed.error || parsed.message) {
            return buildResult(parsed.error || parsed.message, current.statusCode, current.responseBody);
          }
        } catch {
          // JSON parsing failed - continue to check cause chain
        }
      }

      // Check for data property (some AI SDK errors)
      if (isObject(current.data) && typeof current.data.message === 'string') {
        return buildResult(current.data.message, current.statusCode);
      }

      // Traverse to .cause
      current = current.cause;
    } else {
      break;
    }
  }

  return { message: defaultMessage };
}

/** Return type for analyzeError - all error info extracted in single traversal */
export interface ErrorAnalysis {
  /** Best available error message */
  message: string;
  /** HTTP status code if found */
  statusCode?: number;
  /** Raw response body if found */
  responseBody?: string;
  /** Error type string (e.g., 'BUDGET_EXCEEDED') if found */
  errorType?: string;
  /** BudgetExceededError if found in cause chain */
  budgetError?: BudgetExceededError;
}

/**
 * Analyze an error in a single cause chain traversal
 *
 * Extracts all relevant error information (message, status, type, budget error)
 * in one pass through the cause chain, avoiding multiple traversals.
 *
 * @param error - The error to analyze
 * @returns Complete error analysis with all available details
 */
export function analyzeError(error: unknown): ErrorAnalysis {
  let current: unknown = error;
  const seen = new Set<unknown>();

  const defaultMessage = error instanceof Error ? error.message : String(error);
  let errorType: string | undefined;
  let budgetError: BudgetExceededError | undefined;
  let bestDetails: ErrorDetails | undefined;

  while (current && !seen.has(current)) {
    seen.add(current);

    if (isObject(current)) {
      // Check for BudgetExceededError
      if (!budgetError) {
        if (current instanceof BudgetExceededError) {
          budgetError = current;
          errorType = budgetError.errorType;
        } else if (current.isBudgetExceeded === true) {
          // Duck-typed BudgetExceededError from serialization
          budgetError = current as unknown as BudgetExceededError;
          errorType = typeof current.errorType === 'string' ? current.errorType : undefined;
        }
      }

      // Check for errorType property
      if (!errorType && typeof current.errorType === 'string') {
        errorType = current.errorType;
      }

      // Check for APIResponseError (best details source)
      if (!bestDetails && current.isAPIResponseError === true &&
          typeof current.message === 'string' &&
          typeof current.statusCode === 'number') {
        bestDetails = buildResult(
          current.message,
          current.statusCode,
          typeof current.responseBody === 'string' ? current.responseBody : undefined
        );
      }

      // Check for responseBody with actual error message (AI SDK pattern)
      if (!bestDetails && typeof current.responseBody === 'string' && current.responseBody) {
        try {
          const parsed = JSON.parse(current.responseBody);
          if (parsed.Message) {
            bestDetails = buildResult(parsed.Message, current.statusCode, current.responseBody);
          } else if (parsed.error || parsed.message) {
            bestDetails = buildResult(parsed.error || parsed.message, current.statusCode, current.responseBody);
          }
        } catch {
          // JSON parsing failed - continue to check cause chain
        }
      }

      // Check for data property (some AI SDK errors)
      if (!bestDetails && isObject(current.data) && typeof current.data.message === 'string') {
        bestDetails = buildResult(current.data.message, current.statusCode);
      }

      current = current.cause;
    } else {
      break;
    }
  }

  const result: ErrorAnalysis = {
    message: bestDetails?.message || budgetError?.message || defaultMessage
  };

  const statusCode = bestDetails?.statusCode || budgetError?.statusCode;
  if (statusCode !== undefined) result.statusCode = statusCode;

  const responseBody = bestDetails?.responseBody || budgetError?.responseBody;
  if (responseBody !== undefined) result.responseBody = responseBody;

  const finalErrorType = errorType || budgetError?.errorType;
  if (finalErrorType !== undefined) result.errorType = finalErrorType;

  if (budgetError !== undefined) result.budgetError = budgetError;

  return result;
}

/**
 * Check if an error indicates a budget exceeded condition
 * Looks for budget-related keywords in the error message/responseBody
 *
 * @param error - The error to check
 * @returns true if this appears to be a budget exceeded error
 */
export function isBudgetExceededMessage(error: unknown): boolean {
  const analysis = analyzeError(error);
  return !!analysis.budgetError || containsBudgetExceededPattern(analysis.message + (analysis.responseBody || ''));
}

/**
 * Error thrown when an API call fails with a non-OK response
 *
 * This error preserves the response details (status code, body) so they
 * can be extracted even after the AI SDK wraps the error.
 */
export class APIResponseError extends Error {
  /** HTTP status code */
  readonly statusCode: number;

  /** Raw response body from the API */
  readonly responseBody: string;

  /** Marker property for type checking */
  readonly isAPIResponseError = true as const;

  /**
   * Create an APIResponseError
   *
   * @param message - Human-readable error message
   * @param statusCode - HTTP status code from the API response
   * @param responseBody - Raw response body
   */
  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'APIResponseError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    Error.captureStackTrace?.(this, APIResponseError);
  }

  /**
   * Extract a meaningful message from response body text
   */
  private static extractMessage(statusCode: number, bodyText: string): string {
    let message = `API request failed with status ${statusCode}`;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed.Message) {
        message = parsed.Message;
      } else if (parsed.error) {
        message = typeof parsed.error === 'string' ? parsed.error : parsed.error.message || message;
      } else if (parsed.message) {
        message = parsed.message;
      }
    } catch {
      // Use default message if parsing fails
    }
    return message;
  }

  /**
   * Create an APIResponseError from a Response object
   *
   * @param response - The fetch Response object (will be consumed)
   * @returns A new APIResponseError with details from the response
   */
  static async fromResponse(response: Response): Promise<APIResponseError> {
    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }
    return new APIResponseError(
      APIResponseError.extractMessage(response.status, bodyText),
      response.status,
      bodyText
    );
  }

  /**
   * Create an APIResponseError from already-read body text
   *
   * @param statusCode - HTTP status code
   * @param bodyText - Already-read response body text
   * @returns A new APIResponseError with details from the body
   */
  static fromBodyText(statusCode: number, bodyText: string): APIResponseError {
    return new APIResponseError(
      APIResponseError.extractMessage(statusCode, bodyText),
      statusCode,
      bodyText
    );
  }

  /**
   * Find an APIResponseError in the error or its .cause chain
   *
   * @param error - The error to search
   * @returns The APIResponseError if found, undefined otherwise
   */
  static findInChain(error: unknown): APIResponseError | undefined {
    const isAPIError = (e: unknown): e is APIResponseError =>
      e instanceof APIResponseError ||
      (isObject(e) && e.isAPIResponseError === true);

    return findInCauseChain(error, isAPIError);
  }
}

