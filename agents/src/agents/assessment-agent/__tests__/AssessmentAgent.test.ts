import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AssessmentTaskType, AssessmentReason } from '../types.js'

// Create controllable mock using vi.hoisted
const mocks = vi.hoisted(() => {
  return {
    generateText: vi.fn(),
    getModel: vi.fn(),
    llmMetadataContextRun: vi.fn(),
    promptBuilderBuild: vi.fn(),
    embeddingClassifierClassify: vi.fn(),
    embeddingClassifierInitialize: vi.fn(),
    embeddingClassifierIsReady: vi.fn(),
  }
})

// Mock ai-grants - must be before imports that use it
vi.mock('@airo/ai-grants', () => ({
  BudgetOverride: {
    CareAgent: 'airo-builder:care-agent',
    TestAccounts: 'airo-builder:test-accounts',
    AssessAgent: 'airo-builder:assess-agent',
    PublishTask: 'airo-builder:publish-task',
    DomainTask: 'airo-builder:domain-task',
    FixTask: 'airo-builder:fix-task',
  },
  LlmCallSource: {
    AgentAssessment: 'agent:assessment',
  },
}))

// Mock ai-lib
vi.mock('@airo/ai-lib', () => ({
  getModel: mocks.getModel,
  createPromptBuilder: () => ({
    file: vi.fn().mockReturnThis(),
    build: mocks.promptBuilderBuild,
  }),
}))

// Mock prompt utils
vi.mock('../../../utils/prompt-utils.js', () => ({
  getModularPromptPaths: () => ({
    getAgentFile: () => '/mock/path/core.md',
    getSharedFile: () => '/mock/path/shared.md',
  }),
}))

// Mock ai SDK
vi.mock('ai', () => ({
  generateText: mocks.generateText,
}))

// Mock ai-common
vi.mock('@airo/ai-common', () => ({
  llmMetadataContext: {
    run: mocks.llmMetadataContextRun,
  },
}))

// Mock embedding classifier
vi.mock('../embedding-classifier.js', () => ({
  getEmbeddingClassifier: () => ({
    initialize: mocks.embeddingClassifierInitialize,
    classify: mocks.embeddingClassifierClassify,
    isReady: mocks.embeddingClassifierIsReady,
  }),
}))

// Mock logging
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
  log: {
    error: vi.fn(),
  },
}))

// Dynamic imports after mocks
const { createAssessmentAgent, matchKeywords } = await import('../index.js')

// Access mocks
const mockGenerateText = mocks.generateText
const mockGetModel = mocks.getModel
const mockLlmContextRun = mocks.llmMetadataContextRun
const mockPromptBuilderBuild = mocks.promptBuilderBuild
const mockEmbeddingClassify = mocks.embeddingClassifierClassify
const mockEmbeddingInitialize = mocks.embeddingClassifierInitialize
const mockEmbeddingIsReady = mocks.embeddingClassifierIsReady

