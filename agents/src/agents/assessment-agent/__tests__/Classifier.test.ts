/**
 * Tests for `AssessmentClassifier` (assessment-classifier.ts): embedding/LR → optional Haiku tiebreaker → outcome.
 *
 * The pipeline is exercised through `AssessmentAgent` with an explicit `classifierMode`.
 * Behavior (fast path, Haiku escalation, billing safety, session context gate) is the same regardless
 * of which underlying classifier is selected; tests pin `ClassifierMode.LogisticRegression` for explicit mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AssessmentTaskType, AssessmentReason, ClassifierMode } from '../types.js'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getModel: vi.fn(),
  llmMetadataContextRun: vi.fn(),
  embeddingClassifierClassify: vi.fn(),
  embeddingClassifierInitialize: vi.fn(),
  embeddingClassifierIsReady: vi.fn(),
  lrClassifierClassify: vi.fn(),
  lrClassifierInitialize: vi.fn(),
}))

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

const { createAssessmentAgent } = await import('../index.js')

const mockGenerateText = mocks.generateText
const mockLRClassify = mocks.lrClassifierClassify

// All classify() calls in this file use logistic-regression so mock setup maps 1:1 to assertions.
const LR = ClassifierMode.LogisticRegression

// LR result helpers
function lrFix(confidence: number, requiresHaikuVerification = false) {
  return {
    taskType: AssessmentTaskType.Fix,
    confidence,
    similarity: confidence / 100,
    matchedExample: '',
    margin: (confidence - 50) / 50,
    method: 'embedding-lr' as const,
    hasNegation: false,
    requiresHaikuVerification,
  }
}

function lrGeneral(confidence: number, requiresHaikuVerification = false, hasNegation = false) {
  return {
    taskType: AssessmentTaskType.General,
    confidence,
    similarity: 1 - confidence / 100,
    matchedExample: '',
    margin: (confidence - 50) / 50,
    method: 'embedding-lr' as const,
    hasNegation,
    requiresHaikuVerification,
  }
}

describe('Classifier pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getModel.mockResolvedValue({
      doGenerate: vi.fn(),
      doStream: vi.fn(),
      modelId: 'mock-haiku',
    })

    mocks.llmMetadataContextRun.mockImplementation(
      async function (_metadata: unknown, fn: () => Promise<unknown>) { return fn(); }
    )

    mocks.embeddingClassifierInitialize.mockResolvedValue(undefined)
    mocks.embeddingClassifierIsReady.mockReturnValue(true)
    mocks.embeddingClassifierClassify.mockResolvedValue(lrGeneral(100))
    mocks.lrClassifierInitialize.mockResolvedValue(undefined)
    mockLRClassify.mockResolvedValue(lrGeneral(100))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fast path', () => {
    it('should return EmbeddingCompleted for high-confidence general', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('add a contact form', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
      expect(outcome.completedInTime).toBe(true)
    })

    it('should return EmbeddingCompleted and apply override for high-confidence fix', async () => {
      mockLRClassify.mockResolvedValue(lrFix(88))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('fix the broken button', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.overrideApplied).toBe(true)
      expect(outcome.appliedBudget).toBe('airo-builder:fix-task')
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
    })

    it('should not call Haiku on fast path', async () => {
      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      await agent.classify('build me a landing page', { enabledOverride: true, classifierMode: LR })

      expect(mockGenerateText).not.toHaveBeenCalled()
    })
  })

  describe('Haiku tiebreaker', () => {
    it('should escalate to Haiku when classifier requires verification', async () => {
      mockLRClassify.mockResolvedValue(lrGeneral(75, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 90, reasoning: 'general request' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('publish my app', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.completedInTime).toBe(true)
    })

    it('should apply override when Haiku returns high-confidence fix', async () => {
      mockLRClassify.mockResolvedValue(lrGeneral(75, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 85, reasoning: 'Fix intent' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000, confidenceThreshold: 65 })
      const outcome = await agent.classify('nothing is working on my site', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.overrideApplied).toBe(true)
      expect(outcome.appliedBudget).toBe('airo-builder:fix-task')
    })

    it('should not apply override when Haiku returns low confidence', async () => {
      mockLRClassify.mockResolvedValue(lrGeneral(65, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 50, reasoning: 'Uncertain intent' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000, confidenceThreshold: 65 })
      const outcome = await agent.classify('perhaps something went wrong', { enabledOverride: true, classifierMode: LR })

      expect(outcome.overrideApplied).toBe(false)
    })

    //todo re-enable this when new BMS goes live

    // it('should reject Haiku publish/domain JSON and not apply those budget overrides', async () => {
    //   mockLRClassify.mockResolvedValue(lrGeneral(75, true))
    //   mockGenerateText.mockResolvedValue({
    //     text: JSON.stringify({
    //       taskType: AssessmentTaskType.Publish,
    //       confidence: 95,
    //       reasoning: 'stale or invalid model output',
    //     }),
    //   })

    //   const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000, confidenceThreshold: 65 })
    //   const outcome = await agent.classify('ambiguous prompt', { enabledOverride: true, classifierMode: LR })

    //   expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
    //   expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    //   expect(outcome.overrideApplied).toBe(false)
    //   expect(outcome.appliedBudget).toBeUndefined()
    // })

    it('should escalate to Haiku when negation is detected', async () => {
      mockLRClassify.mockResolvedValue(lrGeneral(70, true, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 90 }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 600 })
      const outcome = await agent.classify('make my site available to visitors', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.completedInTime).toBe(true)
      expect(outcome.overrideApplied).toBe(true)
    })

    it('should skip Haiku and use classifier result when insufficient time remains', async () => {
      mockLRClassify.mockResolvedValue(lrFix(70, true))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('make my site available to visitors', { enabledOverride: true, classifierMode: LR })

      // BILLING SAFETY: Fix + requiresHaikuVerification + no time → fall back to General
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingTimeoutFallback)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should handle Haiku errors and apply billing-safety fallback', async () => {
      mockLRClassify.mockResolvedValue(lrFix(70, true))
      mockGenerateText.mockRejectedValue(new Error('Model error'))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('make my site available to visitors', { enabledOverride: true, classifierMode: LR })

      // BILLING SAFETY: Fix with requiresHaikuVerification → fall back to General on error
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.reason).toBe(AssessmentReason.Error)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should fall back to classifier General result when Haiku errors (no billing safety needed)', async () => {
      mockLRClassify.mockResolvedValue(lrGeneral(70, true))
      mockGenerateText.mockRejectedValue(new Error('Model error'))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('make my site available to visitors', { enabledOverride: true, classifierMode: LR })

      // Already General → no billing safety fallback, result is General/70
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.result?.confidence).toBe(70)
    })

    it('should return error when classifier itself throws', async () => {
      mockLRClassify.mockRejectedValue(new Error('Embedding API error'))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 500 })
      const outcome = await agent.classify('make my site available to visitors', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.Error)
      expect(outcome.overrideApplied).toBe(false)
    })
  })

  describe('billing-critical classification rules', () => {
    it('should classify "continue" via Haiku as general (continuation pattern)', async () => {
      mockLRClassify.mockResolvedValue(lrFix(65, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 85, reasoning: 'continuation' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('continue', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should classify "keep going" via Haiku as general', async () => {
      mockLRClassify.mockResolvedValue(lrFix(60, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 80, reasoning: 'continuation' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('keep going', { enabledOverride: true, classifierMode: LR })

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should classify "finish this" via Haiku as general', async () => {
      mockLRClassify.mockResolvedValue(lrFix(62, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 82, reasoning: 'completion request' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('finish this', { enabledOverride: true, classifierMode: LR })

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should classify "the page is empty" via Haiku as general (incomplete work)', async () => {
      mockLRClassify.mockResolvedValue(lrFix(58, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 78, reasoning: 'incomplete work' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('the page is empty', { enabledOverride: true, classifierMode: LR })

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should classify "content is missing" via Haiku as general (incomplete work)', async () => {
      mockLRClassify.mockResolvedValue(lrFix(55, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 75, reasoning: 'work not done' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('content is missing', { enabledOverride: true, classifierMode: LR })

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should classify clear fix patterns as fix on fast path', async () => {
      mockLRClassify.mockResolvedValue(lrFix(90))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('fix this, the button is broken', { enabledOverride: true, classifierMode: LR })

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(true)
      expect(outcome.appliedBudget).toBe('airo-builder:fix-task')
    })

    it('should classify "resume where you left off" via Haiku as general', async () => {
      mockLRClassify.mockResolvedValue(lrFix(60, true))
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 85, reasoning: 'resume is continuation' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('resume where you left off', { enabledOverride: true, classifierMode: LR })

      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should apply billing-safety fallback when Haiku is skipped and classifier returned fix (requiresHaikuVerification)', async () => {
      mockLRClassify.mockResolvedValue(lrFix(75, true))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('continue working', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingTimeoutFallback)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should apply billing-safety fallback when Haiku times out and classifier returned fix (requiresHaikuVerification)', async () => {
      mockLRClassify.mockResolvedValue(lrFix(75, true))
      mockGenerateText.mockImplementation(async function () {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return { text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 90 }) }
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 600 })
      const outcome = await agent.classify('continue working', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.Timeout)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should NOT apply billing-safety when classifier is high-confidence fix (no Haiku needed)', async () => {
      mockLRClassify.mockResolvedValue(lrFix(90))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('fix this bug', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(true)
    })

    it('should not apply billing-safety for General result with requiresHaikuVerification when Haiku skipped', async () => {
      mockLRClassify.mockResolvedValue(lrGeneral(65, true))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('Search by ingredients', { enabledOverride: true, classifierMode: LR })

      // General + requiresHaikuVerification + no time → billing safety doesn't apply (already General)
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingTimeoutFallback)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should apply billing-safety fallback when Haiku errors and classifier returned fix (requiresHaikuVerification)', async () => {
      mockLRClassify.mockResolvedValue(lrFix(70, true))
      mockGenerateText.mockRejectedValue(new Error('Network error'))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('Search by ingredients', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.Error)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should trust fix classification when classifier is confident and Haiku is skipped', async () => {
      mockLRClassify.mockResolvedValue(lrFix(85))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('fix this issue', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(true)
    })

    it('should NOT apply billing-safety for high-confidence fix', async () => {
      mockLRClassify.mockResolvedValue(lrFix(90))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('fix this bug', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(true)
    })
  })

  describe('session context gate', () => {
    // When LR returns General AND a non-general session is active,
    // Classifier routes to Haiku even if confidence is high.
    const highConfidenceLRGeneral = lrGeneral(95)

    it('should route to Haiku when previous assessment was fix (session context gate)', async () => {
      mockLRClassify.mockResolvedValue(highConfidenceLRGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 85, reasoning: 'follow-up' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('here', {
        enabledOverride: true,
        classifierMode: LR,
        previousAssessmentTaskType: AssessmentTaskType.Fix,
        previousUserMessage: 'fix my button',
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(true)
    })

    it('should route to Haiku and return general for ambiguous follow-up in active fix session', async () => {
      mockLRClassify.mockResolvedValue(highConfidenceLRGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 80, reasoning: 'new request' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('go ahead', {
        enabledOverride: true,
        classifierMode: LR,
        previousAssessmentTaskType: AssessmentTaskType.Fix,
        previousUserMessage: 'fix my button',
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    })

    it('should route to Haiku when previous fix session active and Haiku confirms fix', async () => {
      mockLRClassify.mockResolvedValue(highConfidenceLRGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 78, reasoning: 'fix follow-up' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('yes that one', {
        enabledOverride: true,
        classifierMode: LR,
        previousAssessmentTaskType: AssessmentTaskType.Fix,
        previousUserMessage: 'fix the broken link',
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
    })

    it('should NOT route to Haiku when previous assessment was general (no session gate)', async () => {
      mockLRClassify.mockResolvedValue(highConfidenceLRGeneral)

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('here', {
        enabledOverride: true,
        classifierMode: LR,
        previousAssessmentTaskType: AssessmentTaskType.General,
      })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    })

    it('should NOT route to Haiku when no previous assessment exists', async () => {
      mockLRClassify.mockResolvedValue(highConfidenceLRGeneral)

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('here', { enabledOverride: true, classifierMode: LR })

      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    })

    it('should not apply override when Haiku returns fix below confidence threshold', async () => {
      mockLRClassify.mockResolvedValue(highConfidenceLRGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.Fix, confidence: 45, reasoning: 'uncertain' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000, confidenceThreshold: 65 })
      const outcome = await agent.classify('hmm', {
        enabledOverride: true,
        classifierMode: LR,
        previousAssessmentTaskType: AssessmentTaskType.Fix,
        previousUserMessage: 'fix the error',
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(outcome.overrideApplied).toBe(false)
    })

    it('should fall back to classifier result when insufficient time for Haiku (session context)', async () => {
      mockLRClassify.mockResolvedValue(highConfidenceLRGeneral)

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 100 })
      const outcome = await agent.classify('here', {
        enabledOverride: true,
        classifierMode: LR,
        previousAssessmentTaskType: AssessmentTaskType.Fix,
        previousUserMessage: 'fix the button',
      })

      // <500ms remaining → Haiku skipped, LR result is General → no billing safety fallback
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingTimeoutFallback)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    })

    it('should not trigger session gate when classifier returns Fix (gate only fires for General results)', async () => {
      mockLRClassify.mockResolvedValue(lrFix(90))

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('fix this button', {
        enabledOverride: true,
        classifierMode: LR,
        previousAssessmentTaskType: AssessmentTaskType.Fix,
      })

      // High-confidence Fix → fast path, session gate doesn't apply
      expect(outcome.reason).toBe(AssessmentReason.EmbeddingCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.Fix)
    })

    it('should call Haiku with session context when classifier returns General in active session', async () => {
      mockLRClassify.mockResolvedValue(highConfidenceLRGeneral)
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ taskType: AssessmentTaskType.General, confidence: 85, reasoning: 'general request' }),
      })

      const agent = createAssessmentAgent({ enabled: true, timeoutMs: 2000 })
      const outcome = await agent.classify('make it pretty', {
        enabledOverride: true,
        classifierMode: LR,
        previousAssessmentTaskType: AssessmentTaskType.Fix,
      })

      expect(outcome.reason).toBe(AssessmentReason.LlmCompleted)
      expect(outcome.result?.taskType).toBe(AssessmentTaskType.General)
    })
  })
})
