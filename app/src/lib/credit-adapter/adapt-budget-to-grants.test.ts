import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetItem, BudgetResponse } from '@airo/shared/budget'
import { GrantFinalState, GrantType } from '@airo/shared/grants'

import { adaptBudgetToGrants } from './adapt-budget-to-grants'

describe('adaptBudgetToGrants', () => {
  const SUBSCRIPTION_ID = 'sub-123'
  const BUDGET_ID = 'budget-456'

  // Fixed "now" for deterministic tests
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
      costToCreditRatio: '1.000000',
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
    it('should convert a budget item to CreditGrant format', () => {
      const item = createBudgetItem()
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

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

    it('should handle multiple budget items', () => {
      const items = [
        createBudgetItem({ budgetItemId: 'item-1', creditsTotal: '1000.00' }),
        createBudgetItem({ budgetItemId: 'item-2', creditsTotal: '2000.00' }),
      ]
      const budget = createBudgetResponse(items)

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants).toHaveLength(2)
      expect(grants[0].id).toBe('item-1')
      expect(grants[1].id).toBe('item-2')
    })
  })

  describe('grant type derivation', () => {
    it('should use label when set to plan-monthly', () => {
      const item = createBudgetItem({ label: GrantType.PlanMonthly })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].type).toBe(GrantType.PlanMonthly)
    })

    it('should use label when set to credit-pack', () => {
      const item = createBudgetItem({ label: GrantType.CreditPack })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].type).toBe(GrantType.CreditPack)
    })

    it('should derive plan-monthly from resetInterval when label not set', () => {
      const item = createBudgetItem({ resetInterval: 'month', label: null })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].type).toBe(GrantType.PlanMonthly)
    })

    it('should derive credit-pack when no resetInterval and no label', () => {
      const item = createBudgetItem({ resetInterval: null, label: null })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].type).toBe(GrantType.CreditPack)
    })
  })

  describe('isAvailable calculation', () => {
    it('should be true when credits remaining and not expired', () => {
      const item = createBudgetItem({
        creditsTotal: '1000.00',
        creditsUsed: '500.00',
        expiresAt: FUTURE_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].isAvailable).toBe(true)
    })

    it('should be false when no credits remaining', () => {
      const item = createBudgetItem({
        creditsTotal: '1000.00',
        creditsUsed: '1000.00',
        expiresAt: FUTURE_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].isAvailable).toBe(false)
    })

    it('should be false when expired (expiresAt)', () => {
      const item = createBudgetItem({
        creditsTotal: '1000.00',
        creditsUsed: '500.00',
        expiresAt: PAST_DATE,
        resetsAt: null,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].isAvailable).toBe(false)
    })

    it('should be false when expired (resetsAt for plan-monthly)', () => {
      const item = createBudgetItem({
        creditsTotal: '1000.00',
        creditsUsed: '500.00',
        expiresAt: null,
        resetsAt: PAST_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].isAvailable).toBe(false)
    })
  })

  describe('finalState calculation', () => {
    it('should be null when item is active', () => {
      const item = createBudgetItem({
        creditsTotal: '1000.00',
        creditsUsed: '500.00',
        expiresAt: FUTURE_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].finalState).toBeNull()
    })

    it('should be Consumed when credits exhausted', () => {
      const item = createBudgetItem({
        creditsTotal: '1000.00',
        creditsUsed: '1000.00',
        expiresAt: FUTURE_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].finalState).toBe(GrantFinalState.Consumed)
    })

    it('should be Expired when past expiration date', () => {
      const item = createBudgetItem({
        creditsTotal: '1000.00',
        creditsUsed: '500.00',
        expiresAt: PAST_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].finalState).toBe(GrantFinalState.Expired)
    })

    it('should prioritize Expired over Consumed', () => {
      const item = createBudgetItem({
        creditsTotal: '1000.00',
        creditsUsed: '1000.00',
        expiresAt: PAST_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      // Expired takes precedence since it's checked first
      expect(grants[0].finalState).toBe(GrantFinalState.Expired)
    })
  })

  describe('useBefore derivation', () => {
    it('should use resetsAt for plan-monthly items', () => {
      const resetsAt = '2026-05-20T19:01:30Z'
      const item = createBudgetItem({
        label: GrantType.PlanMonthly,
        resetInterval: '1mo',
        resetsAt,
        expiresAt: null,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].useBefore).toBe(resetsAt)
    })

    it('should use expiresAt for credit-pack items', () => {
      const item = createBudgetItem({
        label: GrantType.CreditPack,
        resetInterval: null,
        resetsAt: null,
        expiresAt: FUTURE_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].useBefore).toBe(FUTURE_DATE)
    })

    it('should prefer resetsAt over expiresAt when both present', () => {
      const resetsAt = '2026-05-20T19:01:30Z'
      const item = createBudgetItem({
        resetsAt,
        expiresAt: FUTURE_DATE,
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].useBefore).toBe(resetsAt)
    })

    it('should set useBefore to null when neither resetsAt nor expiresAt is set', () => {
      const item = createBudgetItem({ expiresAt: null, resetsAt: null })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants).toHaveLength(1)
      expect(grants[0].useBefore).toBeNull()
    })
  })

  describe('numeric conversion', () => {
    it('should convert string credits to numbers and floor creditsSpent', () => {
      const item = createBudgetItem({
        creditsTotal: '1500',
        creditsUsed: '750.25',
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].creditsMax).toBe(1500)
      expect(grants[0].creditsSpent).toBe(750) // floored from 750.25
    })

    it('should keep grant available at fractional boundary', () => {
      const item = createBudgetItem({
        creditsTotal: '1000',
        creditsUsed: '999.9',
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      // creditsSpent floored for display, but availability uses unfloored remaining (0.1)
      expect(grants[0].creditsSpent).toBe(999)
      expect(grants[0].isAvailable).toBe(true)
    })

    it('should handle invalid numeric strings as 0', () => {
      const item = createBudgetItem({
        creditsTotal: 'invalid',
        creditsUsed: 'NaN',
      })
      const budget = createBudgetResponse([item])

      const grants = adaptBudgetToGrants(budget, SUBSCRIPTION_ID)

      expect(grants[0].creditsMax).toBe(0)
      expect(grants[0].creditsSpent).toBe(0)
    })
  })
})
