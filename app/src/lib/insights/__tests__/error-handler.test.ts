import { describe, expect, it } from 'vitest'

import { calculateBackoffDelay, classifyError } from '../error-handler'

describe('error-handler', () => {
  describe('classifyError', () => {
    it('should classify fetch TypeError as retryable network error', () => {
      const err = new TypeError('fetch failed')
      const result = classifyError(err)
      expect(result.retryable).toBe(true)
      expect(result.category).toBe('network')
      expect(result.message).toContain('Network error')
    })

    it('should classify GraphQL error as non-retryable client error', () => {
      const err = Object.assign(new Error('Bad query'), { isGraphQLError: true })
      const result = classifyError(err)
      expect(result.retryable).toBe(false)
      expect(result.category).toBe('client_error')
    })

    it('should classify "GraphQL errors:" message as non-retryable', () => {
      const err = new Error('GraphQL errors: something bad')
      const result = classifyError(err)
      expect(result.retryable).toBe(false)
      expect(result.category).toBe('client_error')
    })

    it('should classify timeout errors as retryable', () => {
      const err = new Error('Request timeout')
      const result = classifyError(err)
      expect(result.retryable).toBe(true)
      expect(result.category).toBe('timeout')
    })

    it('should classify AbortError as retryable timeout', () => {
      const err = new Error('The operation was aborted')
      const result = classifyError(err)
      expect(result.retryable).toBe(true)
      expect(result.category).toBe('timeout')
    })

    it('should classify rate limit errors as retryable', () => {
      const err = new Error('HTTP 429 Too Many Requests')
      const result = classifyError(err)
      expect(result.retryable).toBe(true)
      expect(result.category).toBe('rate_limit')
    })

    it('should classify 500-series errors as retryable server errors', () => {
      for (const code of ['500', '502', '503', '504']) {
        const err = new Error(`HTTP ${code}: Internal Server Error`)
        const result = classifyError(err)
        expect(result.retryable).toBe(true)
        expect(result.category).toBe('server_error')
      }
    })

    it('should classify 400-series errors as non-retryable client errors', () => {
      for (const code of ['400', '401', '403', '404']) {
        const err = new Error(`HTTP ${code}: Bad Request`)
        const result = classifyError(err)
        expect(result.retryable).toBe(false)
        expect(result.category).toBe('client_error')
      }
    })

    it('should classify unknown errors as retryable', () => {
      const err = new Error('Something unexpected')
      const result = classifyError(err)
      expect(result.retryable).toBe(true)
      expect(result.category).toBe('unknown')
    })

    it('should handle non-Error values', () => {
      const result = classifyError('string error')
      expect(result.retryable).toBe(true)
      expect(result.category).toBe('unknown')
    })
  })

  describe('calculateBackoffDelay', () => {
    it('should return initial delay for first attempt', () => {
      // With jitter, delay should be between initialDelay and initialDelay * 1.3
      const delay = calculateBackoffDelay(1, 1000, 10000)
      expect(delay).toBeGreaterThanOrEqual(1000)
      expect(delay).toBeLessThanOrEqual(1300)
    })

    it('should increase exponentially', () => {
      const d1 = calculateBackoffDelay(1, 1000, 100000)
      const d2 = calculateBackoffDelay(2, 1000, 100000)
      const d3 = calculateBackoffDelay(3, 1000, 100000)
      // Base delay doubles each attempt, so d2 base=2000, d3 base=4000
      expect(d2).toBeGreaterThan(d1)
      expect(d3).toBeGreaterThan(d2)
    })

    it('should cap at maxDelay', () => {
      const delay = calculateBackoffDelay(10, 1000, 5000)
      expect(delay).toBeLessThanOrEqual(5000)
    })

    it('should never return negative', () => {
      const delay = calculateBackoffDelay(1, 0, 0)
      expect(delay).toBeGreaterThanOrEqual(0)
    })
  })
})
