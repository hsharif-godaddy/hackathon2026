import { describe, it, expect } from 'vitest'
import { APICallError, RetryError, TypeValidationError } from 'ai'
import { BudgetExceededError } from '@airo/ai-common'
import {
  BudgetServiceError,
  BudgetServiceUnavailableError,
  BudgetServiceTimeoutError,
  BudgetServiceAuthError,
} from '@airo/shared/budget'
import { classifyTurnError } from '../classify-turn-error.js'
import { AgentNotFoundError } from '../agent-execution-loop.js'

describe('classifyTurnError', () => {
  it('classifies AgentNotFoundError', () => {
    const result = classifyTurnError(new AgentNotFoundError('secret-agent'))
    expect(result).toEqual({
      errorType: 'AGENT_NOT_FOUND',
      statusCode: 500,
      isRetryable: false,
    })
  })

  it('classifies APP_NOT_FOUND via duck-typed errorType field', () => {
    const err = Object.assign(new Error('app gone'), { errorType: 'APP_NOT_FOUND' })
    expect(classifyTurnError(err)).toEqual({
      errorType: 'APP_NOT_FOUND',
      statusCode: 404,
      isRetryable: false,
    })
  })

  it('classifies BudgetExceededError with its statusCode', () => {
    const err = new BudgetExceededError('budget', 402)
    expect(classifyTurnError(err)).toEqual({
      errorType: 'BUDGET_EXCEEDED',
      statusCode: 402,
      isRetryable: false,
    })
  })

  it('classifies RetryError with attempts + reason and isRetryable true', () => {
    const inner = [new Error('a'), new Error('b'), new Error('c')]
    const err = new RetryError({ message: 'boom', reason: 'maxRetriesExceeded', errors: inner })
    const result = classifyTurnError(err)
    expect(result).toEqual({
      errorType: 'RETRY_ERROR',
      statusCode: 500,
      isRetryable: true,
      retryAttempts: 3,
      retryReason: 'maxRetriesExceeded',
    })
  })

  it('classifies APICallError: 503 as UPSTREAM_UNAVAILABLE, retryable', () => {
    const err = new APICallError({ message: 'svc unavailable', url: 'https://x', requestBodyValues: {}, statusCode: 503 })
    expect(classifyTurnError(err)).toEqual({
      errorType: 'UPSTREAM_UNAVAILABLE',
      statusCode: 503,
      isRetryable: true,
      clientMessage: 'The AI service is temporarily unavailable. Please send your message again.',
    })
  })

  it('classifies APICallError: 500/502 as UPSTREAM_UNAVAILABLE, retryable', () => {
    for (const statusCode of [500, 502]) {
      const err = new APICallError({ message: 'boom', url: 'https://x', requestBodyValues: {}, statusCode })
      expect(classifyTurnError(err)).toEqual({
        errorType: 'UPSTREAM_UNAVAILABLE',
        statusCode,
        isRetryable: true,
        clientMessage: 'The AI service is temporarily unavailable. Please send your message again.',
      })
    }
  })

  it('classifies APICallError: 429 is retryable (no errorType)', () => {
    const err = new APICallError({ message: 'rate limit', url: 'https://x', requestBodyValues: {}, statusCode: 429 })
    expect(classifyTurnError(err)).toEqual({ statusCode: 429, isRetryable: true })
  })

  it('classifies APICallError: 400 is not retryable', () => {
    const err = new APICallError({ message: 'bad', url: 'https://x', requestBodyValues: {}, statusCode: 400 })
    expect(classifyTurnError(err)).toEqual({ statusCode: 400, isRetryable: false })
  })

  it('classifies APICallError: 408 as UPSTREAM_TIMEOUT, not retryable, friendly message', () => {
    const err = new APICallError({ message: 'Request Timeout', url: 'https://x', requestBodyValues: {}, statusCode: 408 })
    expect(classifyTurnError(err)).toEqual({
      errorType: 'UPSTREAM_TIMEOUT',
      statusCode: 408,
      isRetryable: false,
      clientMessage: 'The AI took too long to respond and the request timed out. Please send your message again.',
    })
  })

  it('classifies APICallError: 504 as UPSTREAM_TIMEOUT with the friendly timeout message', () => {
    const err = new APICallError({ message: 'Gateway Timeout', url: 'https://x', requestBodyValues: {}, statusCode: 504 })
    expect(classifyTurnError(err)).toEqual({
      errorType: 'UPSTREAM_TIMEOUT',
      statusCode: 504,
      isRetryable: false,
      clientMessage: 'The AI took too long to respond and the request timed out. Please send your message again.',
    })
  })

  it('classifies a connect-timeout APICallError (no statusCode) as NETWORK_ERROR, retryable', () => {
    const err = new APICallError({
      message: 'Cannot connect to API.',
      url: 'https://x',
      requestBodyValues: {},
      cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    })
    expect(classifyTurnError(err)).toEqual({
      errorType: 'NETWORK_ERROR',
      isRetryable: true,
      clientMessage: 'A network error interrupted the connection. Please send your message again.',
    })
  })

  it('classifies a raw undici "terminated" TypeError as NETWORK_ERROR, retryable', () => {
    const err = new TypeError('terminated')
    expect(classifyTurnError(err)).toEqual({
      errorType: 'NETWORK_ERROR',
      isRetryable: true,
      clientMessage: 'A network error interrupted the connection. Please send your message again.',
    })
  })

  it('classifies a transient TypeValidationError (internalServerException) as STREAM_TYPE_VALIDATION, retryable', () => {
    // The @ai-sdk/anthropic stream parser emits this in-band when a chunk
    // fails its `discriminatedUnion("type", ...)` validation ("No matching
    // discriminator") — here a transient Bedrock `internalServerException`
    // envelope leaked by the GoCode/LiteLLM proxy. Transient → retryable so the
    // client auto-resends.
    const err = new TypeValidationError({
      value: { type: 'internalServerException', message: 'Try your request again.' },
      cause: new Error('No matching discriminator'),
    })
    expect(classifyTurnError(err)).toEqual({
      errorType: 'STREAM_TYPE_VALIDATION',
      statusCode: 502,
      isRetryable: true,
      clientMessage: 'The AI service returned an unexpected response. Please send your message again.',
    })
  })

  it('classifies a content-filter TypeValidationError (validationException) as CONTENT_FILTERED, not retryable', () => {
    const err = new TypeValidationError({
      value: { type: 'validationException', message: 'blocked by guardrail' },
      cause: new Error('No matching discriminator'),
    })
    expect(classifyTurnError(err)).toEqual({
      errorType: 'CONTENT_FILTERED',
      statusCode: 502,
      isRetryable: false,
      clientMessage: 'The AI service could not process this request. Please rephrase your message and try again.',
    })
  })

  it('classifies an unrecognized TypeValidationError chunk as STREAM_TYPE_VALIDATION, not retryable', () => {
    const err = new TypeValidationError({
      value: { type: 'some_future_block', data: 'x' },
      cause: new Error('No matching discriminator'),
    })
    expect(classifyTurnError(err)).toEqual({
      errorType: 'STREAM_TYPE_VALIDATION',
      statusCode: 502,
      isRetryable: false,
      clientMessage: 'The AI service returned an unexpected response. Please send your message again.',
    })
  })

  it('returns isRetryable: false for unknown errors', () => {
    expect(classifyTurnError(new Error('unknown'))).toEqual({ isRetryable: false })
    expect(classifyTurnError('string throw')).toEqual({ isRetryable: false })
  })

  it('priority: AgentNotFoundError beats duck-typed errorType check', () => {
    const err = new AgentNotFoundError('x')
    Object.assign(err, { errorType: 'APP_NOT_FOUND' })
    expect(classifyTurnError(err).errorType).toBe('AGENT_NOT_FOUND')
  })

  it('BudgetServiceUnavailableError maps to retryable with sanitized clientMessage', () => {
    const err = new BudgetServiceUnavailableError('GET /v1/sessions/internal/path failed: 503')
    const result = classifyTurnError(err)
    expect(result).toEqual({
      errorType: 'BUDGET_SERVICE_UNAVAILABLE',
      statusCode: 503,
      isRetryable: true,
      clientMessage: 'Budget service temporarily unavailable',
    })
  })

  it('BudgetServiceTimeoutError maps identically to UNAVAILABLE (both retryable)', () => {
    const err = new BudgetServiceTimeoutError('POST /v1/budgets/internal/path timed out')
    const result = classifyTurnError(err)
    expect(result.errorType).toBe('BUDGET_SERVICE_UNAVAILABLE')
    expect(result.statusCode).toBe(503)
    expect(result.isRetryable).toBe(true)
    expect(result.clientMessage).toBe('Budget service temporarily unavailable')
  })

  it('BudgetServiceAuthError is not retryable and hides the raw auth-failure path', () => {
    const err = new BudgetServiceAuthError('Budget Service auth failed: 401 GET /v1/sessions/abc/report', 401)
    const result = classifyTurnError(err)
    expect(result.errorType).toBe('BUDGET_SERVICE_AUTH_ERROR')
    expect(result.statusCode).toBe(401)
    expect(result.isRetryable).toBe(false)
    expect(result.clientMessage).toBe('Budget service authentication failed')
    // Raw message must not leak: the internal URL path is gone.
    expect(result.clientMessage).not.toContain('/v1/sessions')
  })

  it('generic BudgetServiceError at 5xx is retryable', () => {
    const err = new BudgetServiceError('BMS 500: GET /v1/internal failed', 500)
    const result = classifyTurnError(err)
    expect(result.errorType).toBe('BUDGET_SERVICE_ERROR')
    expect(result.isRetryable).toBe(true)
  })

  it('generic BudgetServiceError at 4xx (non-auth, non-404) is not retryable', () => {
    // NB: maps to BUDGET_SERVICE_ERROR with the caller's statusCode when
    // none of the specific subclasses match (fall-through branch in
    // mapBudgetErrorToResponse).
    const err = new BudgetServiceError('some 418 teapot', 418)
    const result = classifyTurnError(err)
    expect(result.errorType).toBe('BUDGET_SERVICE_ERROR')
    expect(result.isRetryable).toBe(false)
  })
})
