import { describe, it, expect } from 'vitest'
import {
  computeRemaining,
  toBudgetSummary,
  toCreditStatusResponse,
  toBudgetUpdatePayload,
} from '../types.js'
import type { BudgetItem, BudgetResponse } from '@airo/shared/budget'

const makeBudgetItem = (overrides?: Partial<BudgetItem>): BudgetItem => ({
  budgetItemId: 'bi-1',
  creditsTotal: '150.000000',
  creditsUsed: '50.000000',
  costToCreditRatio: '0.100000',
  startsAt: null,
  expiresAt: '2026-04-30T00:00:00Z',
  resetInterval: 'MONTH',
  ...overrides,
})

const makeBudgetResponse = (overrides?: Partial<BudgetResponse>): BudgetResponse => ({
  budgetId: 'b-1',
  productKey: 'airo-builder',
  creditsTotal: '150.000000',
  creditsUsed: '50.000000',
  creditsPending: '0.000000',
  items: [makeBudgetItem()],
  ...overrides,
})

describe('computeRemaining', () => {
  it('computes remaining from decimal strings (total - used only)', () => {
    expect(computeRemaining('150.000000', '50.000000')).toBe(100)
  })

  it('rounds to 6 decimal places to avoid float drift', () => {
    // 100.500000 - 50.333333 = 50.166667 (exact), but floats may drift
    const result = computeRemaining('100.500000', '50.333333')
    expect(result).toBe(50.166667)
  })

  it('returns 0 for fully consumed budget', () => {
    expect(computeRemaining('150.000000', '150.000000')).toBe(0)
  })

  it('handles negative remaining (overspend)', () => {
    const result = computeRemaining('100.000000', '105.000000')
    expect(result).toBe(-5)
  })

  it('returns NaN for non-numeric strings', () => {
    expect(computeRemaining('not-a-number', '0')).toBeNaN()
    expect(computeRemaining('100', 'abc')).toBeNaN()
  })

  it('returns NaN for empty strings', () => {
    expect(computeRemaining('', '0')).toBeNaN()
  })
})

describe('budget view types', () => {
  describe('toBudgetSummary', () => {
    it('maps BudgetItem to BudgetSummary with computed remaining', () => {
      const item = makeBudgetItem()
      const summary = toBudgetSummary(item)

      expect(summary).toEqual({
        budgetItemId: 'bi-1',
        remaining: 100, // 150 - 50
        expiration: '2026-04-30T00:00:00Z',
      })
    })

    it('maps credit-pack item', () => {
      const item = makeBudgetItem({
        budgetItemId: 'bi-2',
        creditsTotal: '250.000000',
        creditsUsed: '0.000000',
        expiresAt: '2026-12-31T00:00:00Z',
        resetInterval: null,
      })
      const summary = toBudgetSummary(item)

      expect(summary.budgetItemId).toBe('bi-2')
      expect(summary.remaining).toBe(250)
    })
  })

  describe('toCreditStatusResponse', () => {
    it('maps BudgetResponse to CreditStatusResponse', () => {
      const raw = makeBudgetResponse({
        creditsTotal: '400.000000',
        creditsUsed: '50.000000',
        creditsPending: '0.000000',
        items: [
          makeBudgetItem({ budgetItemId: 'bi-1' }),
          makeBudgetItem({
            budgetItemId: 'bi-2',
            creditsTotal: '250.000000',
            creditsUsed: '0.000000',
            expiresAt: '2026-12-31T00:00:00Z',
          }),
        ],
      })

      const result = toCreditStatusResponse(raw)

      expect(result.remaining).toBe(350) // 400 - 50
      expect(result.budgets).toHaveLength(2)
      expect(result.budgets[0]!.budgetItemId).toBe('bi-1')
      expect(result.budgets[1]!.budgetItemId).toBe('bi-2')
    })

    it('handles empty items', () => {
      const raw = makeBudgetResponse({
        creditsTotal: '0',
        creditsUsed: '0',
        creditsPending: '0',
        items: [],
      })

      const result = toCreditStatusResponse(raw)

      expect(result.remaining).toBe(0)
      expect(result.budgets).toEqual([])
    })
  })

  describe('toBudgetUpdatePayload', () => {
    it('builds payload from budget response', () => {
      const budgetResponse = makeBudgetResponse({
        creditsUsed: '55.000000',
      })

      const payload = toBudgetUpdatePayload(budgetResponse)

      expect(payload.customerRemaining).toBe(95) // 150 - 55
      expect(payload.refreshRequired).toBe(false)
      expect(payload.budgets).toHaveLength(1)
    })

    it('handles empty items', () => {
      const budgetResponse = makeBudgetResponse({
        creditsTotal: '0',
        creditsUsed: '0',
        items: [],
      })

      const payload = toBudgetUpdatePayload(budgetResponse)

      expect(payload.refreshRequired).toBe(false)
      expect(payload.budgets).toEqual([])
    })
  })

})
