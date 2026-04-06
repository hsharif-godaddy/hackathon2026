import { describe, it, expect } from 'vitest'
import {
  BudgetExceededError,
  isTransientBadRequest,
  containsBudgetExceededPattern,
  NON_RETRYABLE_400_PATTERNS,
  BUDGET_EXCEEDED_PATTERNS
} from '../errors.js'

describe('errors', () => {
  describe('#isTransientBadRequest', () => {
    it('returns true for generic "Bad Request" message', () => {
      expect(isTransientBadRequest('Bad Request')).toBe(true)
      expect(isTransientBadRequest('bad request')).toBe(true)
      expect(isTransientBadRequest('BAD REQUEST')).toBe(true)
      expect(isTransientBadRequest('Error: Bad Request from API')).toBe(true)
    })

    it('returns false for non-bad-request errors', () => {
      expect(isTransientBadRequest('Internal Server Error')).toBe(false)
      expect(isTransientBadRequest('Not Found')).toBe(false)
      expect(isTransientBadRequest('Unauthorized')).toBe(false)
      expect(isTransientBadRequest('')).toBe(false)
    })

    it('returns false for tool validation errors (toolUse.input)', () => {
      expect(isTransientBadRequest('Bad Request: toolUse.input is invalid JSON')).toBe(false)
      expect(isTransientBadRequest('toolUse.input validation failed - Bad Request')).toBe(false)
    })

    it('returns false for JSON parsing errors', () => {
      expect(isTransientBadRequest('Bad Request: JSON parsing failed')).toBe(false)
      expect(isTransientBadRequest('JSON parsing error - Bad Request')).toBe(false)
    })

    it('returns false when response body contains budget exceeded pattern', () => {
      expect(isTransientBadRequest('Bad Request', 'exceededbudget limit reached')).toBe(false)
      expect(isTransientBadRequest('Bad Request', 'User is over budget')).toBe(false)
      expect(isTransientBadRequest('Bad Request', 'exceeded budget for this month')).toBe(false)
      expect(isTransientBadRequest('Bad Request', '{"type":"budget_exceeded"}')).toBe(false)
    })

    it('returns true when response body does not contain budget pattern', () => {
      expect(isTransientBadRequest('Bad Request', 'some other error')).toBe(true)
      expect(isTransientBadRequest('Bad Request', '')).toBe(true)
      expect(isTransientBadRequest('Bad Request', undefined)).toBe(true)
    })

    it('handles edge cases', () => {
      // Case sensitivity for non-retryable patterns (should be case-sensitive)
      expect(isTransientBadRequest('Bad Request: TOOLUSE.INPUT error')).toBe(true) // uppercase doesn't match
      expect(isTransientBadRequest('Bad Request: json parsing issue')).toBe(true) // lowercase doesn't match exact pattern

      // Multiple patterns
      expect(isTransientBadRequest('Bad Request: toolUse.input and JSON parsing both failed')).toBe(false)
    })
  })

  describe('#containsBudgetExceededPattern', () => {
    it('detects budget exceeded patterns', () => {
      expect(containsBudgetExceededPattern('exceededbudget')).toBe(true)
      expect(containsBudgetExceededPattern('User is over budget')).toBe(true)
      expect(containsBudgetExceededPattern('exceeded budget for model')).toBe(true)
      expect(containsBudgetExceededPattern('{"type":"budget_exceeded"}')).toBe(true)
    })

    it('is case insensitive', () => {
      expect(containsBudgetExceededPattern('EXCEEDEDBUDGET')).toBe(true)
      expect(containsBudgetExceededPattern('Over Budget')).toBe(true)
      expect(containsBudgetExceededPattern('EXCEEDED BUDGET')).toBe(true)
      expect(containsBudgetExceededPattern('BUDGET_EXCEEDED')).toBe(true)
    })

    it('returns false for non-budget errors', () => {
      expect(containsBudgetExceededPattern('rate limit exceeded')).toBe(false)
      expect(containsBudgetExceededPattern('quota exceeded')).toBe(false)
      expect(containsBudgetExceededPattern('')).toBe(false)
    })
  })

  describe('BudgetExceededError.fromBudgetCheck', () => {
    it('creates error with budget-service-pre-check source', () => {
      const err = BudgetExceededError.fromBudgetCheck('sub-123')
      expect(err).toBeInstanceOf(BudgetExceededError)
      expect(err.statusCode).toBe(402)
      expect(err.message).toBe('Your AI usage budget has been reached.')
      expect(JSON.parse(err.responseBody)).toEqual({
        budgetId: 'sub-123',
        source: 'budget-service-pre-check',
      })
    })

    it('is detected by isInstance', () => {
      const err = BudgetExceededError.fromBudgetCheck('b-1')
      expect(BudgetExceededError.isInstance(err)).toBe(true)
      expect(err.isBudgetExceeded).toBe(true)
      expect(err.errorType).toBe('BUDGET_EXCEEDED')
    })
  })

  describe('constants', () => {
    it('NON_RETRYABLE_400_PATTERNS contains expected patterns', () => {
      expect(NON_RETRYABLE_400_PATTERNS).toContain('toolUse.input')
      expect(NON_RETRYABLE_400_PATTERNS).toContain('JSON parsing')
      expect(NON_RETRYABLE_400_PATTERNS.length).toBe(2)
    })

    it('BUDGET_EXCEEDED_PATTERNS contains expected patterns', () => {
      expect(BUDGET_EXCEEDED_PATTERNS).toContain('exceededbudget')
      expect(BUDGET_EXCEEDED_PATTERNS).toContain('budget_exceeded')
      expect(BUDGET_EXCEEDED_PATTERNS).toContain('exceeded budget')
      expect(BUDGET_EXCEEDED_PATTERNS).toContain('over budget')
      expect(BUDGET_EXCEEDED_PATTERNS.length).toBe(4)
    })
  })
})
