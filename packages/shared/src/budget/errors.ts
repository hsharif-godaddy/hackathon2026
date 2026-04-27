/**
 * Budget service error types for client-facing responses.
 * These are safe to expose — they don't leak internal API details.
 */
export const BudgetErrorType = {
  BUDGET_SERVICE_UNAVAILABLE: 'BUDGET_SERVICE_UNAVAILABLE',
  BUDGET_SERVICE_AUTH_ERROR: 'BUDGET_SERVICE_AUTH_ERROR',
  BUDGET_NOT_FOUND: 'BUDGET_NOT_FOUND',
  BUDGET_SERVICE_ERROR: 'BUDGET_SERVICE_ERROR',
} as const

export type BudgetErrorType = (typeof BudgetErrorType)[keyof typeof BudgetErrorType]

/**
 * Standardized response shape for budget service errors.
 */
export interface BudgetErrorResponse {
  readonly message: string
  readonly errorType: BudgetErrorType
  readonly statusCode: number
}

export class BudgetServiceError extends Error {
  readonly statusCode: number
  readonly responseBody: string

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message)
    this.name = 'BudgetServiceError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}

export class BudgetServiceUnavailableError extends BudgetServiceError {
  constructor(message: string, cause?: Error) {
    super(message, 0, '')
    this.name = 'BudgetServiceUnavailableError'
    if (cause) this.cause = cause
  }
}

export class BudgetServiceAuthError extends BudgetServiceError {
  constructor(message: string, statusCode: number, responseBody: string) {
    super(message, statusCode, responseBody)
    this.name = 'BudgetServiceAuthError'
  }
}

export class BudgetServiceTimeoutError extends BudgetServiceError {
  constructor(message: string, cause?: Error) {
    super(message, 0, '')
    this.name = 'BudgetServiceTimeoutError'
    if (cause) this.cause = cause
  }
}

export class BudgetNotFoundError extends BudgetServiceError {
  constructor(message: string, responseBody: string = '') {
    super(message, 404, responseBody)
    this.name = 'BudgetNotFoundError'
  }
}

/**
 * Maps a BudgetServiceError to a sanitized client-facing response.
 * Prevents raw BMS API paths and internal details from leaking to clients.
 *
 * @param error - Any BudgetServiceError subclass
 * @returns Sanitized response with safe message, error type, and status code
 */
export function mapBudgetErrorToResponse(error: BudgetServiceError): BudgetErrorResponse {
  if (error instanceof BudgetServiceUnavailableError || error instanceof BudgetServiceTimeoutError) {
    return {
      message: 'Budget service temporarily unavailable',
      errorType: BudgetErrorType.BUDGET_SERVICE_UNAVAILABLE,
      statusCode: 503,
    }
  }

  if (error instanceof BudgetServiceAuthError) {
    // Note: BudgetServiceAuthError should only be thrown with 401 or 403.
    // If a non-401/403 status is passed, it maps to 401 (credential error).
    // Callers throwing BudgetServiceAuthError are responsible for constraining status codes.
    return {
      message: 'Budget service authentication failed',
      errorType: BudgetErrorType.BUDGET_SERVICE_AUTH_ERROR,
      statusCode: error.statusCode === 403 ? 403 : 401,
    }
  }

  if (error instanceof BudgetNotFoundError) {
    return {
      message: 'Budget resource not found',
      errorType: BudgetErrorType.BUDGET_NOT_FOUND,
      statusCode: 404,
    }
  }

  // Generic BudgetServiceError — preserve status code, sanitize message
  // Note: statusCode 0 is only used by Unavailable/Timeout errors (handled above),
  // so || 500 is safe here. Using || (not ??) ensures defensive fallback if ordering changes.
  const statusCode = error.statusCode || 500
  if (statusCode >= 500) {
    return {
      message: 'Budget service error',
      errorType: BudgetErrorType.BUDGET_SERVICE_ERROR,
      statusCode,
    }
  }

  return {
    message: 'Budget service request failed',
    errorType: BudgetErrorType.BUDGET_SERVICE_ERROR,
    statusCode,
  }
}

/**
 * Type guard to check if an error is a BudgetServiceError.
 */
export function isBudgetServiceError(error: unknown): error is BudgetServiceError {
  return error instanceof BudgetServiceError
}
/** Thrown when BMS returns 409 Conflict (e.g., report already exists for session). */
export class BudgetServiceConflictError extends BudgetServiceError {
  constructor(message: string, statusCode: number, responseBody: string) {
    super(message, statusCode, responseBody)
    this.name = 'BudgetServiceConflictError'
  }
}