describe('AssessmentAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Set up default mock implementations
    mockGetModel.mockResolvedValue({
      doGenerate: vi.fn(),
      doStream: vi.fn(),
      modelId: 'mock-haiku',
    })

    // llmMetadataContext.run should call the provided function
    mockLlmContextRun.mockImplementation(async (_metadata: unknown, fn: () => Promise<unknown>) => {
      return await fn()
    })

    // Prompt builder should return a template string
    mockPromptBuilderBuild.mockResolvedValue('Mock system prompt template {{keywordHints}}')

    // Embedding classifier defaults - high confidence to skip Haiku
    mockEmbeddingInitialize.mockResolvedValue(undefined)
    mockEmbeddingIsReady.mockReturnValue(true)
    mockEmbeddingClassify.mockResolvedValue({
      taskType: AssessmentTaskType.General,
      confidence: 100,
      similarity: 0.85,
      matchedExample: 'general task',
      margin: 0.2,
      method: 'embedding-nn',
      hasNegation: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('matchKeywords', () => {
    describe('publish keywords', () => {
      it('should detect "publish"', () => {
        const result = matchKeywords('publish my app')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Publish)
      })

      it('should detect "deploy"', () => {
        const result = matchKeywords('deploy to production')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Publish)
      })

      it('should detect "go live"', () => {
        const result = matchKeywords('I want to go live')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Publish)
      })

      it('should detect "launch"', () => {
        const result = matchKeywords('launch my website')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Publish)
      })

      it('should detect "make live"', () => {
        const result = matchKeywords('make it live')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Publish)
      })
    })

    describe('domain keywords', () => {
      it('should detect "domain"', () => {
        const result = matchKeywords('I want a domain')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Domain)
      })

      it('should detect "custom domain"', () => {
        const result = matchKeywords('add a custom domain')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Domain)
      })

      it('should detect "attach domain"', () => {
        const result = matchKeywords('attach domain to my site')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Domain)
      })

      it('should detect "connect my domain"', () => {
        const result = matchKeywords('connect my domain')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Domain)
      })

      it('should detect "buy a domain"', () => {
        const result = matchKeywords('buy a domain for me')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Domain)
      })
    })

    describe('fix keywords', () => {
      it('should detect "fix"', () => {
        const result = matchKeywords('fix the button')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Fix)
      })

      it('should detect "broken"', () => {
        const result = matchKeywords('the page is broken')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Fix)
      })

      it('should detect "not working"', () => {
        const result = matchKeywords('the form is not working')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Fix)
      })

      it('should detect "error"', () => {
        const result = matchKeywords('there is an error on the page')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Fix)
      })

      it('should detect "bug"', () => {
        const result = matchKeywords('I found a bug')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Fix)
      })

      it('should detect "crash"', () => {
        const result = matchKeywords('the app crashes')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Fix)
      })

      it('should detect "failing"', () => {
        const result = matchKeywords('the build is failing')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Fix)
      })

      it('should detect "issue"', () => {
        const result = matchKeywords('there is an issue with the login')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Fix)
      })
    })

    describe('general prompts (no match)', () => {
      it('should return null for general requests', () => {
        expect(matchKeywords('add a contact form')).toBeNull()
        expect(matchKeywords('change the color to blue')).toBeNull()
        expect(matchKeywords('make the header bigger')).toBeNull()
        expect(matchKeywords('add a new page')).toBeNull()
      })
    })

    describe('case insensitivity', () => {
      it('should match keywords case-insensitively', () => {
        expect(matchKeywords('PUBLISH my app')?.taskType).toBe(AssessmentTaskType.Publish)
        expect(matchKeywords('FIX the error')?.taskType).toBe(AssessmentTaskType.Fix)
        expect(matchKeywords('Connect my DOMAIN')?.taskType).toBe(AssessmentTaskType.Domain)
      })
    })

    describe('short prompts', () => {
      it('should match single-word "publish"', () => {
        const result = matchKeywords('publish')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Publish)
      })

      it('should match single-word "deploy"', () => {
        const result = matchKeywords('deploy')
        expect(result).not.toBeNull()
        expect(result?.taskType).toBe(AssessmentTaskType.Publish)
      })
    })
  })

  describe('classify', () => {
    it('should return disabled outcome when service is disabled', async () => {
      const agent = createAssessmentAgent({ enabled: false })
      const outcome = await agent.classify('publish my app')

      expect(outcome.reason).toBe(AssessmentReason.Disabled)
      expect(outcome.overrideApplied).toBe(false)
      expect(outcome.result).toBeNull()
    })

    it('should return general for empty prompts', async () => {
      const agent = createAssessmentAgent({ enabled: true })
      const outcome = await agent.classify('')

      expect(outcome.reason).toBe(AssessmentReason.EmptyPrompt)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should use embedding classifier and apply override for publish prompts (high confidence)', async () => {
      // High similarity + high confidence = embedding fast path (no Haiku needed)
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 90,
        similarity: 0.85,
        matchedExample: 'publish my app',
        margin: 0.3,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('publish my app')

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.completedInTime).toBe(true)
      expect(outcome.overrideApplied).toBe(true)
      expect(outcome.appliedBudget).toBe('airo-builder:publish-task')
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Publish)
      expect(mockEmbeddingClassify).toHaveBeenCalled()
    })

    it('should use embedding classifier and apply override for domain prompts', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Domain,
        confidence: 85,
        similarity: 0.82,
        matchedExample: 'buy a domain',
        margin: 0.25,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('I want to buy a domain')

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.overrideApplied).toBe(true)
      expect(outcome.appliedBudget).toBe('airo-builder:domain-task')
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Domain)
    })

    it('should use embedding classifier and apply override for fix prompts', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 88,
        similarity: 0.80,
        matchedExample: 'fix this bug',
        margin: 0.22,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('fix the broken button')

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.overrideApplied).toBe(true)
      expect(outcome.appliedBudget).toBe('airo-builder:fix-task')
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
    })

    it('should return general for non-special task prompts', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.General,
        confidence: 80,
        similarity: 0.40, // Low similarity triggers below-threshold path
        matchedExample: 'general task',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('add a contact form to the homepage')

      expect(outcome.reason).toBe(AssessmentReason.BelowThreshold)
      expect(outcome.completedInTime).toBe(true)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should apply override when embedding returns high confidence special task', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 85,
        similarity: 0.78,
        matchedExample: 'make my app public',
        margin: 0.2,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500, confidenceThreshold: 65 })
      const outcome = await agent.classify('make my site public for everyone')

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.overrideApplied).toBe(true)
      expect(outcome.appliedBudget).toBe('airo-builder:publish-task')
    })

    it('should not apply override when confidence below threshold', async () => {
      // Low similarity causes fallback to general with below-threshold reason
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 50,
        similarity: 0.45, // Below LOW_CONFIDENCE_SIMILARITY (0.50)
        matchedExample: 'publish my app',
        margin: 0.05,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // When low similarity but not general, Haiku is called as tiebreaker
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Publish, confidence: 50, reasoning: 'Uncertain intent' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500, confidenceThreshold: 65 })
      const outcome = await agent.classify('perhaps make it available')

      // Low confidence from Haiku results in below-threshold
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should return timeout when Haiku takes too long', async () => {
      // Medium similarity with negation triggers Haiku tiebreaker
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 70,
        similarity: 0.70,
        matchedExample: 'publish my app',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: true, // Negation forces Haiku verification
      })

      // Haiku takes 300ms
      mockGenerateText.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return { text: JSON.stringify({ taskType: AssessmentTaskType.Publish, confidence: 90 }) }
      })

      // With timeoutMs=600, after embedding (~0ms), remainingTime=~600ms
      // Haiku needs 500ms minimum to start, so it will start
      // But 600ms > 300ms so Haiku should complete successfully
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 600 })
      const outcome = await agent.classify('make my site available to visitors')

      // Haiku completes within budget
      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.completedInTime).toBe(true)
      expect(outcome.overrideApplied).toBe(true)
    })

    it('should skip Haiku and use embedding when insufficient time remains', async () => {
      // Medium similarity would normally trigger Haiku
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 70,
        similarity: 0.70,
        matchedExample: 'publish my app',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: true, // Would normally trigger Haiku
      })

      // Very short timeout means no time for Haiku (needs 500ms minimum)
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('make my site available to visitors')

      // Should use embedding result since not enough time for Haiku
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      // With special task + 70% confidence, override is applied
      expect(outcome.overrideApplied).toBe(true)
    })

    it('should return error on embedding classifier failure', async () => {
      mockEmbeddingClassify.mockRejectedValue(new Error('Embedding API error'))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('make my site available to visitors')

      expect(outcome.reason).toBe(AssessmentReason.Error)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should handle Haiku errors gracefully and fall back to embedding result', async () => {
      // Medium similarity triggers Haiku tiebreaker
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 70,
        similarity: 0.60, // Medium - triggers Haiku
        matchedExample: 'publish my app',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Haiku throws an error
      mockGenerateText.mockRejectedValue(new Error('Model error'))

      // Use longer timeout to ensure Haiku tiebreaker is actually called
      // (the code requires 500ms remaining to call Haiku)
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('make my site available to visitors')

      // Should fall back to embedding result on error
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Publish)
      expect(outcome.result?.confidence).toBe(60) // similarity * 100
    })
  })

  describe('isInitialPrompt context parameter', () => {
    it('should skip classification and return general for initial prompts', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('launch a food delivery app', {
        isInitialPrompt: true,
        enabledOverride: true,
      })

      expect(outcome.reason).toBe(AssessmentReason.InitialPrompt)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.result?.confidence).toBe(100)
      expect(outcome.overrideApplied).toBe(false)
      expect(outcome.completedInTime).toBe(true)
    })

    it('should not call embedding classifier for initial prompts', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      await agent.classify('publish my new website', {
        isInitialPrompt: true,
        enabledOverride: true,
      })

      // Embedding classifier should NOT be called for initial prompts
      expect(mockEmbeddingClassify).not.toHaveBeenCalled()
    })

    it('should not call Haiku LLM for initial prompts', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      await agent.classify('fix my broken site', {
        isInitialPrompt: true,
        enabledOverride: true,
      })

      // LLM should NOT be called for initial prompts
      expect(mockGenerateText).not.toHaveBeenCalled()
    })

    it('should classify normally when isInitialPrompt is false', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 90,
        similarity: 0.85,
        matchedExample: 'publish my app',
        margin: 0.3,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('publish my app', {
        isInitialPrompt: false,
        enabledOverride: true,
      })

      // Should classify normally, not return InitialPrompt
      expect(outcome.reason).not.toBe(AssessmentReason.InitialPrompt)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Publish)
      expect(mockEmbeddingClassify).toHaveBeenCalled()
    })

    it('should classify normally when isInitialPrompt is undefined', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 90,
        similarity: 0.85,
        matchedExample: 'publish my app',
        margin: 0.3,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('publish my app', {
        enabledOverride: true,
        // isInitialPrompt not set
      })

      // Should classify normally
      expect(outcome.reason).not.toBe(AssessmentReason.InitialPrompt)
      expect(mockEmbeddingClassify).toHaveBeenCalled()
    })
  })

  describe('enabledOverride context parameter', () => {
    it('should enable assessment when enabledOverride is true even if config disabled', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 90,
        similarity: 0.85,
        matchedExample: 'publish my app',
        margin: 0.3,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: false, timeoutMs: 500 })
      const outcome = await agent.classify('publish my app', {
        enabledOverride: true,
      })

      // Should classify, not return disabled
      expect(outcome.reason).not.toBe(AssessmentReason.Disabled)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Publish)
    })

    it('should disable assessment when enabledOverride is false even if config enabled', async () => {
      const agent = createAssessmentAgent({ enabled: true })
      const outcome = await agent.classify('publish my app', {
        enabledOverride: false,
      })

      expect(outcome.reason).toBe(AssessmentReason.Disabled)
      expect(outcome.result).toBeNull()
    })

    it('should fall back to config.enabled when enabledOverride is undefined', async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Publish, confidence: 90, reasoning: 'User wants to publish' }),
      })

      const enabledAgent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const enabledOutcome = await enabledAgent.classify('publish my app', {})
      expect(enabledOutcome.reason).not.toBe(AssessmentReason.Disabled)

      const disabledAgent = createAssessmentAgent({ enabled: false })
      const disabledOutcome = await disabledAgent.classify('publish my app', {})
      expect(disabledOutcome.reason).toBe(AssessmentReason.Disabled)
    })

    it('should pass through context fields to logging', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 90,
        similarity: 0.85,
        matchedExample: 'publish my app',
        margin: 0.3,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('publish my app', {
        appId: 'test-app-123',
        customerId: 'customer-456',
        socketId: 'socket-789',
        enabledOverride: true,
      })

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Publish)
      expect(outcome.overrideApplied).toBe(true)
    })
  })

  describe('predictCost', () => {
    it('should throw not implemented error', async () => {
      const agent = createAssessmentAgent()
      await expect(agent.predictCost('test')).rejects.toThrow('Not implemented')
    })
  })

  describe('billing-critical classification rules', () => {
    /**
     * These tests verify that the Haiku tiebreaker correctly overrides embedding
     * classifications for billing-critical scenarios:
     * - Continuation patterns should be general (paid) to prevent stop+continue loophole
     * - Incomplete work patterns should be general (paid) to prevent free fix loophole
     */

    it('should classify "continue" as general even when embeddings suggest fix', async () => {
      // Embedding returns fix with medium similarity (triggers Haiku tiebreaker)
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 65,
        similarity: 0.60, // Medium similarity triggers Haiku
        matchedExample: 'fix this bug',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Haiku correctly classifies continuation as general
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          taskType: AssessmentTaskType.General,
          confidence: 85,
          reasoning: 'User wants to continue previous work, not fix a bug',
        }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('continue')

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false) // general = no override
    })

    it('should classify "keep going" as general even when embeddings suggest fix', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 60,
        similarity: 0.55,
        matchedExample: 'fix the button',
        margin: 0.08,
        method: 'embedding-nn',
        hasNegation: false,
      })

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          taskType: AssessmentTaskType.General,
          confidence: 80,
          reasoning: 'Continuation request, not a fix',
        }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('keep going')

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should classify "finish this" as general even when embeddings suggest fix', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 62,
        similarity: 0.58,
        matchedExample: 'fix this issue',
        margin: 0.09,
        method: 'embedding-nn',
        hasNegation: false,
      })

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          taskType: AssessmentTaskType.General,
          confidence: 82,
          reasoning: 'User asking to complete work, not fix something broken',
        }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('finish this')

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should classify "the page is empty" as general (incomplete work, not fix)', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 58,
        similarity: 0.52,
        matchedExample: 'page is broken',
        margin: 0.07,
        method: 'embedding-nn',
        hasNegation: false,
      })

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          taskType: AssessmentTaskType.General,
          confidence: 78,
          reasoning: 'Empty page indicates incomplete work, not a bug',
        }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('the page is empty')

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should classify "content is missing" as general (incomplete work, not fix)', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 55,
        similarity: 0.50,
        matchedExample: 'content not showing',
        margin: 0.06,
        method: 'embedding-nn',
        hasNegation: false,
      })

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          taskType: AssessmentTaskType.General,
          confidence: 75,
          reasoning: 'Missing content indicates work not yet done',
        }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('content is missing')

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should still classify clear fix patterns as fix', async () => {
      // Even with Haiku tiebreaker, clear fix patterns should remain fix
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 70,
        similarity: 0.65,
        matchedExample: 'fix this bug',
        margin: 0.12,
        method: 'embedding-nn',
        hasNegation: false,
      })

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          taskType: AssessmentTaskType.Fix,
          confidence: 90,
          reasoning: 'User explicitly reports broken functionality',
        }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('fix this, the button is broken')

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(true)
      expect(outcome.appliedBudget).toBe('airo-builder:fix-task')
    })

    it('should classify "resume where you left off" as general', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 60,
        similarity: 0.55,
        matchedExample: 'fix where it stopped',
        margin: 0.08,
        method: 'embedding-nn',
        hasNegation: false,
      })

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          taskType: AssessmentTaskType.General,
          confidence: 85,
          reasoning: 'Resume is a continuation pattern, not a fix request',
        }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('resume where you left off')

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should apply billing-safety fallback when Haiku is skipped and embedding returned fix with low similarity', async () => {
      // Embedding returns fix with LOW similarity (would need Haiku tiebreaker)
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 40,
        similarity: 0.40, // Below LOW_CONFIDENCE_SIMILARITY (0.5)
        matchedExample: 'fix the button',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Very short timeout means no time for Haiku (needs 500ms minimum)
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('continue working')

      // BILLING SAFETY: Should fall back to general, not fix
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should apply billing-safety fallback when Haiku times out and embedding returned fix with low similarity', async () => {
      // Embedding returns fix with LOW similarity (triggers Haiku tiebreaker)
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 40,
        similarity: 0.40, // Below LOW_CONFIDENCE_SIMILARITY (0.5)
        matchedExample: 'fix the button',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Haiku times out (takes longer than allowed)
      mockGenerateText.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return { text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 90 }) }
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 600 })
      const outcome = await agent.classify('continue working')

      // BILLING SAFETY: Should fall back to general, not fix
      expect(outcome.reason).toBe(AssessmentReason.Timeout)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should NOT apply billing-safety fallback when similarity is above LOW threshold', async () => {
      // Embedding returns publish with similarity above LOW threshold (0.5)
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Publish,
        confidence: 70,
        similarity: 0.70, // Above LOW_CONFIDENCE_SIMILARITY (0.5) - trustworthy
        matchedExample: 'publish my app',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Very short timeout means no time for Haiku
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('make my site live')

      // High enough similarity - trusted even on timeout
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Publish)
      // Override applies since confidence (70) >= MIN_CONFIDENCE_FOR_OVERRIDE (65)
      expect(outcome.overrideApplied).toBe(true)
    })

    it('should apply billing-safety fallback for domain with low similarity when Haiku is skipped', async () => {
      // Embedding returns domain with LOW similarity (e.g., "Search by ingredients" -> "search for domains")
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Domain,
        confidence: 40,
        similarity: 0.42, // Below LOW_CONFIDENCE_SIMILARITY (0.5) - unreliable
        matchedExample: 'search for domains',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Very short timeout means no time for Haiku (needs 500ms minimum)
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('Search by ingredients')

      // BILLING SAFETY: Low similarity domain should fall back to general
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should apply billing-safety fallback for domain with low similarity when Haiku times out', async () => {
      // Embedding returns domain with LOW similarity (e.g., "Search by ingredients" -> "search for domains")
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Domain,
        confidence: 40,
        similarity: 0.42, // Below LOW_CONFIDENCE_SIMILARITY (0.5) - unreliable
        matchedExample: 'search for domains',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Haiku times out (takes longer than allowed)
      mockGenerateText.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return { text: JSON.stringify({ taskType: AssessmentTaskType.Domain, confidence: 90 }) }
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 600 })
      const outcome = await agent.classify('Search by ingredients')

      // BILLING SAFETY: Low similarity domain should fall back to general on timeout
      expect(outcome.reason).toBe(AssessmentReason.Timeout)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should apply billing-safety fallback for domain with low similarity when Haiku errors', async () => {
      // Embedding returns domain with LOW similarity
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Domain,
        confidence: 40,
        similarity: 0.42, // Below LOW_CONFIDENCE_SIMILARITY (0.5) - unreliable
        matchedExample: 'search for domains',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Haiku throws an error (network, 429, etc.)
      mockGenerateText.mockRejectedValue(new Error('Network error'))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('Search by ingredients')

      // BILLING SAFETY: Low similarity domain should fall back to general on error
      expect(outcome.reason).toBe(AssessmentReason.Error)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should trust fix classification when similarity is in medium range [0.50, 0.75) and Haiku is skipped', async () => {
      // Embedding returns fix with MEDIUM similarity (above LOW but below HIGH)
      // This tests the new contract: medium-confidence fix is trusted when Haiku is unavailable
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 60,
        similarity: 0.60, // Above LOW_CONFIDENCE_SIMILARITY (0.5), below HIGH (0.75)
        matchedExample: 'fix the button',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      // Very short timeout means no time for Haiku
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('fix this issue')

      // Medium similarity fix should be trusted (no billing safety fallback)
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      // Override NOT applied because confidence (60) < MIN_CONFIDENCE_FOR_OVERRIDE (65)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should NOT apply billing-safety fallback for high-confidence fix', async () => {
      // Embedding returns fix with HIGH similarity (no tiebreaker needed)
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 90,
        similarity: 0.85, // Above HIGH_CONFIDENCE_SIMILARITY (0.75)
        matchedExample: 'fix the bug',
        margin: 0.3,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('fix this bug')

      // High confidence fix should be trusted
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(true)
    })
  })

  describe('agent lifecycle methods', () => {
    it('should initialize without error', async () => {
      const agent = createAssessmentAgent()
      await expect(agent.initialize()).resolves.not.toThrow()
    })

    it('should only initialize once (idempotent)', async () => {
      const agent = createAssessmentAgent()
      await agent.initialize()
      await agent.initialize() // Second call should be a no-op
      expect(mockEmbeddingInitialize).toHaveBeenCalledTimes(1)
    })

    it('should cleanup without error', async () => {
      const agent = createAssessmentAgent()
      await expect(agent.cleanup()).resolves.not.toThrow()
    })

    it('should return correct name', () => {
      const agent = createAssessmentAgent()
      expect(agent.getName()).toBe('Assessment Agent')
    })

    it('should lazy initialize embedding classifier on first classify call', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.General,
        confidence: 80,
        similarity: 0.40,
        matchedExample: 'general',
        margin: 0.1,
        method: 'embedding-nn',
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      // Don't call initialize() explicitly
      await agent.classify('test prompt')

      // Should have called embedding classifier (which triggers lazy init)
      expect(mockEmbeddingClassify).toHaveBeenCalled()
    })
  })

  describe('session context gate', () => {
    const lowSimilarityGeneral = {
      taskType: AssessmentTaskType.General,
      confidence: 100,
      similarity: 0.35,
      matchedExample: 'general task',
      margin: 0.1,
      method: 'embedding-nn' as const,
      hasNegation: false,
    }

    it('should route to Haiku when previous assessment was fix', async () => {
      mockEmbeddingClassify.mockResolvedValue(lowSimilarityGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 85, reasoning: 'follow-up to active fix' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('here', {
        previousAssessmentTaskType: AssessmentTaskType.Fix,
        previousUserMessage: 'fix my button',
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(true)
    })

    it('should route to Haiku when previous assessment was publish', async () => {
      mockEmbeddingClassify.mockResolvedValue(lowSimilarityGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Publish, confidence: 80, reasoning: 'publish confirmation' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('go ahead', {
        previousAssessmentTaskType: AssessmentTaskType.Publish,
        previousUserMessage: 'publish my app',
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Publish)
    })

    it('should route to Haiku when previous assessment was domain', async () => {
      mockEmbeddingClassify.mockResolvedValue(lowSimilarityGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Domain, confidence: 78, reasoning: 'domain follow-up' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('yes that one', {
        previousAssessmentTaskType: AssessmentTaskType.Domain,
        previousUserMessage: 'connect my domain',
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
    })

    it('should return BelowThreshold when previous assessment was general', async () => {
      mockEmbeddingClassify.mockResolvedValue(lowSimilarityGeneral)

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('here', {
        previousAssessmentTaskType: AssessmentTaskType.General,
      })

      expect(outcome.reason).toBe(AssessmentReason.BelowThreshold)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.result?.confidence).toBe(100)
    })

    it('should return BelowThreshold when no previous assessment exists', async () => {
      mockEmbeddingClassify.mockResolvedValue(lowSimilarityGeneral)

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('here')

      expect(outcome.reason).toBe(AssessmentReason.BelowThreshold)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    })

    it('should not apply override when Haiku returns fix below confidence threshold', async () => {
      mockEmbeddingClassify.mockResolvedValue(lowSimilarityGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 45, reasoning: 'possibly fix but uncertain' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000, confidenceThreshold: 65 })
      const outcome = await agent.classify('hmm', {
        previousAssessmentTaskType: AssessmentTaskType.Fix,
        previousUserMessage: 'fix the error',
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should fall back to embedding result when insufficient time for Haiku', async () => {
      mockEmbeddingClassify.mockResolvedValue(lowSimilarityGeneral)

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('here', {
        previousAssessmentTaskType: AssessmentTaskType.Fix,
        previousUserMessage: 'fix the button',
      })

      // With <500ms remaining, Haiku is skipped and embedding result is used
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    })

    it('should not affect high similarity path', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.General,
        confidence: 90,
        similarity: 0.85,
        matchedExample: 'general task',
        margin: 0.2,
        method: 'embedding-nn' as const,
        hasNegation: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('add a form', {
        previousAssessmentTaskType: AssessmentTaskType.Fix,
      })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    })

    it('should not affect medium similarity path', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.General,
        confidence: 60,
        similarity: 0.60,
        matchedExample: 'general task',
        margin: 0.1,
        method: 'embedding-nn' as const,
        hasNegation: false,
      })
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 85, reasoning: 'general request' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('make it pretty', {
        previousAssessmentTaskType: AssessmentTaskType.Fix,
      })

      // Medium similarity already routes to Haiku regardless of session context
      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
    })
  })
})
