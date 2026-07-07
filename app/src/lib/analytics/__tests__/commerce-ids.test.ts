import { describe, expect, it } from 'vitest'

import { isConfiguredValue } from '../commerce-ids'

describe('commerce-ids', function packageTests() {
  describe('#isConfiguredValue', function isConfiguredValueTests() {
    it('accepts non-empty configured values', function configured() {
      expect(isConfiguredValue('store-abc')).toBe(true)
    })

    it('rejects empty and placeholder values', function invalid() {
      expect(isConfiguredValue(undefined)).toBe(false)
      expect(isConfiguredValue('')).toBe(false)
      expect(isConfiguredValue('   ')).toBe(false)
      expect(isConfiguredValue('REPLACE_WITH_STORE_ID')).toBe(false)
      expect(isConfiguredValue('REPLACE_WITH_CHANNEL_ID')).toBe(false)
    })
  })
})
