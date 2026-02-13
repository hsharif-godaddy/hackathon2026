import { describe, it, expect } from 'vitest'

import { GrantManager, GrantUnusableReason } from '../grant-manager.js'
import { GrantType, GrantFinalState, type CreditGrant } from '../types.js'

describe('grant-manager', function grantManagerTests() {
  function createGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
    return {
      id: 'grant-1',
      subscriptionId: 'sub-1',
      type: GrantType.PlanMonthly,
      llmBudgetUserId: 'airo-builder:grant:grant-1',
      llmBudgetId: 'budget-1',
      creditsMax: 1500,
      creditsSpent: 500,
      isAvailable: true,
      finalState: null,
      useBefore: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      consumedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    }
  }

  describe('#isGrantUsable', function isUsableTests() {
    it('should return true for a usable grant', function usable() {
      const grant = createGrant()
      expect(GrantManager.isGrantUsable(grant)).toBe(true)
    })

    it('should return false when isAvailable is false', function notAvailable() {
      const grant = createGrant({ isAvailable: false })
      expect(GrantManager.isGrantUsable(grant)).toBe(false)
    })

    it('should return false when finalState is consumed', function consumed() {
      const grant = createGrant({ finalState: GrantFinalState.Consumed })
      expect(GrantManager.isGrantUsable(grant)).toBe(false)
    })

    it('should return false when finalState is expired', function expired() {
      const grant = createGrant({ finalState: GrantFinalState.Expired })
      expect(GrantManager.isGrantUsable(grant)).toBe(false)
    })

    it('should return false when creditsSpent equals creditsMax', function exhausted() {
      const grant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      expect(GrantManager.isGrantUsable(grant)).toBe(false)
    })

    it('should return false when creditsSpent exceeds creditsMax', function exceeds() {
      const grant = createGrant({ creditsSpent: 1600, creditsMax: 1500 })
      expect(GrantManager.isGrantUsable(grant)).toBe(false)
    })

    it('should return true when creditsSpent is 0', function zeroSpent() {
      const grant = createGrant({ creditsSpent: 0, creditsMax: 1500 })
      expect(GrantManager.isGrantUsable(grant)).toBe(true)
    })

    it('should return true when creditsSpent is 1 less than creditsMax', function almostExhausted() {
      const grant = createGrant({ creditsSpent: 1499, creditsMax: 1500 })
      expect(GrantManager.isGrantUsable(grant)).toBe(true)
    })

    it('should return false when both creditsSpent and creditsMax are 0', function bothZero() {
      const grant = createGrant({ creditsSpent: 0, creditsMax: 0 })
      expect(GrantManager.isGrantUsable(grant)).toBe(false)
    })

    it('should handle large credit values', function largeValues() {
      const grant = createGrant({ creditsSpent: 99999, creditsMax: 100000 })
      expect(GrantManager.isGrantUsable(grant)).toBe(true)
    })

    it('should return false when creditsSpent greatly exceeds creditsMax', function greatlyExceeds() {
      const grant = createGrant({ creditsSpent: 10000, creditsMax: 1500 })
      expect(GrantManager.isGrantUsable(grant)).toBe(false)
    })

    it('should return false when useBefore is in the past', function pastDate() {
      const grant = createGrant({
        useBefore: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      })
      expect(GrantManager.isGrantUsable(grant)).toBe(false)
    })
  })

  describe('#getUnusableReason', function reasonTests() {
    it('should return null for a usable grant', function usable() {
      const grant = createGrant()
      expect(GrantManager.getUnusableReason(grant)).toBe(null)
    })

    it('should return NotAvailable when isAvailable is false', function notAvailable() {
      const grant = createGrant({ isAvailable: false })
      expect(GrantManager.getUnusableReason(grant)).toBe(GrantUnusableReason.NotAvailable)
    })

    it('should return Consumed when finalState is consumed', function consumed() {
      const grant = createGrant({ isAvailable: true, finalState: GrantFinalState.Consumed })
      expect(GrantManager.getUnusableReason(grant)).toBe(GrantUnusableReason.Consumed)
    })

    it('should return Exhausted when creditsSpent equals creditsMax', function exhausted() {
      const grant = createGrant({
        isAvailable: true,
        finalState: null,
        creditsSpent: 1500,
        creditsMax: 1500,
      })
      expect(GrantManager.getUnusableReason(grant)).toBe(GrantUnusableReason.Exhausted)
    })

    it('should return Exhausted when creditsSpent exceeds creditsMax', function exceeds() {
      const grant = createGrant({
        isAvailable: true,
        finalState: null,
        creditsSpent: 2000,
        creditsMax: 1500,
      })
      expect(GrantManager.getUnusableReason(grant)).toBe(GrantUnusableReason.Exhausted)
    })

    it('should return null when creditsSpent is 0', function zeroSpent() {
      const grant = createGrant({
        isAvailable: true,
        finalState: null,
        creditsSpent: 0,
        creditsMax: 1500,
      })
      expect(GrantManager.getUnusableReason(grant)).toBe(null)
    })

    it('should return null when creditsSpent is 1 less than creditsMax', function almostExhausted() {
      const grant = createGrant({
        isAvailable: true,
        finalState: null,
        creditsSpent: 1499,
        creditsMax: 1500,
      })
      expect(GrantManager.getUnusableReason(grant)).toBe(null)
    })

    it('should return Exhausted when both creditsSpent and creditsMax are 0', function bothZero() {
      const grant = createGrant({
        isAvailable: true,
        finalState: null,
        creditsSpent: 0,
        creditsMax: 0,
      })
      expect(GrantManager.getUnusableReason(grant)).toBe(GrantUnusableReason.Exhausted)
    })

    it('should return Expired when useBefore is in the past', function expired() {
      const grant = createGrant({
        isAvailable: true,
        finalState: null,
        creditsSpent: 500,
        useBefore: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      })
      expect(GrantManager.getUnusableReason(grant)).toBe(GrantUnusableReason.Expired)
    })

    it('should prioritize NotAvailable over other reasons', function priority() {
      const grant = createGrant({
        isAvailable: false,
        finalState: GrantFinalState.Consumed,
        creditsSpent: 1500,
        useBefore: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      })
      expect(GrantManager.getUnusableReason(grant)).toBe(GrantUnusableReason.NotAvailable)
    })
  })

  describe('#selectBestGrant', function selectTests() {
    it('should return null when grants array is empty', function emptyArray() {
      expect(GrantManager.selectBestGrant([])).toBe(null)
    })

    it('should return the only usable grant', function singleGrant() {
      const grant = createGrant()
      expect(GrantManager.selectBestGrant([grant])).toEqual(grant)
    })

    it('should return null when no grants are usable', function noUsable() {
      const grants = [
        createGrant({ id: 'grant-1', isAvailable: false }),
        createGrant({ id: 'grant-2', finalState: GrantFinalState.Consumed }),
        createGrant({ id: 'grant-3', creditsSpent: 1500, creditsMax: 1500 }),
      ]
      expect(GrantManager.selectBestGrant(grants)).toBe(null)
    })

    it('should select grant with closest useBefore date', function selectClosest() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-later',
          useBefore: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-earliest',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-middle',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      const selected = GrantManager.selectBestGrant(grants)
      expect(selected?.id).toBe('grant-earliest')
    })

    it('should filter out unusable grants before selecting', function filterUnusable() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-earliest-but-exhausted',
          useBefore: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
        createGrant({
          id: 'grant-usable',
          useBefore: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      const selected = GrantManager.selectBestGrant(grants)
      expect(selected?.id).toBe('grant-usable')
    })

    it('should handle mixed grant types', function mixedTypes() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'credit-pack',
          type: GrantType.CreditPack,
          useBefore: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'plan-monthly',
          type: GrantType.PlanMonthly,
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      const selected = GrantManager.selectBestGrant(grants)
      expect(selected?.id).toBe('plan-monthly')
    })
  })
})
