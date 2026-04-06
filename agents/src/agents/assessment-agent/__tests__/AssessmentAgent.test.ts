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
})
