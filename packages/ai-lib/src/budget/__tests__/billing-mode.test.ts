import { describe, it, expect } from 'vitest'
import { getBillingMode } from '../billing-mode.js'

describe('getBillingMode', () => {
  it('returns budget-service when enabled', () => {
    expect(getBillingMode(true)).toBe('budget-service')
  })

  it('returns grants when disabled', () => {
    expect(getBillingMode(false)).toBe('grants')
  })

  it('returns grants when undefined', () => {
    expect(getBillingMode()).toBe('grants')
  })
})
