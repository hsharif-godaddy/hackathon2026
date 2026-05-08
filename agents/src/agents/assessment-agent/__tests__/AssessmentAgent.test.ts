import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AssessmentTaskType, AssessmentReason, ClassifierMode } from '../types.js'

const mocks = vi.hoisted(() => {
  return {
    generateText: vi.fn(),
    getModel: vi.fn(),
    llmMetadataContextRun: vi.fn(),
    embeddingClassifierClassify: vi.fn(),
    embeddingClassifierInitialize: vi.fn(),
    embeddingClassifierIsReady: vi.fn(),
    lrClassifierClassify: vi.fn(),
    lrClassifierInitialize: vi.fn(),
  }
})

vi.mock('@airo/ai-grants', () => ({
  BudgetOverride: {
    CareAgent: 'airo-builder:care-agent',
    TestAccounts: 'airo-builder:test-accounts',
    AssessAgent: 'airo-builder:assess-agent',
    PublishTask: 'airo-builder:publish-task',
    DomainTask: 'airo-builder:domain-task',
    FixTask: 'airo-builder:fix-task',
  },
  LlmCallSource: { AgentAssessment: 'agent:assessment' },
}))

vi.mock('@airo/ai-lib', () => ({
  getModel: mocks.getModel,
  createPromptBuilder: () => ({
    file: vi.fn().mockReturnThis(),
    build: vi.fn(),
  }),
}))

vi.mock('ai', () => ({ generateText: mocks.generateText }))

vi.mock('@airo/ai-common', () => ({
  llmMetadataContext: { run: mocks.llmMetadataContextRun },
}))

vi.mock('../embedding-classifier.js', () => ({
  getEmbeddingClassifier: () => ({
    initialize: mocks.embeddingClassifierInitialize,
    classify: mocks.embeddingClassifierClassify,
    isReady: mocks.embeddingClassifierIsReady,
  }),
}))

vi.mock('../lr-classifier.js', () => ({
  getLRClassifier: () => ({
    initialize: mocks.lrClassifierInitialize,
    classify: mocks.lrClassifierClassify,
  }),
}))

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
  log: { error: vi.fn() },
}))

const { createAssessmentAgent, matchKeywords } = await import('../index.js')

const mockGenerateText = mocks.generateText
const mockEmbeddingClassify = mocks.embeddingClassifierClassify
const mockEmbeddingInitialize = mocks.embeddingClassifierInitialize
const mockLRClassify = mocks.lrClassifierClassify
const mockLRInitialize = mocks.lrClassifierInitialize

