import { describe, expect, it } from 'vitest'
import {
  BudgetErrorType,
  BudgetNoCapacityError,
  BudgetNotFoundError,
  BudgetServiceAuthError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
  isBudgetServiceError,
  mapBudgetErrorToResponse,
} from '../errors.js'

describe('mapBudgetErrorToResponse', () => {
  it('maps BudgetServiceUnavailableError to 503 unavailable response', () => {
    const response = mapBudgetErrorToResponse(
      new BudgetServiceUnavailableError('upstream unavailable')
    )

    expect(response).toEqual({
      message: 'Budget service temporarily unavailable',
      errorType: BudgetErrorType.BUDGET_SERVICE_UNAVAILABLE,
      statusCode: 503,
    })
  })

  it('maps BudgetServiceTimeoutError to 503 unavailable response', () => {
    const response = mapBudgetErrorToResponse(
      new BudgetServiceTimeoutError('request timed out')
    )

    expect(response).toEqual({
      message: 'Budget service temporarily unavailable',
      errorType: BudgetErrorType.BUDGET_SERVICE_UNAVAILABLE,
      statusCode: 503,
    })
  })

  it('maps BudgetServiceAuthError with 401 to auth error response with 401', () => {
    const response = mapBudgetErrorToResponse(
      new BudgetServiceAuthError('unauthorized', 401, '{"error":"unauthorized"}')
    )

    expect(response).toEqual({
      message: 'Budget service authentication failed',
      errorType: BudgetErrorType.BUDGET_SERVICE_AUTH_ERROR,
      statusCode: 401,
    })
  })

  it('maps BudgetServiceAuthError with 403 to auth error response preserving 403', () => {
    const response = mapBudgetErrorToResponse(
      new BudgetServiceAuthError('forbidden', 403, '{"error":"forbidden"}')
    )

    expect(response).toEqual({
      message: 'Budget service authentication failed',
      errorType: BudgetErrorType.BUDGET_SERVICE_AUTH_ERROR,
      statusCode: 403,
    })
  })

  it('maps unexpected auth status codes to 401', () => {
    // Non-401/403 status codes should not be passed to BudgetServiceAuthError,
    // but if they are, they map to 401 as a fallback
    const response = mapBudgetErrorToResponse(
      new BudgetServiceAuthError('proxy auth required', 407, '{}')
    )

    expect(response.statusCode).toBe(401)
    expect(response.errorType).toBe(BudgetErrorType.BUDGET_SERVICE_AUTH_ERROR)
  })

  it('maps BudgetNotFoundError to 404 not found response', () => {
    const response = mapBudgetErrorToResponse(
      new BudgetNotFoundError('resource missing', '{"error":"not found"}')
    )

    expect(response).toEqual({
      message: 'Budget resource not found',
      errorType: BudgetErrorType.BUDGET_NOT_FOUND,
      statusCode: 404,
    })
  })

  it('maps generic 5xx BudgetServiceError to sanitized service error response', () => {
    const response = mapBudgetErrorToResponse(
      new BudgetServiceError('internal server error', 502, '/internal/bms/path')
    )

    expect(response).toEqual({
      message: 'Budget service error',
      errorType: BudgetErrorType.BUDGET_SERVICE_ERROR,
      statusCode: 502,
    })
  })

  it('maps generic non-5xx BudgetServiceError to request failed response', () => {
    const response = mapBudgetErrorToResponse(
      new BudgetServiceError('bad request', 400, '/internal/bms/path')
    )

    expect(response).toEqual({
      message: 'Budget service request failed',
      errorType: BudgetErrorType.BUDGET_SERVICE_ERROR,
      statusCode: 400,
    })
  })

  it('maps BudgetNoCapacityError to 402 no capacity response', () => {
    const response = mapBudgetErrorToResponse(
      new BudgetNoCapacityError('Budget Service no capacity: POST /api/v1/sessions', '{"code":"NO_BUDGET_CAPACITY"}')
    )

    expect(response).toEqual({
      message: 'No credits available',
      errorType: BudgetErrorType.BUDGET_NO_CAPACITY,
      statusCode: 402,
    })
  })

  it('defaults statusCode 0 to 500 for defensive fallback', () => {
    // statusCode 0 is only used by Unavailable/Timeout errors (handled in earlier branches)
    // Using || ensures defensive fallback to 500 if branch ordering ever changes
    const response = mapBudgetErrorToResponse(
      new BudgetServiceError('unknown failure', 0, '')
    )

    expect(response).toEqual({
      message: 'Budget service error',
      errorType: BudgetErrorType.BUDGET_SERVICE_ERROR,
      statusCode: 500,
    })
  })
})

describe('isBudgetServiceError', () => {
  it('returns true for BudgetServiceError instances', () => {
    expect(isBudgetServiceError(new BudgetServiceError('failure', 500, 'body'))).toBe(true)
  })

  it('returns true for BudgetServiceError subclasses', () => {
    expect(isBudgetServiceError(new BudgetServiceTimeoutError('timeout'))).toBe(true)
    expect(isBudgetServiceError(new BudgetServiceUnavailableError('unavailable'))).toBe(true)
    expect(isBudgetServiceError(new BudgetServiceAuthError('auth', 401, ''))).toBe(true)
    expect(isBudgetServiceError(new BudgetNotFoundError('not found', ''))).toBe(true)
    expect(isBudgetServiceError(new BudgetNoCapacityError('no capacity', ''))).toBe(true)
  })

  it('returns false for non-BudgetServiceError values', () => {
    expect(isBudgetServiceError(new Error('plain error'))).toBe(false)
    expect(isBudgetServiceError({ message: 'failure', statusCode: 500, responseBody: '' })).toBe(false)
    expect(isBudgetServiceError(null)).toBe(false)
    expect(isBudgetServiceError(undefined)).toBe(false)
    expect(isBudgetServiceError('string')).toBe(false)
  })
})
