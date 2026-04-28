import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/request-context'
import { parseValidationStatus, toToolStatus } from '@/stores/validationToolCall'

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn()
  }
}))

describe('validationToolCall', function packageTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  describe('#parseValidationStatus', function parseValidationStatusTests() {
    it('should return known validation statuses', function parse() {
      expect(parseValidationStatus('running')).toBe('running')
      expect(parseValidationStatus('failed')).toBe('failed')
      expect(parseValidationStatus('completed')).toBe('completed')
      expect(parseValidationStatus('error')).toBe('error')
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('should warn and treat unknown validation statuses as errors', function unknown() {
      expect(parseValidationStatus('unexpected')).toBe('error')
      expect(logger.warn).toHaveBeenCalledWith('validation.status.unknown', { status: 'unexpected' })
    })

    it('should warn and treat missing validation statuses as errors', function missing() {
      expect(parseValidationStatus(null)).toBe('error')
      expect(logger.warn).toHaveBeenCalledWith('validation.status.unknown', { status: null })
    })
  })

  describe('#toToolStatus', function toToolStatusTests() {
    it('should map validation statuses to tool statuses', function map() {
      expect(toToolStatus('running')).toBe('running')
      expect(toToolStatus('failed')).toBe('completed')
      expect(toToolStatus('completed')).toBe('completed')
      expect(toToolStatus('error')).toBe('error')
    })
  })
})
