import { describe, it, expect } from 'vitest'

import { BudgetOverride, isBudgetOverride, isBmsOverride, resolveBmsSubscriptionId } from '../budget-override.js'

describe('isBudgetOverride', function tests() {
  it('should return true for care agent override', function careAgent() {
    expect(isBudgetOverride(BudgetOverride.CareAgent)).toBe(true)
    expect(isBudgetOverride('airo-builder:care-agent')).toBe(true)
  })

  it('should return true for test accounts override', function testAccounts() {
    expect(isBudgetOverride(BudgetOverride.TestAccounts)).toBe(true)
    expect(isBudgetOverride('airo-builder:test-accounts')).toBe(true)
  })

  it('should return true for all BudgetOverride enum values', function allOverrides() {
    for (const value of Object.values(BudgetOverride)) {
      expect(isBudgetOverride(value)).toBe(true)
    }
  })

  it('should return false for regular subscription IDs', function regularSubscription() {
    expect(isBudgetOverride('sub-12345')).toBe(false)
    expect(isBudgetOverride('customer-subscription-uuid')).toBe(false)
  })

  it('should return false for null or undefined', function nullish() {
    expect(isBudgetOverride(null)).toBe(false)
    expect(isBudgetOverride(undefined)).toBe(false)
  })

  it('should return false for empty string', function emptyString() {
    expect(isBudgetOverride('')).toBe(false)
  })
})

describe('isBmsOverride', function tests() {
  it('should return true only for CareAgent and TestAccounts', function bmsOverrides() {
    expect(isBmsOverride(BudgetOverride.CareAgent)).toBe(true)
    expect(isBmsOverride(BudgetOverride.TestAccounts)).toBe(true)
    expect(isBmsOverride('airo-builder:care-agent')).toBe(true)
    expect(isBmsOverride('airo-builder:test-accounts')).toBe(true)
  })

  it('should return false for all non-BMS BudgetOverride values', function nonBmsOverrides() {
    // Exhaustive test: all BudgetOverride values except CareAgent and TestAccounts
    // should NOT trigger BMS override attribution (they're for the legacy grants system)
    const bmsOverrides = new Set([BudgetOverride.CareAgent, BudgetOverride.TestAccounts])
    const nonBmsOverrides = Object.values(BudgetOverride).filter(v => !bmsOverrides.has(v))

    // Ensure we're testing at least some non-BMS values
    expect(nonBmsOverrides.length).toBeGreaterThan(0)

    for (const value of nonBmsOverrides) {
      expect(isBmsOverride(value)).toBe(false)
    }
  })

  it('should return false for regular subscription IDs', function regularSubscription() {
    expect(isBmsOverride('sub-12345')).toBe(false)
    expect(isBmsOverride('customer-subscription-uuid')).toBe(false)
  })

  it('should return false for null or undefined', function nullish() {
    expect(isBmsOverride(null)).toBe(false)
    expect(isBmsOverride(undefined)).toBe(false)
  })

  it('should return false for empty string', function emptyString() {
    expect(isBmsOverride('')).toBe(false)
  })
})

describe('resolveBmsSubscriptionId', function tests() {
  it('should return CareAgent for employee sessions', function employeeSession() {
    expect(resolveBmsSubscriptionId(true, false, 'customer-sub')).toBe(BudgetOverride.CareAgent)
    expect(resolveBmsSubscriptionId(true, false, undefined)).toBe(BudgetOverride.CareAgent)
  })

  it('should return TestAccounts for test budget sessions', function testBudget() {
    expect(resolveBmsSubscriptionId(false, true, 'customer-sub')).toBe(BudgetOverride.TestAccounts)
    expect(resolveBmsSubscriptionId(false, true, undefined)).toBe(BudgetOverride.TestAccounts)
  })

  it('should prefer CareAgent when both employee and test flags are set', function bothFlags() {
    expect(resolveBmsSubscriptionId(true, true, 'customer-sub')).toBe(BudgetOverride.CareAgent)
  })

  it('should return the actual subscriptionId for regular sessions', function regularSession() {
    expect(resolveBmsSubscriptionId(false, false, 'customer-sub')).toBe('customer-sub')
    expect(resolveBmsSubscriptionId(false, false, undefined)).toBeUndefined()
  })
})
