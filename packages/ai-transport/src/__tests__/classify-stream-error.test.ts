import { describe, it, expect } from 'vitest'
import { APICallError } from 'ai'
import { BudgetExceededError } from '@airo/ai-common'
import { classifyStreamBudgetError, isToolValidationError } from '../classify-stream-error.js'

describe('classifyStreamBudgetError', () => {
  it('detects budget exceeded from APICallError with budget pattern in responseBody', () => {
    const error = new APICallError({
      message: 'Bad Request',
      url: 'https://proxy.example.com/v1/messages',
      requestBodyValues: {},
      statusCode: 401,
      responseBody: 'ExceededBudget: key budget limit reached',
    })

    const result = classifyStreamBudgetError(error)

    expect(result.type).toBe('budget_exceeded')
    expect(result.source).toBe('api_error')
    if (result.type === 'budget_exceeded') {
      expect(result.budgetError).toBeInstanceOf(BudgetExceededError)
      expect(result.budgetError.statusCode).toBe(401)
      expect(result.budgetError.responseBody).toBe('ExceededBudget: key budget limit reached')
    }
  })

  it('detects budget exceeded from APICallError with 400 status', () => {
    const error = new APICallError({
      message: 'model budget exceeded',
      url: 'https://proxy.example.com/v1/messages',
      requestBodyValues: {},
      statusCode: 400,
      responseBody: '{"type":"budget_exceeded","message":"exceeded budget for model"}',
    })

    const result = classifyStreamBudgetError(error)

    expect(result.type).toBe('budget_exceeded')
    expect(result.source).toBe('api_error')
    if (result.type === 'budget_exceeded') {
      expect(result.budgetError.statusCode).toBe(400)
    }
  })

  it('detects budget exceeded from plain Error with budget pattern in message', () => {
    const error = new Error('LiteLLM exceeded budget for key sk-1234')

    const result = classifyStreamBudgetError(error)

    expect(result.type).toBe('budget_exceeded')
    expect(result.source).toBe('pattern_match')
    if (result.type === 'budget_exceeded') {
      expect(result.budgetError).toBeInstanceOf(BudgetExceededError)
      expect(result.budgetError.statusCode).toBe(400)
      expect(result.budgetError.responseBody).toBe('LiteLLM exceeded budget for key sk-1234')
    }
  })

  it('does not double-wrap BudgetExceededError instances', () => {
    const error = new BudgetExceededError('Already a budget error', 429, 'original body')

    const result = classifyStreamBudgetError(error)

    expect(result.type).toBe('other')
    if (result.type === 'other') {
      expect(result.error).toBe(error)
    }
  })

  it('returns other for random Error', () => {
    const error = new Error('Connection reset')

    const result = classifyStreamBudgetError(error)

    expect(result.type).toBe('other')
    if (result.type === 'other') {
      expect(result.error).toBe(error)
    }
  })

  it('wraps non-Error input in Error', () => {
    const result = classifyStreamBudgetError('string error')

    expect(result.type).toBe('other')
    if (result.type === 'other') {
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('string error')
    }
  })

  it('does not match APICallError without budget pattern in responseBody', () => {
    const error = new APICallError({
      message: 'Bad Request',
      url: 'https://proxy.example.com/v1/messages',
      requestBodyValues: {},
      statusCode: 400,
      responseBody: 'invalid_request: messages too long',
    })

    const result = classifyStreamBudgetError(error)

    expect(result.type).toBe('other')
  })

  it('defaults statusCode to 400 when APICallError has no statusCode', () => {
    const error = new APICallError({
      message: 'budget exceeded',
      url: 'https://proxy.example.com/v1/messages',
      requestBodyValues: {},
      statusCode: 400,
      responseBody: 'ExceededBudget',
    })

    const result = classifyStreamBudgetError(error)

    expect(result.type).toBe('budget_exceeded')
    if (result.type === 'budget_exceeded') {
      expect(result.budgetError.statusCode).toBe(400)
    }
  })
})

describe('isToolValidationError', () => {
  it('detects toolUse.input is invalid', () => {
    const error = new Error('toolUse.input is invalid: Expected object but got string')
    expect(isToolValidationError(error)).toBe(true)
  })

  it('detects JSON parsing failed', () => {
    const error = new Error('JSON parsing failed: Unexpected token at position 42')
    expect(isToolValidationError(error)).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isToolValidationError(new Error('Connection timeout'))).toBe(false)
    expect(isToolValidationError(new Error('Bad Request'))).toBe(false)
  })

  it('handles non-Error input', () => {
    expect(isToolValidationError('toolUse.input is invalid')).toBe(true)
    expect(isToolValidationError('random string')).toBe(false)
    expect(isToolValidationError(null)).toBe(false)
  })
})
