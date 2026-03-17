import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { buildLitellmMetadataFromContext, isGrantsExhausted, LlmCallSource, GrantErrorCode } from '../build-metadata.js'
import { BudgetOverride } from '../grant-session-manager.js'
import { grantSessionManager } from '../grant-session-manager.js'
import { GrantType, type CreditGrant } from '@airo/shared/grants'

describe('build-metadata', function tests() {
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
    // Clean up sessions before each test
    grantSessionManager.removeSession('test-session')
    grantSessionManager.removeSession('background-session')
  })

  afterEach(function cleanup() {
    // Reset the singleton manager to avoid test pollution
    grantSessionManager.reset()
  })

  describe('#buildLitellmMetadataFromContext', function buildTests() {
    it('should return null when context is undefined', function noContext() {
      const result = buildLitellmMetadataFromContext(undefined, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBe(null)
    })

    it('should return null when metadata is missing', function noMetadata() {
      const result = buildLitellmMetadataFromContext({} as any, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBe(null)
    })

    it('should return null when appId is missing', function noAppId() {
      const context = {
        socketId: 'test-session',
        metadata: {
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBe(null)
    })

    it('should use grant userId when feature enabled and grants available', function useGrant() {
      grantSessionManager.setGrants('test-session', [createGrant()], true)

      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe('airo-builder:grant:grant-1')
      expect(result?.tags).toContain('appId:app-1')
      expect(result?.tags).toContain('cid:customer-123')
      expect(result?.tags).toContain('source:user-chat')
    })

    it('should fallback to customerId when feature disabled', function featureDisabled() {
      grantSessionManager.setGrants('test-session', [createGrant()], false)

      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe('customer-123')
    })

    it('should fallback to customerId when no grants available', function noGrants() {
      grantSessionManager.setGrants('test-session', [], true)

      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe('customer-123')
    })

    it('should return null when all grants exhausted', function exhausted() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('test-session', [exhaustedGrant], true)

      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBe(null)
    })

    it('should include correct tags from source', function tags() {
      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
        },
      }

      const userChatResult = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })
      expect(userChatResult?.tags).toContain('source:user-chat')

      const toolResult = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.ToolQaAnalyze,
      })
      expect(toolResult?.tags).toContain('source:tool:qa-analyze')
    })

    it('should include agentId in tags when provided', function agentId() {
      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
        agentId: 'test-agent',
      })

      expect(result?.tags).toContain('agent:test-agent')
    })
  })

  describe('#isGrantsExhausted', function exhaustedTests() {
    it('should return false when context has no socketId', function noSocketId() {
      const context = { metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false when feature disabled', function disabled() {
      grantSessionManager.setGrants('test-session', [], false)
      const context = { socketId: 'test-session', metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false when session has no grants', function noGrants() {
      grantSessionManager.setGrants('test-session', [], true)
      const context = { socketId: 'test-session', metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false when usable grant exists', function usable() {
      grantSessionManager.setGrants('test-session', [createGrant()], true)
      const context = { socketId: 'test-session', metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return true when all grants exhausted', function allExhausted() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('test-session', [exhaustedGrant], true)

      const context = { socketId: 'test-session', metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(true)
    })
  })

  describe('LlmCallSource', function sourceTests() {
    it('should have expected values', function values() {
      expect(LlmCallSource.UserChat).toBe('user-chat')
      expect(LlmCallSource.ServiceNameSuggestion).toBe('service:name-suggestion')
      expect(LlmCallSource.ToolQaAnalyze).toBe('tool:qa-analyze')
      expect(LlmCallSource.ToolFontTheme).toBe('tool:font-theme')
      expect(LlmCallSource.ToolColorScheme).toBe('tool:color-scheme')
    })
  })

  describe('GrantErrorCode', function errorTests() {
    it('should have expected values', function values() {
      expect(GrantErrorCode.AllGrantsExhausted).toBe('GRANTS_ALL_EXHAUSTED')
      expect(GrantErrorCode.GrantFetchFailed).toBe('GRANTS_FETCH_FAILED')
      expect(GrantErrorCode.NoGrantsAvailable).toBe('GRANTS_NONE_AVAILABLE')
    })
  })

  describe('Care agent bypass (E2S)', function careAgentTests() {
    it('should bypass grants for care agent sessions', function bypass() {
      // Even with grants enabled, care agent should use its own identifier
      grantSessionManager.setGrants('care-session', [createGrant()], true)

      const context = {
        socketId: 'care-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
          subscriptionId: BudgetOverride.CareAgent,
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.CareAgent)
      expect(result?.tags).toContain('appId:app-1')
    })
  })

  describe('Test accounts bypass (switchboard flag)', function testAccountsTests() {
    it('should bypass grants for test accounts sessions', function bypass() {
      // Even with grants enabled, test accounts should use its own identifier
      grantSessionManager.setGrants('test-accounts-session', [createGrant()], true)

      const context = {
        socketId: 'test-accounts-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
          subscriptionId: BudgetOverride.TestAccounts,
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.TestAccounts)
      expect(result?.tags).toContain('appId:app-1')
    })
  })

  describe('Budget override via explicit subscriptionId (correct pattern)', function explicitOverrideTests() {
    it('should use CareAgent budget when subscriptionId is explicitly set (E2S-triggered task)', function e2sTriggered() {
      // E2S-triggered background task: subscriptionId is set to CareAgent by the trigger point
      const context = {
        // No socketId - background task
        metadata: {
          appId: 'app-e2s-triggered',
          subscriptionId: BudgetOverride.CareAgent, // Explicitly set by trigger
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.ServiceSummarization,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.CareAgent)
    })

    it('should use TestAccounts budget when subscriptionId is explicitly set (test-budget-triggered task)', function testBudgetTriggered() {
      // Test-budget-triggered background task: subscriptionId is set by the trigger point
      const context = {
        metadata: {
          appId: 'app-test-triggered',
          subscriptionId: BudgetOverride.TestAccounts, // Explicitly set by trigger
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.ServiceSummarization,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.TestAccounts)
    })

    it('should use customer grants regardless of other sessions', function noRaceCondition() {
      // Set up customer grants
      grantSessionManager.setGrants('customer-session', [
        createGrant({
          subscriptionId: 'sub-customer-race',
          llmBudgetUserId: 'airo-builder:grant:customer-grant',
        }),
      ], true)

      // Customer-triggered background task: subscriptionId is customer's (NOT a BudgetOverride value)
      const context = {
        metadata: {
          appId: 'app-race',
          subscriptionId: 'sub-customer-race', // Customer's subscription
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.ServiceSummarization,
      })

      // Should use customer grants based on explicit subscriptionId
      expect(result).toBeDefined()
      expect(result?.user).toBe('airo-builder:grant:customer-grant')
    })
  })

  describe('Background task grant lookup', function backgroundTaskTests() {
    it('should use grant from subscription when no socketId (background task)', function noSocket() {
      // Simulate a websocket session that indexed grants for this subscription
      grantSessionManager.setGrants('websocket-session', [
        createGrant({
          subscriptionId: 'sub-background',
          llmBudgetUserId: 'airo-builder:grant:background',
        }),
      ], true)

      // Background task has subscriptionId but no socketId
      const context = {
        // No socketId - background task
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-background',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.ServiceSummarization,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe('airo-builder:grant:background')
    })

    it('should return null when subscription grants are exhausted (background task)', function exhausted() {
      // Subscription has grants but all are exhausted
      grantSessionManager.setGrants('websocket-session', [
        createGrant({
          subscriptionId: 'sub-exhausted',
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
      ], true)

      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-exhausted',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.ServiceSummarization,
      })

      // Should return null when grants exhausted (no fallback to customerId)
      expect(result).toBe(null)
    })

    it('should fallback to subscriptionId when no grants indexed (background task)', function fallback() {
      // No grants indexed for this subscription, but feature enabled
      // This happens when background task runs before websocket session indexes grants

      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-no-grants',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.ServiceSummarization,
      })

      expect(result).toBeDefined()
      // Should fallback to prefixed subscriptionId
      expect(result?.user).toBe('airo-build:sid:sub-no-grants')
    })
  })

  describe('SubscriptionId fallback', function subscriptionFallbackTests() {
    it('should fallback to subscriptionId when feature disabled', function featureOff() {
      grantSessionManager.setGrants('test-session', [createGrant()], false)

      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-123',
          customerId: 'customer-456',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBeDefined()
      // Should use prefixed subscriptionId, not customerId
      expect(result?.user).toBe('airo-build:sid:sub-123')
    })

    it('should add prefix to subscriptionId if not already prefixed', function addPrefix() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'raw-sub-id',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result?.user).toBe('airo-build:sid:raw-sub-id')
    })

    it('should not double-prefix already prefixed subscriptionId', function noDoublePrefix() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'airo-build:sid:already-prefixed',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result?.user).toBe('airo-build:sid:already-prefixed')
    })

    it('should fallback to customerId only when no subscriptionId', function customerIdFallback() {
      const context = {
        metadata: {
          appId: 'app-1',
          customerId: 'customer-last-resort',
          // No subscriptionId
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result?.user).toBe('customer-last-resort')
    })
  })
})
