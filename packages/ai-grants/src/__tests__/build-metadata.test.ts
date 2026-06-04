import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { buildLitellmMetadataFromContext, isGrantsExhausted, LlmCallSource, GrantErrorCode } from '../build-metadata.js'
import { grantSessionManager } from '../grant-session-manager.js'
import { BudgetOverride, isBudgetOverride } from '../budget-override.js'
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
      grantSessionManager.setGrants('test-session', [createGrant()])

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

    it('should fallback to customerId when no grants available', function noGrants() {
      grantSessionManager.setGrants('test-session', [])

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
      grantSessionManager.setGrants('test-session', [exhaustedGrant])

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

    it('should include mode:grants tag when budgetServiceEnabled is false', function modeGrants() {
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
      expect(result?.tags).toContain('mode:grants')
    })

    it('should include mode:bms tag when budgetServiceEnabled is true', function modeBms() {
      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
          subscriptionId: 'sub-1',
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-1',
          budgetSessionId: 'session-1',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })
      expect(result?.tags).toContain('mode:bms')
    })
  })

  describe('#isGrantsExhausted', function exhaustedTests() {
    it('should return false when context has no socketId', function noSocketId() {
      const context = { metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false when session has no grants', function noGrants() {
      grantSessionManager.setGrants('test-session', [])
      const context = { socketId: 'test-session', metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false when usable grant exists', function usable() {
      grantSessionManager.setGrants('test-session', [createGrant()])
      const context = { socketId: 'test-session', metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return true when all grants exhausted', function allExhausted() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('test-session', [exhaustedGrant])

      const context = { socketId: 'test-session', metadata: { appId: 'app-1' } }
      expect(isGrantsExhausted(context)).toBe(true)
    })

    it('should return false for e2s sessions even with exhausted customer grants', function e2sBypass() {
      // Customer grants are exhausted
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('e2s-session', [exhaustedGrant])

      // But subscriptionId is CareAgent (e2s session)
      const context = {
        socketId: 'e2s-session',
        metadata: {
          appId: 'app-1',
          subscriptionId: BudgetOverride.CareAgent,
        },
      }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false for test accounts even with exhausted grants', function testAccountsBypass() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('test-session', [exhaustedGrant])

      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          subscriptionId: BudgetOverride.TestAccounts,
        },
      }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false for AssessAgent override with exhausted grants', function assessAgentBypass() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('assess-session', [exhaustedGrant])

      const context = {
        socketId: 'assess-session',
        metadata: { appId: 'app-1', subscriptionId: BudgetOverride.AssessAgent },
      }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false for PublishTask override with exhausted grants', function publishTaskBypass() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('publish-session', [exhaustedGrant])

      const context = {
        socketId: 'publish-session',
        metadata: { appId: 'app-1', subscriptionId: BudgetOverride.PublishTask },
      }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false for DomainTask override with exhausted grants', function domainTaskBypass() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('domain-session', [exhaustedGrant])

      const context = {
        socketId: 'domain-session',
        metadata: { appId: 'app-1', subscriptionId: BudgetOverride.DomainTask },
      }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false for FixTask override with exhausted grants', function fixTaskBypass() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('fix-session', [exhaustedGrant])

      const context = {
        socketId: 'fix-session',
        metadata: { appId: 'app-1', subscriptionId: BudgetOverride.FixTask },
      }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false for SummarizationTask override with exhausted grants', function summarizationTaskBypass() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('summarization-session', [exhaustedGrant])

      const context = {
        socketId: 'summarization-session',
        metadata: { appId: 'app-1', subscriptionId: BudgetOverride.SummarizationTask },
      }
      expect(isGrantsExhausted(context)).toBe(false)
    })

    it('should return false for CareAgent override even with usable (non-exhausted) grant', function unconditionalBypass() {
      // Usable grant with credits remaining — proves bypass is unconditional
      const usableGrant = createGrant({ creditsSpent: 500, creditsMax: 1500 })
      grantSessionManager.setGrants('e2s-usable-session', [usableGrant])

      const context = {
        socketId: 'e2s-usable-session',
        metadata: { appId: 'app-1', subscriptionId: BudgetOverride.CareAgent },
      }
      expect(isGrantsExhausted(context)).toBe(false)
    })
  })

  describe('isBudgetOverride', function budgetOverrideTests() {
    it('should return true for all BudgetOverride values', function allValues() {
      // Use Object.values to auto-update when enum changes
      const allOverrides = Object.values(BudgetOverride)
      expect(allOverrides.length).toBeGreaterThan(0)
      for (const override of allOverrides) {
        expect(isBudgetOverride(override)).toBe(true)
      }
    })

    it('should return false for non-override values', function nonOverrides() {
      expect(isBudgetOverride(undefined)).toBe(false)
      expect(isBudgetOverride('')).toBe(false)
      expect(isBudgetOverride('sub-123')).toBe(false)
      expect(isBudgetOverride('airo-build:sid:sub-123')).toBe(false)
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
      grantSessionManager.setGrants('care-session', [createGrant()])

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
      grantSessionManager.setGrants('test-accounts-session', [createGrant()])

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

  describe('Task-specific budget overrides with active session', function taskOverrideTests() {
    it('should bypass grants for AssessAgent override with active session', function assessAgent() {
      grantSessionManager.setGrants('assess-meta-session', [createGrant()])

      const context = {
        socketId: 'assess-meta-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
          subscriptionId: BudgetOverride.AssessAgent,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.AssessAgent)
    })

    it('should bypass grants for PublishTask override with active session', function publishTask() {
      grantSessionManager.setGrants('publish-meta-session', [createGrant()])

      const context = {
        socketId: 'publish-meta-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
          subscriptionId: BudgetOverride.PublishTask,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.PublishTask)
    })

    it('should bypass grants for DomainTask override with active session', function domainTask() {
      grantSessionManager.setGrants('domain-meta-session', [createGrant()])

      const context = {
        socketId: 'domain-meta-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
          subscriptionId: BudgetOverride.DomainTask,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.DomainTask)
    })

    it('should bypass grants for FixTask override with active session', function fixTask() {
      grantSessionManager.setGrants('fix-meta-session', [createGrant()])

      const context = {
        socketId: 'fix-meta-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
          subscriptionId: BudgetOverride.FixTask,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.FixTask)
    })

    it('should bypass grants for SummarizationTask override with active session', function summarizationTask() {
      grantSessionManager.setGrants('summarization-meta-session', [createGrant()])

      const context = {
        socketId: 'summarization-meta-session',
        metadata: {
          appId: 'app-1',
          customerId: 'customer-123',
          subscriptionId: BudgetOverride.SummarizationTask,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.user).toBe(BudgetOverride.SummarizationTask)
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
      ])

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
      ])

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
      ])

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

  describe('Reconnection grant recovery', function reconnectTests() {
    it('should use subscription-based grant lookup when socket has no mapping', function reconnectRecovery() {
      // Simulate grants indexed by a previous socket for this subscription
      grantSessionManager.setGrants('old-socket', [
        createGrant({
          subscriptionId: 'sub-reconnect',
          llmBudgetUserId: 'airo-builder:grant:reconnect-grant',
        }),
      ])

      // New socket has no mapping — simulates reconnection race
      const context = {
        socketId: 'new-socket',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'airo-build:sid:sub-reconnect', // prefixed, from app DB
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      expect(result).toBeDefined()
      expect(result?.user).toBe('airo-builder:grant:reconnect-grant')
    })

    it('should restore socket mapping after recovery', function restoresMapping() {
      // Simulate grants indexed by a previous socket
      grantSessionManager.setGrants('old-socket', [
        createGrant({
          subscriptionId: 'sub-restore',
          llmBudgetUserId: 'airo-builder:grant:restore-grant',
        }),
      ])

      const context = {
        socketId: 'new-socket-restore',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-restore',
          customerId: 'customer-123',
        },
      }

      // First call recovers via subscription lookup
      buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      // Socket should now have the mapping — hasGrants should return true
      expect(grantSessionManager.hasGrants('new-socket-restore')).toBe(true)
    })

    it('should return null when subscription grants all exhausted on reconnect', function reconnectExhausted() {
      // All grants exhausted for this subscription
      grantSessionManager.setGrants('old-socket', [
        createGrant({
          subscriptionId: 'sub-exhausted-reconnect',
          creditsSpent: 1500,
          creditsMax: 1500,
        }),
      ])

      const context = {
        socketId: 'new-socket-exhausted',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'airo-build:sid:sub-exhausted-reconnect',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      // Should return null (blocked) — not fall through to SID or customerId
      expect(result).toBe(null)
    })

    it('should fall through when no grants indexed for subscription', function reconnectNoGrants() {
      // No grants have ever been received for this subscription
      const context = {
        socketId: 'new-socket-no-grants',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'airo-build:sid:sub-never-provisioned',
          customerId: 'customer-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, {
        source: LlmCallSource.UserChat,
      })

      // Falls through to subscriptionId fallback (no grants to look up)
      expect(result).toBeDefined()
      expect(result?.user).toBe('airo-build:sid:sub-never-provisioned')
    })
  })

  describe('SubscriptionId fallback', function subscriptionFallbackTests() {
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

  describe('BMS mode (budgetServiceEnabled=true)', function bmsModeTests() {
    it('returns metadata with prefixed subscriptionId when BMS enabled', function bmsWithSubscription() {
      const context = {
        socketId: 'bms-session',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-bms-123',
          customerId: 'customer-123',
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-uuid-1',
          budgetSessionId: 'session-uuid-1',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.user).toBe('airo-build:sid:sub-bms-123')
      expect(result?.budgetId).toBe('budget-uuid-1')
      expect(result?.budgetSessionId).toBe('session-uuid-1')
      expect(result?.tags).toContain('budgetId:budget-uuid-1')
    })

    it('does not double-prefix already prefixed subscriptionId in BMS mode', function bmsNoDoublePrefix() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'airo-build:sid:already-prefixed',
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-uuid-1',
          budgetSessionId: 'session-uuid-1',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe('airo-build:sid:already-prefixed')
    })

    it('uses degraded prefix when BMS enabled but no budget session (fail-open)', function bmsDegradedPrefix() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-degraded-123',
          budgetServiceEnabled: true,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe('airo-builder:degraded:sub-degraded-123')
    })

    it('falls back to customerId when no subscriptionId in BMS mode', function bmsFallbackCustomerId() {
      const context = {
        metadata: {
          appId: 'app-1',
          customerId: 'customer-bms-fallback',
          budgetServiceEnabled: true,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.user).toBe('customer-bms-fallback')
    })

    it('returns null when BMS enabled but no subscriptionId or customerId', function bmsNoIdentifier() {
      const context = {
        metadata: {
          appId: 'app-1',
          budgetServiceEnabled: true,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBe(null)
    })

    it('skips grant lookup entirely in BMS mode even when grants available', function bmsSkipsGrants() {
      // Set up grants that would normally be used
      grantSessionManager.setGrants('bms-skip-session', [createGrant()])

      const context = {
        socketId: 'bms-skip-session',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-bms',
          customerId: 'customer-123',
          budgetServiceEnabled: true,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      // Should use subscriptionId (degraded prefix since no budgetSessionId), not grant's llmBudgetUserId
      expect(result?.user).toBe('airo-builder:degraded:sub-bms')
    })

    it('does not prefix BudgetOverride sessions in BMS mode', function bmsOverrideNotPrefixed() {
      const context = {
        socketId: 'bms-care-session',
        metadata: {
          appId: 'app-1',
          subscriptionId: BudgetOverride.CareAgent,
          customerId: 'customer-123',
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-uuid-1',
          budgetSessionId: 'session-uuid-1',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      // Should NOT prefix CareAgent - override sessions use raw value
      expect(result?.user).toBe(BudgetOverride.CareAgent)
      // Should still include budget fields for cost tracking
      expect(result?.budgetId).toBe('budget-uuid-1')
      expect(result?.budgetSessionId).toBe('session-uuid-1')
    })

    it('does not prefix TestAccounts override in BMS mode', function bmsTestAccountsNotPrefixed() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: BudgetOverride.TestAccounts,
          budgetServiceEnabled: true,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe(BudgetOverride.TestAccounts)
    })
  })

  describe('isGrantsExhausted BMS mode', function exhaustedBmsTests() {
    it('returns false when BMS enabled even with exhausted grants', function bmsExhaustedBypass() {
      const exhaustedGrant = createGrant({ creditsSpent: 1500, creditsMax: 1500 })
      grantSessionManager.setGrants('bms-exhausted-session', [exhaustedGrant])

      const context = {
        socketId: 'bms-exhausted-session',
        metadata: {
          appId: 'app-1',
          budgetServiceEnabled: true,
        },
      }

      // BMS mode: grants not used, cannot be "exhausted"
      expect(isGrantsExhausted(context)).toBe(false)
    })
  })

  describe('BMS budget session fields (GoCode header propagation)', function budgetSessionTests() {
    it('includes budgetId and budgetSessionId when metadata has budget fields', function hasBudgetFields() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-1',
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-uuid-1',
          budgetSessionId: 'session-uuid-1',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.budgetId).toBe('budget-uuid-1')
      expect(result?.budgetSessionId).toBe('session-uuid-1')
    })

    it('omits budget fields when metadata has no budget session', function noBudgetFields() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-1',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.budgetId).toBeUndefined()
      expect(result?.budgetSessionId).toBeUndefined()
      expect(result?.tags?.some((t) => t.startsWith('budgetId:'))).toBeFalsy()
    })

    it('omits budget fields for BudgetOverride sessions', function overrideNoBudget() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: BudgetOverride.CareAgent,
          // bmsBudgetId/budgetSessionId won't be set by context provider for overrides
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe(BudgetOverride.CareAgent)
      expect(result?.budgetId).toBeUndefined()
      expect(result?.budgetSessionId).toBeUndefined()
    })

    it('omits budget fields when only bmsBudgetId is set (incomplete)', function partialBudget() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-1',
          bmsBudgetId: 'budget-uuid-1',
          // budgetSessionId missing
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.budgetId).toBeUndefined()
      expect(result?.budgetSessionId).toBeUndefined()
      expect(result?.tags?.some((t) => t.startsWith('budgetId:'))).toBeFalsy()
    })

    it('omits budgetId tag when bmsBudgetId present but budgetServiceEnabled is false', function legacyGrantsNoBudgetTag() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-1',
          customerId: 'customer-123',
          bmsBudgetId: 'budget-uuid-stale',
          budgetSessionId: 'session-uuid-stale',
          budgetServiceEnabled: false,
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.budgetId).toBeUndefined()
      expect(result?.budgetSessionId).toBeUndefined()
      expect(result?.tags?.some((t) => t.startsWith('budgetId:'))).toBeFalsy()
    })

    it('includes budget fields alongside BMS user in BMS mode (grants skipped)', function budgetWithGrants() {
      grantSessionManager.setGrants('test-session', [
        createGrant({ llmBudgetUserId: 'airo-builder:grant:g1' }),
      ])

      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-1',
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-uuid-1',
          budgetSessionId: 'session-uuid-1',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      // BMS mode skips grant lookup; user is subscription-based
      expect(result?.user).toBe('airo-build:sid:sub-1')
      expect(result?.budgetId).toBe('budget-uuid-1')
      expect(result?.budgetSessionId).toBe('session-uuid-1')
      expect(result?.tags).toContain('budgetId:budget-uuid-1')
    })
  })

  describe('OTel traceId propagation', function traceIdTests() {
    it('includes traceId when metadata has traceId', function hasTraceId() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-1',
          traceId: 'abc123def456',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.traceId).toBe('abc123def456')
    })

    it('omits traceId when metadata has no traceId', function noTraceId() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-1',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result).toBeDefined()
      expect(result?.traceId).toBeUndefined()
    })

    it('includes traceId for BudgetOverride sessions', function overrideWithTraceId() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: BudgetOverride.CareAgent,
          traceId: 'trace-care-123',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe(BudgetOverride.CareAgent)
      expect(result?.traceId).toBe('trace-care-123')
    })

    it('includes traceId for TestAccounts override', function testAccountsWithTraceId() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: BudgetOverride.TestAccounts,
          traceId: 'trace-test-456',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe(BudgetOverride.TestAccounts)
      expect(result?.traceId).toBe('trace-test-456')
    })

    it('includes traceId for task-specific budget overrides', function taskOverrideWithTraceId() {
      const context = {
        metadata: {
          appId: 'app-1',
          subscriptionId: BudgetOverride.AssessAgent,
          traceId: 'trace-assess-789',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe(BudgetOverride.AssessAgent)
      expect(result?.traceId).toBe('trace-assess-789')
    })

    it('includes traceId alongside grant metadata', function traceIdWithGrants() {
      grantSessionManager.setGrants('test-session', [
        createGrant({ llmBudgetUserId: 'airo-builder:grant:g1' }),
      ])

      const context = {
        socketId: 'test-session',
        metadata: {
          appId: 'app-1',
          subscriptionId: 'sub-1',
          traceId: 'trace-grant-456',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe('airo-builder:grant:g1')
      expect(result?.traceId).toBe('trace-grant-456')
    })

    it('includes traceId for customerId fallback path', function traceIdWithCustomerId() {
      const context = {
        metadata: {
          appId: 'app-1',
          customerId: 'customer-1',
          traceId: 'trace-cust-789',
        },
      }

      const result = buildLitellmMetadataFromContext(context, { source: LlmCallSource.UserChat })

      expect(result?.user).toBe('customer-1')
      expect(result?.traceId).toBe('trace-cust-789')
    })
  })
})