describe('AssessmentAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getModel.mockResolvedValue({
      doGenerate: vi.fn(),
      doStream: vi.fn(),
      modelId: 'mock-haiku',
    })

    mocks.llmMetadataContextRun.mockImplementation(
      async (_metadata: unknown, fn: () => Promise<unknown>) => fn()
    )

    mockEmbeddingInitialize.mockResolvedValue(undefined)
    mockEmbeddingClassify.mockResolvedValue({
      taskType: AssessmentTaskType.General,
      confidence: 100,
      similarity: 0.85,
      matchedExample: 'general task',
      margin: 0.2,
      method: 'embedding-nn',
      hasNegation: false,
      requiresHaikuVerification: false,
    })

    mocks.embeddingClassifierIsReady.mockReturnValue(true)
    mockLRInitialize.mockResolvedValue(undefined)
    mockLRClassify.mockResolvedValue({
      taskType: AssessmentTaskType.General,
      confidence: 100,
      similarity: 0.05,
      matchedExample: '',
      margin: 0.9,
      method: 'embedding-lr',
      hasNegation: false,
      requiresHaikuVerification: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('matchKeywords', () => {
    describe.skip('publish keywords (pending full 2-class type refactor)', () => {
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

    describe.skip('domain keywords (pending full 2-class type refactor)', () => {
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
        expect(matchKeywords('FIX the error')?.taskType).toBe(AssessmentTaskType.Fix)
      })
    })

    describe.skip('short prompts - publish/deploy (pending full 2-class type refactor)', () => {
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

  describe('classify — orchestrator guards', () => {
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

    it('should not call any classifier for initial prompts', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      await agent.classify('fix my broken site', { isInitialPrompt: true, enabledOverride: true })

      expect(mockEmbeddingClassify).not.toHaveBeenCalled()
      expect(mockLRClassify).not.toHaveBeenCalled()
    })

    it('should not call Haiku LLM for initial prompts', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      await agent.classify('fix my broken site', { isInitialPrompt: true, enabledOverride: true })

      expect(mockGenerateText).not.toHaveBeenCalled()
    })

    it('should classify normally when isInitialPrompt is false', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 90,
        similarity: 0.9,
        matchedExample: '',
        margin: 0.8,
        method: 'embedding-nn',
        hasNegation: false,
        requiresHaikuVerification: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('fix my app', {
        isInitialPrompt: false,
        enabledOverride: true,
      })

      expect(outcome.reason).not.toBe(AssessmentReason.InitialPrompt)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
    })

    it('should enable assessment when enabledOverride is true even if config disabled', async () => {
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 90,
        similarity: 0.9,
        matchedExample: '',
        margin: 0.8,
        method: 'embedding-nn',
        hasNegation: false,
        requiresHaikuVerification: false,
      })

      const agent = createAssessmentAgent({ enabled: false, timeoutMs: 500 })
      const outcome = await agent.classify('fix my broken button', { enabledOverride: true })

      expect(outcome.reason).not.toBe(AssessmentReason.Disabled)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
    })

    it('should disable assessment when enabledOverride is false even if config enabled', async () => {
      const agent = createAssessmentAgent({ enabled: true })
      const outcome = await agent.classify('publish my app', { enabledOverride: false })

      expect(outcome.reason).toBe(AssessmentReason.Disabled)
      expect(outcome.result).toBeNull()
    })

    it('should fall back to config.enabled when enabledOverride is undefined', async () => {
      const enabledAgent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const enabledOutcome = await enabledAgent.classify('publish my app', {})
      expect(enabledOutcome.reason).not.toBe(AssessmentReason.Disabled)

      const disabledAgent = createAssessmentAgent({ enabled: false })
      const disabledOutcome = await disabledAgent.classify('publish my app', {})
      expect(disabledOutcome.reason).toBe(AssessmentReason.Disabled)
    })
  })

  describe('classify — default classifier mode (cosine-similarity)', () => {
    it('should call embedding classifier by default', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      await agent.classify('add a contact form')

      expect(mockEmbeddingClassify).toHaveBeenCalled()
      expect(mockLRClassify).not.toHaveBeenCalled()
    })

    it('should call LR classifier when classifierMode is LogisticRegression', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      await agent.classify('add a contact form', { classifierMode: ClassifierMode.LogisticRegression })

      expect(mockLRClassify).toHaveBeenCalled()
      expect(mockEmbeddingClassify).not.toHaveBeenCalled()
    })
  })

  describe('runABClassification', () => {
    it('should run both arms in parallel and return comparison result', async () => {
      mockLRClassify.mockResolvedValue({
        taskType: AssessmentTaskType.Fix,
        confidence: 90,
        similarity: 0.9,
        matchedExample: '',
        margin: 0.8,
        method: 'embedding-lr',
        hasNegation: false,
        requiresHaikuVerification: false,
      })
      mockEmbeddingClassify.mockResolvedValue({
        taskType: AssessmentTaskType.General,
        confidence: 85,
        similarity: 0.3,
        matchedExample: 'general',
        margin: 0.15,
        method: 'embedding-nn',
        hasNegation: false,
        requiresHaikuVerification: false,
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const result = await agent.runABClassification(
        'fix this bug',
        ClassifierMode.LogisticRegression,
        ClassifierMode.CosineSimilarity
      )

      expect(result.modelA).toBe(ClassifierMode.LogisticRegression)
      expect(result.modelB).toBe(ClassifierMode.CosineSimilarity)
      expect(result.outcomeA.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(result.outcomeB.result?.taskType).toBe(AssessmentTaskType.General)
      expect(result.taskTypeAgree).toBe(false)
      expect(result.overrideAgree).toBe(false) // A applied override (fix), B did not
    })

    it('should report agreement when both arms agree', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const result = await agent.runABClassification(
        'add a form',
        ClassifierMode.LogisticRegression,
        ClassifierMode.CosineSimilarity
      )

      // Both mocks return General/100 by default
      expect(result.taskTypeAgree).toBe(true)
      expect(result.overrideAgree).toBe(true)
    })

    it('should call both LR and embedding classifiers', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      await agent.runABClassification('test prompt', ClassifierMode.LogisticRegression, ClassifierMode.CosineSimilarity)

      expect(mockLRClassify).toHaveBeenCalled()
      expect(mockEmbeddingClassify).toHaveBeenCalled()
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

    it('should pre-warm both classifiers on initialize()', async () => {
      const agent = createAssessmentAgent()
      await agent.initialize()

      expect(mockEmbeddingInitialize).toHaveBeenCalledTimes(1)
      expect(mockLRInitialize).toHaveBeenCalledTimes(1)
    })

    it('should only initialize once (idempotent)', async () => {
      const agent = createAssessmentAgent()
      await agent.initialize()
      await agent.initialize()

      expect(mockEmbeddingInitialize).toHaveBeenCalledTimes(1)
      expect(mockLRInitialize).toHaveBeenCalledTimes(1)
    })

    it('should cleanup without error', async () => {
      const agent = createAssessmentAgent()
      await expect(agent.cleanup()).resolves.not.toThrow()
    })

    it('should return correct name', () => {
      const agent = createAssessmentAgent()
      expect(agent.getName()).toBe('Assessment Agent')
    })
  })
})
