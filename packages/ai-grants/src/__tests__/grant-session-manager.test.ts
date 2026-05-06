import { describe, it, expect, beforeEach } from 'vitest'

import { GrantSessionManager } from '../grant-session-manager.js'
import { GrantType, GrantFinalState, type CreditGrant } from '@airo/shared/grants'

describe('grant-session-manager', function tests() {
  let sessionManager: GrantSessionManager

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

  beforeEach(function setup() {
    sessionManager = new GrantSessionManager()
  })

  describe('#setGrants', function setGrantsTests() {
    it('should store grants for a session', function store() {
      const grants = [createGrant()]
      sessionManager.setGrants('session-1', grants)

      expect(sessionManager.hasGrants('session-1')).toBe(true)
    })

    it('should sort grants by useBefore date', function sort() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-later',
          useBefore: new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-earliest',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', grants)

      const state = sessionManager.getState('session-1')
      expect(state?.grants[0]?.id).toBe('grant-earliest')
      expect(state?.grants[1]?.id).toBe('grant-later')
    })

    it('should preserve currentIndex when grant still exists', function preserveIndex() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-2',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', grants)

      // Advance to grant-2
      sessionManager.advanceToNextGrant('session-1')

      // Update grants (same ids, different order input but will be sorted same)
      sessionManager.setGrants('session-1', [...grants].reverse())

      const state = sessionManager.getState('session-1')
      expect(state?.currentIndex).toBe(1) // Should still be at grant-2
    })
  })

  describe('#getCurrentUserId', function getUserIdTests() {
    it('should return fallback when no grants in session', function noGrants() {
      sessionManager.setGrants('session-1', [])

      const userId = sessionManager.getCurrentUserId('session-1', 'customer-123')
      expect(userId).toBe('customer-123')
    })

    it('should return grant llmBudgetUserId when grant available', function grantUserId() {
      const grant = createGrant({ llmBudgetUserId: 'airo-builder:grant:test-grant' })
      sessionManager.setGrants('session-1', [grant])

      const userId = sessionManager.getCurrentUserId('session-1', 'customer-123')
      expect(userId).toBe('airo-builder:grant:test-grant')
    })

    it('should return undefined when all grants exhausted', function exhausted() {
      const grants = [
        createGrant({ id: 'grant-1', creditsSpent: 1500, creditsMax: 1500 }),
        createGrant({ id: 'grant-2', finalState: GrantFinalState.Consumed }),
      ]
      sessionManager.setGrants('session-1', grants)

      const userId = sessionManager.getCurrentUserId('session-1', 'customer-123')
      expect(userId).toBeUndefined()
    })

    it('should skip unusable grants and return first usable', function skipUnusable() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-exhausted',
          useBefore: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
        createGrant({
          id: 'grant-usable',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:usable',
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      const userId = sessionManager.getCurrentUserId('session-1', 'customer-123')
      expect(userId).toBe('airo-builder:grant:usable')
    })

    it('should automatically skip to next grant when current grant becomes exhausted between calls', function dynamicExhaustion() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:1',
          creditsSpent: 1400, // Near limit but usable
          creditsMax: 1500,
        }),
        createGrant({
          id: 'grant-2',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:2',
          creditsSpent: 0,
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      // First call: grant-1 is usable
      const firstUserId = sessionManager.getCurrentUserId('session-1', 'customer-123')
      expect(firstUserId).toBe('airo-builder:grant:1')

      // Simulate grant-1 becoming exhausted (LLM consumed remaining credits)
      const state = sessionManager.getState('session-1')
      if (state?.grants[0]) {
        state.grants[0].creditsSpent = 1500 // Now exhausted
      }

      // Second call: should automatically skip to grant-2
      const secondUserId = sessionManager.getCurrentUserId('session-1', 'customer-123')
      expect(secondUserId).toBe('airo-builder:grant:2')
    })

    it('should return undefined when grant becomes exhausted and no other grants available', function dynamicExhaustionNoFallback() {
      const grants = [
        createGrant({
          id: 'grant-1',
          llmBudgetUserId: 'airo-builder:grant:1',
          creditsSpent: 1400,
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      // First call: grant usable
      expect(sessionManager.getCurrentUserId('session-1', 'customer-123')).toBe('airo-builder:grant:1')

      // Simulate exhaustion
      const state = sessionManager.getState('session-1')
      if (state?.grants[0]) {
        state.grants[0].creditsSpent = 1500
      }

      // Second call: should return undefined (not fall back to customerId)
      expect(sessionManager.getCurrentUserId('session-1', 'customer-123')).toBeUndefined()
    })

  })

  describe('#advanceToNextGrant', function advanceTests() {
    it('should return false when session does not exist', function noSession() {
      expect(sessionManager.advanceToNextGrant('nonexistent')).toBe(false)
    })

    it('should return false when no more usable grants', function noMore() {
      const grants = [createGrant({ creditsSpent: 1500, creditsMax: 1500 })]
      sessionManager.setGrants('session-1', grants)

      expect(sessionManager.advanceToNextGrant('session-1')).toBe(false)
    })

    it('should advance to next usable grant and return true', function advance() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:1',
        }),
        createGrant({
          id: 'grant-2',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:2',
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      // First call returns grant-1
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:1')

      // Advance
      const advanced = sessionManager.advanceToNextGrant('session-1')
      expect(advanced).toBe(true)

      // Now returns grant-2
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:2')
    })

    it('should simulate budget exceeded error flow: get userId -> budget exceeded -> advance -> retry with new grant', function budgetExceededFlow() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:1',
          creditsSpent: 1490,
          creditsMax: 1500,
        }),
        createGrant({
          id: 'grant-2',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:2',
          creditsSpent: 0,
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      // Step 1: Get initial userId (would be used for LLM call)
      const initialUserId = sessionManager.getCurrentUserId('session-1')
      expect(initialUserId).toBe('airo-builder:grant:1')

      // Step 2: LLM call happens, budget exceeded error returned
      // (LiteLLM returns error because grant-1 budget was exceeded)

      // Step 3: Call advanceToNextGrant to move to next grant
      const advanced = sessionManager.advanceToNextGrant('session-1')
      expect(advanced).toBe(true)

      // Step 4: Get new userId for retry
      const retryUserId = sessionManager.getCurrentUserId('session-1')
      expect(retryUserId).toBe('airo-builder:grant:2')

      // Verify we moved from grant-1 to grant-2
      expect(retryUserId).not.toBe(initialUserId)
    })

    it('should return false when budget exceeded and no more grants available', function budgetExceededNoMoreGrants() {
      const grants = [
        createGrant({
          id: 'only-grant',
          llmBudgetUserId: 'airo-builder:grant:only',
          creditsSpent: 1490,
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      // Get initial userId
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:only')

      // Budget exceeded, try to advance - should fail (no more grants)
      const advanced = sessionManager.advanceToNextGrant('session-1')
      expect(advanced).toBe(false)

      // Simulate the grant becoming exhausted
      const state = sessionManager.getState('session-1')
      if (state?.grants[0]) {
        state.grants[0].creditsSpent = 1500
      }

      // Now getCurrentUserId should return undefined (all exhausted)
      expect(sessionManager.getCurrentUserId('session-1')).toBeUndefined()
    })

    it('should skip exhausted grants when advancing', function skipExhausted() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-2-exhausted',
          useBefore: new Date(now + 15 * 24 * 60 * 60 * 1000).toISOString(),
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
        createGrant({
          id: 'grant-3',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:3',
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      // Advance (should skip grant-2-exhausted)
      const advanced = sessionManager.advanceToNextGrant('session-1')
      expect(advanced).toBe(true)

      // Should be at grant-3
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:3')
    })
  })

  describe('#hasGrants', function hasGrantsTests() {
    it('should return false for nonexistent session', function nonexistent() {
      expect(sessionManager.hasGrants('nonexistent')).toBe(false)
    })

    it('should return false when grants array is empty', function empty() {
      sessionManager.setGrants('session-1', [])
      expect(sessionManager.hasGrants('session-1')).toBe(false)
    })

    it('should return true when grants exist', function exists() {
      sessionManager.setGrants('session-1', [createGrant()])
      expect(sessionManager.hasGrants('session-1')).toBe(true)
    })
  })

  describe('#isStale', function staleTests() {
    it('should return true for nonexistent session', function nonexistent() {
      expect(sessionManager.isStale('nonexistent')).toBe(true)
    })

    it('should return false for fresh session', function fresh() {
      sessionManager.setGrants('session-1', [createGrant()])
      expect(sessionManager.isStale('session-1')).toBe(false)
    })

    it('should return true for stale session', function stale() {
      sessionManager.setGrants('session-1', [createGrant()])

      // Manually make it stale by setting lastUpdated in the past
      const state = sessionManager.getState('session-1')
      if (state) {
        state.lastUpdated = Date.now() - 10 * 60 * 1000 // 10 minutes ago
      }

      expect(sessionManager.isStale('session-1', 5 * 60 * 1000)).toBe(true)
    })
  })

  describe('#removeSession', function removeTests() {
    it('should remove session', function remove() {
      sessionManager.setGrants('session-1', [createGrant()])
      expect(sessionManager.hasGrants('session-1')).toBe(true)

      sessionManager.removeSession('session-1')
      expect(sessionManager.hasGrants('session-1')).toBe(false)
    })

    it('should not throw when removing nonexistent session', function nonexistent() {
      expect(() => sessionManager.removeSession('nonexistent')).not.toThrow()
    })
  })

  describe('#getSocketCount and #getSubscriptionCount', function countTests() {
    it('should return 0 for no sessions', function zero() {
      expect(sessionManager.getSocketCount()).toBe(0)
      expect(sessionManager.getSubscriptionCount()).toBe(0)
    })

    it('should track socket mappings and subscriptions separately', function count() {
      // Three sockets, but two share the same subscription
      sessionManager.setGrants('session-1', [createGrant({ subscriptionId: 'sub-1' })])
      sessionManager.setGrants('session-2', [createGrant({ subscriptionId: 'sub-1' })]) // Same sub
      sessionManager.setGrants('session-3', [createGrant({ subscriptionId: 'sub-2' })])

      expect(sessionManager.getSocketCount()).toBe(3)
      expect(sessionManager.getSubscriptionCount()).toBe(2) // Only 2 unique subscriptions
    })
  })

  describe('Multi-socket subscription sharing', function multiSocketTests() {
    it('should share grant state across multiple sockets with same subscription', function shareState() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-1',
          subscriptionId: 'sub-shared',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:1',
        }),
        createGrant({
          id: 'grant-2',
          subscriptionId: 'sub-shared',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
          llmBudgetUserId: 'airo-builder:grant:2',
        }),
      ]

      // Two browser tabs (sockets) for same user/subscription
      sessionManager.setGrants('socket-tab-1', grants)
      sessionManager.setGrants('socket-tab-2', grants)

      // Both sockets start at grant-1
      expect(sessionManager.getCurrentUserId('socket-tab-1')).toBe('airo-builder:grant:1')
      expect(sessionManager.getCurrentUserId('socket-tab-2')).toBe('airo-builder:grant:1')

      // Tab 1 exhausts grant-1 and advances
      sessionManager.advanceToNextGrant('socket-tab-1')

      // Tab 2 should also see the advanced state (shared subscription state)
      expect(sessionManager.getCurrentUserId('socket-tab-1')).toBe('airo-builder:grant:2')
      expect(sessionManager.getCurrentUserId('socket-tab-2')).toBe('airo-builder:grant:2')
    })

    it('should not share state between different subscriptions', function isolateState() {
      const now = Date.now()
      const grants1 = [
        createGrant({
          id: 'grant-1',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-2',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:2',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]
      const grants2 = [
        createGrant({
          id: 'grant-3',
          subscriptionId: 'sub-2',
          llmBudgetUserId: 'airo-builder:grant:3',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('socket-user-1', grants1)
      sessionManager.setGrants('socket-user-2', grants2)

      // Advance user 1
      sessionManager.advanceToNextGrant('socket-user-1')

      // User 2 should be unaffected
      expect(sessionManager.getCurrentUserId('socket-user-1')).toBe('airo-builder:grant:2')
      expect(sessionManager.getCurrentUserId('socket-user-2')).toBe('airo-builder:grant:3')
    })
  })

  describe('#getUserIdBySubscription (background tasks)', function backgroundTaskTests() {
    it('should return undefined when subscription not found', function notFound() {
      expect(sessionManager.getUserIdBySubscription('nonexistent')).toBeUndefined()
    })

    it('should return grant userId for valid subscription', function valid() {
      sessionManager.setGrants('session-1', [
        createGrant({
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:test',
        }),
      ])

      expect(sessionManager.getUserIdBySubscription('sub-1')).toBe('airo-builder:grant:test')
    })

    it('should return undefined when all grants exhausted', function exhausted() {
      sessionManager.setGrants('session-1', [
        createGrant({
          subscriptionId: 'sub-1',
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
      ])

      expect(sessionManager.getUserIdBySubscription('sub-1')).toBeUndefined()
    })

    it('should respect grant advancement from websocket sessions', function respectAdvancement() {
      const now = Date.now()
      const grants = [
        createGrant({
          id: 'grant-1',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-2',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:2',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', grants)

      // Initial state
      expect(sessionManager.getUserIdBySubscription('sub-1')).toBe('airo-builder:grant:1')

      // Websocket session advances to next grant
      sessionManager.advanceToNextGrant('session-1')

      // Background task lookup should see advanced state
      expect(sessionManager.getUserIdBySubscription('sub-1')).toBe('airo-builder:grant:2')
    })
  })

  describe('#hasGrantsBySubscription', function hasGrantsBySubTests() {
    it('should return false for nonexistent subscription', function notFound() {
      expect(sessionManager.hasGrantsBySubscription('nonexistent')).toBe(false)
    })

    it('should return true when subscription has grants', function hasGrants() {
      sessionManager.setGrants('session-1', [createGrant({ subscriptionId: 'sub-1' })])
      expect(sessionManager.hasGrantsBySubscription('sub-1')).toBe(true)
    })
  })

  describe('Index reset on grant removal', function indexResetTests() {
    it('should reset index to first usable grant when current grant is removed', function resetOnRemoval() {
      const now = Date.now()

      // Initial: 3 grants, currently at grant-2
      const initialGrants = [
        createGrant({
          id: 'grant-1',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-2',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:2',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-3',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:3',
          useBefore: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', initialGrants)
      sessionManager.advanceToNextGrant('session-1') // Now at grant-2

      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:2')

      // Refresh: grant-2 was consumed/removed, only grant-1 and grant-3 remain
      const refreshedGrants = [
        createGrant({
          id: 'grant-1',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-3',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:3',
          useBefore: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', refreshedGrants)

      // Should reset to first usable grant (grant-1), not skip to grant-3
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:1')
    })

    it('should find first usable grant when current is removed and earlier grants exhausted', function findFirstUsable() {
      const now = Date.now()

      const initialGrants = [
        createGrant({
          id: 'grant-1',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:1',
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-2',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:2',
          useBefore: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', initialGrants)
      sessionManager.advanceToNextGrant('session-1') // Now at grant-2

      // Refresh: grant-2 removed, grant-1 now exhausted, new grant-3 added
      const refreshedGrants = [
        createGrant({
          id: 'grant-1',
          subscriptionId: 'sub-1',
          creditsSpent: 1500, // Exhausted
          creditsMax: 1500,
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-3',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:3',
          useBefore: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', refreshedGrants)

      // Should skip exhausted grant-1 and use grant-3
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:3')
    })

    it('should reset index when current grant becomes unusable (exhausted) even if still in list', function resetOnUnusable() {
      const now = Date.now()

      // Start with a usable grant
      const initialGrants = [
        createGrant({
          id: 'grant-monthly',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:monthly',
          creditsSpent: 500,
          creditsMax: 1500,
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', initialGrants)
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:monthly')

      // Refresh: same grant now exhausted, but new credit pack added
      const refreshedGrants = [
        createGrant({
          id: 'grant-monthly',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:monthly',
          creditsSpent: 1500, // Exhausted
          creditsMax: 1500,
          useBefore: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createGrant({
          id: 'grant-pack',
          subscriptionId: 'sub-1',
          type: GrantType.CreditPack,
          llmBudgetUserId: 'airo-builder:grant:pack',
          creditsSpent: 0,
          creditsMax: 5000,
          useBefore: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ]

      sessionManager.setGrants('session-1', refreshedGrants)

      // Should automatically switch to the new credit pack
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:pack')
    })

    it('should switch to earlier-expiring grant when user upgrades plan (Issue 2 fix)', function switchToEarlierGrant() {
      const now = Date.now()

      // Initial state: Free plan exhausted, using credit pack
      const initialGrants = [
        createGrant({
          id: 'grant-free',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:free',
          creditsSpent: 1500, // Exhausted
          creditsMax: 1500,
          useBefore: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days
        }),
        createGrant({
          id: 'grant-credit-pack',
          subscriptionId: 'sub-1',
          type: GrantType.CreditPack,
          llmBudgetUserId: 'airo-builder:grant:credit-pack',
          creditsSpent: 100,
          creditsMax: 5000,
          useBefore: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(), // 365 days
        }),
      ]

      sessionManager.setGrants('session-1', initialGrants)

      // Free is exhausted, so should be using credit pack
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:credit-pack')

      // Verify currentIndex is at credit pack (index 1)
      const stateBeforeUpgrade = sessionManager.getState('session-1')
      expect(stateBeforeUpgrade?.currentIndex).toBe(1)

      // User upgrades to Starter - new plan grant replaces free, credit pack remains
      const upgradeGrants = [
        createGrant({
          id: 'grant-starter',
          subscriptionId: 'sub-1',
          llmBudgetUserId: 'airo-builder:grant:starter',
          creditsSpent: 0, // Fresh grant
          creditsMax: 3000,
          useBefore: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        }),
        createGrant({
          id: 'grant-credit-pack',
          subscriptionId: 'sub-1',
          type: GrantType.CreditPack,
          llmBudgetUserId: 'airo-builder:grant:credit-pack',
          creditsSpent: 100,
          creditsMax: 5000,
          useBefore: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(), // 365 days
        }),
      ]

      sessionManager.setGrants('session-1', upgradeGrants)

      // Should switch to Starter (expires sooner at 30 days vs credit pack at 365 days)
      // even though credit pack is still usable
      expect(sessionManager.getCurrentUserId('session-1')).toBe('airo-builder:grant:starter')

      // Verify currentIndex is at starter (index 0)
      const stateAfterUpgrade = sessionManager.getState('session-1')
      expect(stateAfterUpgrade?.currentIndex).toBe(0)
    })
  })

  describe('#requestGrantRefreshAndWait', function refreshWaitTests() {
    it('should return false when no callback registered', async function noCallback() {
      const grants = [createGrant()]
      sessionManager.setGrants('session-1', grants)

      const result = await sessionManager.requestGrantRefreshAndWait('session-1', 200)
      expect(result).toBe(false)
    })

    it('should return false when no grants set yet (no subscriptionId)', async function noSubscription() {
      let callbackCalled = false
      sessionManager.setRefreshCallback(() => {
        callbackCalled = true
      })

      // Request refresh for a session that has no grants set yet
      const result = await sessionManager.requestGrantRefreshAndWait('session-without-grants', 200)

      // Should return false immediately without calling the callback
      expect(result).toBe(false)
      expect(callbackCalled).toBe(false)
    })

    it('should call refresh callback and resolve when new grants arrive', async function callbackAndResolve() {
      let callbackCalled = false
      let callbackSessionId: string | null = null

      sessionManager.setRefreshCallback((sessionId) => {
        callbackCalled = true
        callbackSessionId = sessionId
      })

      const initialGrants = [
        createGrant({
          id: 'grant-1',
          creditsSpent: 1500, // Exhausted
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', initialGrants)

      // Start the wait
      const waitPromise = sessionManager.requestGrantRefreshAndWait('session-1', 5000)

      // Callback should be called
      expect(callbackCalled).toBe(true)
      expect(callbackSessionId).toBe('session-1')

      // Simulate frontend sending new grants
      const newGrants = [
        createGrant({
          id: 'grant-1',
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
        createGrant({
          id: 'grant-pack',
          type: GrantType.CreditPack,
          creditsSpent: 0,
          creditsMax: 5000,
        }),
      ]
      sessionManager.setGrants('session-1', newGrants)

      // Wait should resolve with true
      const result = await waitPromise
      expect(result).toBe(true)
    })

    it('should timeout and resolve with false when no grants arrive', async function timeout() {
      let callbackCalled = false

      sessionManager.setRefreshCallback(() => {
        callbackCalled = true
      })

      const grants = [createGrant()]
      sessionManager.setGrants('session-1', grants)

      // Start the wait with short timeout
      const result = await sessionManager.requestGrantRefreshAndWait('session-1', 200)

      expect(callbackCalled).toBe(true)
      expect(result).toBe(false)
    })

    it('should resolve when usable grant arrives even if count unchanged', async function usableGrantArrives() {
      sessionManager.setRefreshCallback(() => {})

      // Start with exhausted grant
      const initialGrants = [
        createGrant({
          id: 'grant-1',
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', initialGrants)

      const waitPromise = sessionManager.requestGrantRefreshAndWait('session-1', 5000)

      // Update same grant count but now has usable grant
      const updatedGrants = [
        createGrant({
          id: 'grant-pack',
          type: GrantType.CreditPack,
          creditsSpent: 0,
          creditsMax: 5000,
        }),
      ]
      sessionManager.setGrants('session-1', updatedGrants)

      const result = await waitPromise
      expect(result).toBe(true)
    })

    it('should share pending promise for concurrent requests on same subscription', async function concurrentRequests() {
      let callbackCount = 0
      sessionManager.setRefreshCallback(() => {
        callbackCount++
      })

      const grants = [
        createGrant({
          id: 'grant-1',
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      // Start two concurrent waits
      const wait1 = sessionManager.requestGrantRefreshAndWait('session-1', 5000)
      const wait2 = sessionManager.requestGrantRefreshAndWait('session-1', 5000)

      // Callback should only be called once (second request reuses pending)
      expect(callbackCount).toBe(1)

      // Send new grants to resolve both
      const newGrants = [
        createGrant({
          id: 'grant-pack',
          type: GrantType.CreditPack,
          creditsSpent: 0,
          creditsMax: 5000,
        }),
      ]
      sessionManager.setGrants('session-1', newGrants)

      // Both waits should resolve to true
      const [result1, result2] = await Promise.all([wait1, wait2])
      expect(result1).toBe(true)
      expect(result2).toBe(true)
    })

    it('should not resolve when grants change but none are usable', async function noUsableAfterRefresh() {
      sessionManager.setRefreshCallback(() => {})

      const initialGrants = [
        createGrant({
          id: 'grant-1',
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', initialGrants)

      const waitPromise = sessionManager.requestGrantRefreshAndWait('session-1', 300)

      // Send new grants that are also exhausted
      const newGrants = [
        createGrant({
          id: 'grant-2',
          creditsSpent: 1500, // Also exhausted
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', newGrants)

      // Should timeout because no usable grant
      const result = await waitPromise
      expect(result).toBe(false)
    })

    it('should cancel pending refresh when last socket disconnects', async function cancelOnDisconnect() {
      sessionManager.setRefreshCallback(() => {})

      const grants = [
        createGrant({
          id: 'grant-1',
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
      ]
      sessionManager.setGrants('session-1', grants)

      // Start a wait
      const waitPromise = sessionManager.requestGrantRefreshAndWait('session-1', 5000)

      // Disconnect the session
      sessionManager.removeSession('session-1')

      // Should resolve to false immediately (not timeout)
      const result = await waitPromise
      expect(result).toBe(false)
    })
  })
})
