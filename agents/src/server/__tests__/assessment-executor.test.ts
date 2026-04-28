/**
 * Assessment Executor Tests
 *
 * Tests for the extracted assessment execution logic that handles
 * both parallel (budget service) and blocking (grants) modes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  executeAssessment,
  ASSESSMENT_MODE,
  type AssessmentExecutorContext,
  type ParallelAssessmentResult,
  type BlockingAssessmentResult,
} from '../assessment-executor.js'

// Mock the assessment agent
vi.mock('../../agents/assessment-agent/index.js', () => ({
  getAssessmentAgent: vi.fn(() => ({
    classify: vi.fn(),
  })),
  AssessmentTaskType: {
    General: 'general',
    Fix: 'fix',
    Publish: 'publish',
    Domain: 'domain',
  },
}))

// Mock logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { getAssessmentAgent } from '../../agents/assessment-agent/index.js'

describe('executeAssessment', () => {
  const baseContext: AssessmentExecutorContext = {
    socketId: 'socket-123',
    message: 'test message',
    appId: 'app-123',
    customerId: 'customer-123',
    budgetServiceEnabled: false,
    enableAssessmentOverride: false,
    isInitialPrompt: false,
    previousUserMessage: undefined,
    previousAssessmentTaskType: undefined,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parallel mode (budgetServiceEnabled=true)', () => {
    it('returns a parallel result with assessment promise', async () => {
      const mockClassify = vi.fn().mockResolvedValue({
        result: { taskType: 'general', confidence: 85 },
        overrideApplied: false,
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      const result = await executeAssessment({
        ...baseContext,
        budgetServiceEnabled: true,
      })

      expect(result.mode).toBe(ASSESSMENT_MODE.PARALLEL)

      const parallelResult = result as ParallelAssessmentResult
      expect(parallelResult.assessmentPromise).toBeDefined()
      expect(parallelResult.messageToCache).toBe('test message')
    })

    it('does not await the assessment promise', async () => {
      let resolvePromise: (value: any) => void
      const mockClassify = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolvePromise = resolve
        })
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      const resultPromise = executeAssessment({
        ...baseContext,
        budgetServiceEnabled: true,
      })

      // Should return immediately without waiting for classify to resolve
      const result = await resultPromise
      expect(result.mode).toBe(ASSESSMENT_MODE.PARALLEL)

      // Now resolve the promise
      resolvePromise!({ result: { taskType: 'general' } })
      const parallelResult = result as ParallelAssessmentResult
      const assessmentOutcome = await parallelResult.assessmentPromise
      expect(assessmentOutcome?.result?.taskType).toBe('general')
    })

    it('passes correct options to classify', async () => {
      const mockClassify = vi.fn().mockResolvedValue({
        result: { taskType: 'fix', confidence: 90 },
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      await executeAssessment({
        ...baseContext,
        budgetServiceEnabled: true,
        previousUserMessage: 'previous message',
        previousAssessmentTaskType: 'general' as any,
        isInitialPrompt: true,
      })

      expect(mockClassify).toHaveBeenCalledWith('test message', {
        appId: 'app-123',
        customerId: 'customer-123',
        socketId: 'socket-123',
        enabledOverride: true,
        previousUserMessage: 'previous message',
        previousAssessmentTaskType: 'general',
        isInitialPrompt: true,
      })
    })
  })

  describe('blocking mode (budgetServiceEnabled=false)', () => {
    it('returns a blocking result with completed assessment', async () => {
      const mockClassify = vi.fn().mockResolvedValue({
        result: { taskType: 'general', confidence: 85 },
        overrideApplied: false,
        appliedBudget: null,
        durationMs: 150,
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      const result = await executeAssessment({
        ...baseContext,
        budgetServiceEnabled: false,
      })

      expect(result.mode).toBe(ASSESSMENT_MODE.BLOCKING)

      const blockingResult = result as BlockingAssessmentResult
      expect(blockingResult.assessmentOutcome).toBeDefined()
      expect(blockingResult?.assessmentOutcome.result?.taskType).toBe('general')
      expect(blockingResult.messageToCache).toBe('test message')
    })

    it('awaits the assessment before returning', async () => {
      const mockClassify = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({
            result: { taskType: 'fix', confidence: 90 },
            overrideApplied: false,
          }), 10)
        })
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      const start = Date.now()
      const result = await executeAssessment({
        ...baseContext,
        budgetServiceEnabled: false,
      })
      const elapsed = Date.now() - start

      expect(result.mode).toBe(ASSESSMENT_MODE.BLOCKING)
      // Allow 1ms tolerance for timer precision variance
      expect(elapsed).toBeGreaterThanOrEqual(9)
    })

    it('includes pendingBudgetOverride when override applied and enabled', async () => {
      const mockClassify = vi.fn().mockResolvedValue({
        result: { taskType: 'fix', confidence: 95 },
        overrideApplied: true,
        appliedBudget: 'care-agent-budget',
        durationMs: 100,
        reason: 'High confidence fix task',
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      const result = await executeAssessment({
        ...baseContext,
        budgetServiceEnabled: false,
        enableAssessmentOverride: true,
      })

      const blockingResult = result as BlockingAssessmentResult
      expect(blockingResult.pendingBudgetOverride).toBe('care-agent-budget')
    })

    it('does not include pendingBudgetOverride when override disabled (dry run)', async () => {
      const mockClassify = vi.fn().mockResolvedValue({
        result: { taskType: 'fix', confidence: 95 },
        overrideApplied: true,
        appliedBudget: 'care-agent-budget',
        durationMs: 100,
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      const result = await executeAssessment({
        ...baseContext,
        budgetServiceEnabled: false,
        enableAssessmentOverride: false,
      })

      const blockingResult = result as BlockingAssessmentResult
      expect(blockingResult.pendingBudgetOverride).toBeUndefined()
    })

    it('does not include pendingBudgetOverride when override not applied', async () => {
      const mockClassify = vi.fn().mockResolvedValue({
        result: { taskType: 'general', confidence: 85 },
        overrideApplied: false,
        appliedBudget: null,
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      const result = await executeAssessment({
        ...baseContext,
        budgetServiceEnabled: false,
        enableAssessmentOverride: true,
      })

      const blockingResult = result as BlockingAssessmentResult
      expect(blockingResult.pendingBudgetOverride).toBeUndefined()
    })

    it('does not include pendingBudgetOverride when overrideApplied=true but appliedBudget=undefined', async () => {
      // Edge case: guard requires BOTH overrideApplied AND appliedBudget to be truthy
      // This prevents pendingBudgetOverrides.set(socketId, undefined) which would misbehave
      const mockClassify = vi.fn().mockResolvedValue({
        result: { taskType: 'fix', confidence: 95 },
        overrideApplied: true,
        appliedBudget: undefined, // Missing budget despite override being applied
        durationMs: 100,
      })
      vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

      const result = await executeAssessment({
        ...baseContext,
        budgetServiceEnabled: false,
        enableAssessmentOverride: true,
      })

      const blockingResult = result as BlockingAssessmentResult
      expect(blockingResult.pendingBudgetOverride).toBeUndefined()
    })
  })
})

describe('discriminated union mode field', () => {
  it('parallel mode has mode=ASSESSMENT_MODE.PARALLEL', () => {
    const parallelResult: ParallelAssessmentResult = {
      mode: ASSESSMENT_MODE.PARALLEL,
      assessmentPromise: Promise.resolve({} as any),
      messageToCache: 'test',
    }

    expect(parallelResult.mode).toBe(ASSESSMENT_MODE.PARALLEL)
  })

  it('blocking mode has mode=ASSESSMENT_MODE.BLOCKING', () => {
    const blockingResult: BlockingAssessmentResult = {
      mode: ASSESSMENT_MODE.BLOCKING,
      assessmentOutcome: {} as any,
      messageToCache: 'test',
    }

    expect(blockingResult.mode).toBe(ASSESSMENT_MODE.BLOCKING)
  })
})
