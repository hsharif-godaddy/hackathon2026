import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetItem, BudgetResponse } from '@airo/shared/budget'
import { GrantFinalState, GrantType } from '@airo/shared/grants'

import { adaptBudgetToGrants } from '../adapt-budget-to-grants'

describe('adaptBudgetToGrants', () => {
  const SUBSCRIPTION_ID = 'sub-123'
  const BUDGET_ID = 'budget-456'

  const FIXED_NOW = new Date('2026-04-20T12:00:00.000Z')
  const FUTURE_DATE = '2026-05-20T00:00:00.000Z'
  const PAST_DATE = '2026-04-10T00:00:00.000Z'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createBudgetItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
    return {
      budgetItemId: 'item-1',
      creditsTotal: '1000.00',
      creditsUsed: '500.00',
      costToCreditRatio: '1.0',
      expiresAt: FUTURE_DATE,
      startsAt: '2026-04-01T00:00:00.000Z',
      resetInterval: null,
      resetsAt: null,
      label: null,
      ...overrides,
    }
  }

  function createBudgetResponse(items: BudgetItem[]): BudgetResponse {
    return {
      budgetId: BUDGET_ID,
      productKey: 'airo-builder',
      creditsTotal: '1000.00',
      creditsUsed: '500.00',
      creditsPending: '0.00',
      items,
    }
  }

  describe('basic adaptation', () => {
    it('converts a budget item to CreditGrant format', () => {
      const grants = adaptBudgetToGrants(createBudgetResponse([createBudgetItem()]), SUBSCRIPTION_ID)

      expect(grants).toHaveLength(1)
      expect(grants[0]).toMatchObject({
        id: 'item-1',
        subscriptionId: SUBSCRIPTION_ID,
        llmBudgetUserId: BUDGET_ID,
        llmBudgetId: BUDGET_ID,
        creditsMax: 1000,
        creditsSpent: 500,
        useBefore: FUTURE_DATE,
        createdAt: '2026-04-01T00:00:00.000Z',
      })
    })

    it('handles multiple budget items', () => {
      const items = [
        createBudgetItem({ budgetItemId: 'item-1', creditsTotal: '1000.00' }),
        createBudgetItem({ budgetItemId: 'item-2', creditsTotal: '2000.00' }),
      ]
      const grants = adaptBudgetToGrants(createBudgetResponse(items), SUBSCRIPTION_ID)

      expect(grants).toHaveLength(2)
      expect(grants[0]!.id).toBe('item-1')
      expect(grants[1]!.id).toBe('item-2')
    })
  })

  describe('grant type derivation', () => {
    it('uses label when set to plan-monthly', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ label: GrantType.PlanMonthly })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.type).toBe(GrantType.PlanMonthly)
    })

    it('uses label when set to credit-pack', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ label: GrantType.CreditPack })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.type).toBe(GrantType.CreditPack)
    })

    it('derives plan-monthly from resetInterval when label not set', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ resetInterval: 'month', label: null })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.type).toBe(GrantType.PlanMonthly)
    })

    it('derives credit-pack when no resetInterval and no label', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ resetInterval: null, label: null })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.type).toBe(GrantType.CreditPack)
    })

  })

  describe('isAvailable calculation', () => {
    it('is true when credits remaining and not expired', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({ creditsTotal: '1000.00', creditsUsed: '500.00', expiresAt: FUTURE_DATE }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.isAvailable).toBe(true)
    })

    it('is false when no credits remaining', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({ creditsTotal: '1000.00', creditsUsed: '1000.00', expiresAt: FUTURE_DATE }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.isAvailable).toBe(false)
    })

    it('is false when expired (expiresAt)', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({ creditsTotal: '1000.00', creditsUsed: '500.00', expiresAt: PAST_DATE, resetsAt: null }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.isAvailable).toBe(false)
    })

    it('is false when expired (resetsAt for plan-monthly)', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({ creditsTotal: '1000.00', creditsUsed: '500.00', expiresAt: null, resetsAt: PAST_DATE }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.isAvailable).toBe(false)
    })
  })

  describe('finalState calculation', () => {
    it('is null when item is active', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({ creditsTotal: '1000.00', creditsUsed: '500.00', expiresAt: FUTURE_DATE }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.finalState).toBeNull()
    })

    it('is Consumed when credits exhausted', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({ creditsTotal: '1000.00', creditsUsed: '1000.00', expiresAt: FUTURE_DATE }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.finalState).toBe(GrantFinalState.Consumed)
    })

    it('is Expired when past expiration date', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({ creditsTotal: '1000.00', creditsUsed: '500.00', expiresAt: PAST_DATE }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.finalState).toBe(GrantFinalState.Expired)
    })

    it('prioritizes Expired over Consumed', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({ creditsTotal: '1000.00', creditsUsed: '1000.00', expiresAt: PAST_DATE }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.finalState).toBe(GrantFinalState.Expired)
    })
  })

  describe('useBefore derivation', () => {
    it('uses resetsAt for plan-monthly items', () => {
      const resetsAt = '2026-05-20T19:01:30Z'
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({
            label: GrantType.PlanMonthly,
            resetInterval: '1mo',
            resetsAt,
            expiresAt: null,
          }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.useBefore).toBe(resetsAt)
    })

    it('uses expiresAt for credit-pack items', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([
          createBudgetItem({
            label: GrantType.CreditPack,
            resetInterval: null,
            resetsAt: null,
            expiresAt: FUTURE_DATE,
          }),
        ]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.useBefore).toBe(FUTURE_DATE)
    })

    it('prefers resetsAt over expiresAt when both present', () => {
      const resetsAt = '2026-05-20T19:01:30Z'
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ resetsAt, expiresAt: FUTURE_DATE })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.useBefore).toBe(resetsAt)
    })

    it('is null when neither resetsAt nor expiresAt is set', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ expiresAt: null, resetsAt: null })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.useBefore).toBeNull()
    })
  })

  describe('numeric conversion', () => {
    it('converts string credits to numbers and floors creditsSpent', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ creditsTotal: '1500', creditsUsed: '750.25' })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.creditsMax).toBe(1500)
      expect(grants[0]!.creditsSpent).toBe(750)
    })

    it('keeps grant available at fractional boundary', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ creditsTotal: '1000', creditsUsed: '999.9' })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.creditsSpent).toBe(999)
      expect(grants[0]!.isAvailable).toBe(true)
    })

    it('handles invalid numeric strings as 0', () => {
      const grants = adaptBudgetToGrants(
        createBudgetResponse([createBudgetItem({ creditsTotal: 'invalid', creditsUsed: 'NaN' })]),
        SUBSCRIPTION_ID
      )
      expect(grants[0]!.creditsMax).toBe(0)
      expect(grants[0]!.creditsSpent).toBe(0)
    })
  })
})
