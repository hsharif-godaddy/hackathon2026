import { describe, expect, it } from 'vitest'

import { shouldUseBms } from '../bms-migration'

describe('shouldUseBms', () => {
  it('returns false for null/undefined subscription', () => {
    expect(shouldUseBms(null)).toEqual({ useBms: false, reason: 'no-subscription' })
    expect(shouldUseBms(undefined)).toEqual({ useBms: false, reason: 'no-subscription' })
  })

  it('returns false when bmsBudgetId is missing', () => {
    expect(shouldUseBms({})).toEqual({ useBms: false, reason: 'no-bms-budget-id' })
    expect(shouldUseBms({ bmsBudgetId: null })).toEqual({ useBms: false, reason: 'no-bms-budget-id' })
  })

  it('returns true when bmsBudgetId is set and no migration attribute', () => {
    expect(shouldUseBms({ bmsBudgetId: 'b-1' })).toEqual({ useBms: true, bmsBudgetId: 'b-1' })
  })

  it('returns true when migration attribute has a non-empty migrationDate', () => {
    const result = shouldUseBms({
      bmsBudgetId: 'b-1',
      attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-04-01T00:00:00Z' } }],
    })
    expect(result.useBms).toBe(true)
  })

  it('returns false when migration attribute exists but migrationDate is null', () => {
    const result = shouldUseBms({
      bmsBudgetId: 'b-1',
      attributes: [{ key: 'bms-migration', value: { migrationDate: null } }],
    })
    expect(result).toEqual({ useBms: false, reason: 'migration-in-progress' })
  })

  it('returns false when migration attribute exists but migrationDate is empty string', () => {
    const result = shouldUseBms({
      bmsBudgetId: 'b-1',
      attributes: [{ key: 'bms-migration', value: { migrationDate: '' } }],
    })
    expect(result).toEqual({ useBms: false, reason: 'migration-in-progress' })
  })

  it('ignores unrelated attributes', () => {
    const result = shouldUseBms({
      bmsBudgetId: 'b-1',
      attributes: [{ key: 'free-plan', value: { something: 'else' } as never }],
    })
    expect(result.useBms).toBe(true)
  })
})
