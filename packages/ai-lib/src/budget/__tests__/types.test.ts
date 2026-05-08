import { describe, it, expect } from 'vitest'
import {
  computeRemaining,
  toBudgetUpdatePayload,
} from '../types.js'
import type { BudgetItem, BudgetResponse } from '@airo/shared/budget'
import type { ReportResponse } from '../report-types.js'

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

describe('toBudgetUpdatePayload', () => {
    it('builds payload from report response and budget response', () => {
      const reportResponse: ReportResponse = {
        reportId: 'rpt-1',
        budgetId: 'b-1',
        sessionId: 'sess-1',
        productKey: 'airo-builder',
        budgetCostTotal: 5,
        productCostTotal: 0,
        creditsAvailable: 95,
        reportItems: [
          {
            budgetCost: 5,
            productCost: 0,
            category: 'airo-builder:general',
            budgetItems: [{ budgetItemId: 'bi-1', creditsUsed: 3.33 }],
          },
        ],
      }
      const budgetResponse = makeBudgetResponse({
        creditsUsed: '55.000000', // updated after report
      })

      const payload = toBudgetUpdatePayload(reportResponse, budgetResponse, false)

      expect(payload.customerRemaining).toBe(95) // 150 - 55
      expect(payload.refreshRequired).toBe(false)
      expect(payload.assignment.customer[0]!.budgetItemId).toBe('bi-1')
      expect(payload.assignment.customer[0]!.amount).toBe(3.33)
      // Verify full budget items included for client-side cache update
      expect(payload.budgetItems).toEqual(budgetResponse.items)
      expect(payload.budgetId).toBe('b-1')
    })

    it('flattens multi-item report into customer deductions', () => {
      const reportResponse: ReportResponse = {
        reportId: 'rpt-1',
        budgetId: 'b-1',
        sessionId: 'sess-1',
        productKey: 'airo-builder',
        budgetCostTotal: 3,
        productCostTotal: 0,
        creditsAvailable: 100,
        reportItems: [
          {
            budgetCost: 3,
            productCost: 0,
            category: 'airo-builder:general',
            budgetItems: [
              { budgetItemId: 'bi-1', creditsUsed: 2 },
              { budgetItemId: 'bi-2', creditsUsed: 1 },
            ],
          },
        ],
      }
      const budgetResponse = makeBudgetResponse()

      const payload = toBudgetUpdatePayload(reportResponse, budgetResponse, false)

      expect(payload.assignment.customer).toHaveLength(2)
    })

    it('handles empty reportItems', () => {
      const reportResponse: ReportResponse = {
        reportId: 'rpt-1',
        budgetId: 'b-1',
        sessionId: 'sess-1',
        productKey: 'airo-builder',
        budgetCostTotal: 0,
        productCostTotal: 0,
        creditsAvailable: 150,
        reportItems: [],
      }
      const budgetResponse = makeBudgetResponse()

      const payload = toBudgetUpdatePayload(reportResponse, budgetResponse, false)

      expect(payload.assignment.customer).toEqual([])
      expect(payload.refreshRequired).toBe(false)
    })

    it('includes all reportItems for detailed cost attribution', () => {
      const reportResponse: ReportResponse = {
        reportId: 'rpt-1',
        budgetId: 'b-1',
        sessionId: 'sess-1',
        productKey: 'airo-builder',
        budgetCostTotal: 2,
        productCostTotal: 8,
        creditsAvailable: 148,
        reportItems: [
          {
            budgetCost: 2,
            productCost: 3,
            category: 'airo-builder:causal-chain',
            budgetItems: [{ budgetItemId: 'bi-1', creditsUsed: 2 }],
          },
          {
            budgetCost: 0,
            productCost: 5,
            category: 'airo-builder:tool-failure',
            budgetItems: [],
          },
        ],
      }
      const budgetResponse = makeBudgetResponse()

      const payload = toBudgetUpdatePayload(reportResponse, budgetResponse, false)

      // Verify all report items are included (not just the highest productCost one)
      expect(payload.assignment.reportItems).toHaveLength(2)
      expect(payload.assignment.reportItems).toEqual([
        { budgetCost: 2, productCost: 3, category: 'airo-builder:causal-chain' },
        { budgetCost: 0, productCost: 5, category: 'airo-builder:tool-failure' },
      ])
    })

    it('includes empty reportItems array when no items', () => {
      const reportResponse: ReportResponse = {
        reportId: 'rpt-1',
        budgetId: 'b-1',
        sessionId: 'sess-1',
        productKey: 'airo-builder',
        budgetCostTotal: 0,
        productCostTotal: 0,
        creditsAvailable: 150,
        reportItems: [],
      }
      const budgetResponse = makeBudgetResponse()

      const payload = toBudgetUpdatePayload(reportResponse, budgetResponse, false)

      expect(payload.assignment.reportItems).toEqual([])
    })
  })
