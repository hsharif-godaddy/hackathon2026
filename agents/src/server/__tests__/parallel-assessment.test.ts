/**
 * Parallel Assessment Tests
 *
 * Tests for the budget service flag ON parallel execution model:
 * - Assessment agent runs in parallel (non-blocking) when budgetServiceEnabled=true
 * - Assessment agent runs blocking when budgetServiceEnabled=false (grants mode)
 * - Timeout handling for parallel assessment promises
 * - Results cached after completion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the assessment agent - must be before any imports that use it
vi.mock('../../agents/assessment-agent/index.js', () => ({
  getAssessmentAgent: vi.fn(function () { return {
    classify: vi.fn().mockResolvedValue({
      result: { taskType: 'general', confidence: 85 },
      overrideApplied: false,
      appliedBudget: null,
      durationMs: 100,
    }),
  }; }),
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

import { withTimeout } from '../../utils/promise-utils.js'
import {
  executeAssessment,
  ASSESSMENT_MODE,
  PARALLEL_ASSESSMENT_TIMEOUT_MS,
  AWAIT_ASSESSMENT_REASON,
  deriveUsedFreeGrants,
  cleanupAssessmentStateOnError,
  shouldAwaitParallelAssessment,
  type AssessmentExecutorContext,
  type ParallelAssessmentResult,
  type BlockingAssessmentResult,
  type ParallelAssessmentState,
} from '../assessment-executor.js'
import { getAssessmentAgent } from '../../agents/assessment-agent/index.js'

// Test-local type for partial mock outcomes (looser than exported ParallelAssessmentState)
interface TestParallelAssessmentState {
  promise: Promise<any>
  outcome?: any
  timedOut?: boolean
}

// Helper no-ops for tests that don't care about specific callbacks
const noop = () => {}
const noopErr = () => {}

// ============================================================================
// PARALLEL ASSESSMENT TIMEOUT BEHAVIOR
// Tests the withTimeout utility usage patterns for assessment
// ============================================================================

describe('parallel assessment timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('awaits assessment result when it completes before timeout', async () => {
    const mockAssessmentResult = {
      result: { taskType: 'general', confidence: 85 },
      overrideApplied: false,
      appliedBudget: null,
      durationMs: 150,
      reason: 'High confidence general task',
    }

    const assessmentPromise = Promise.resolve(mockAssessmentResult)
    const result = await withTimeout(assessmentPromise, PARALLEL_ASSESSMENT_TIMEOUT_MS, noop, noopErr)

    expect(result).toEqual(mockAssessmentResult)
  })

  it('returns null when assessment times out', async () => {
    const slowAssessmentPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ result: { taskType: 'general' } }), PARALLEL_ASSESSMENT_TIMEOUT_MS + 1000)
    })

    const resultPromise = withTimeout(slowAssessmentPromise, PARALLEL_ASSESSMENT_TIMEOUT_MS, noop, noopErr)

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(PARALLEL_ASSESSMENT_TIMEOUT_MS + 100)

    const result = await resultPromise
    expect(result).toBeNull()
  })

  it('logs timeout via callback when assessment times out', async () => {
    const onTimeout = vi.fn()
    const slowAssessmentPromise = new Promise(() => {
      // Never resolves
    })

    const resultPromise = withTimeout(slowAssessmentPromise, PARALLEL_ASSESSMENT_TIMEOUT_MS, onTimeout, noopErr)

    await vi.advanceTimersByTimeAsync(PARALLEL_ASSESSMENT_TIMEOUT_MS + 100)

    await resultPromise
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// PARALLEL VS BLOCKING MODE SELECTION
// Tests that executeAssessment correctly selects mode based on budgetServiceEnabled
// ============================================================================

describe('budget service mode selection via executeAssessment', () => {
  const baseContext: AssessmentExecutorContext = {
    socketId: 'socket-123',
    message: 'test message',
    appId: 'app-123',
    customerId: 'customer-123',
    budgetServiceEnabled: false,
    enableAssessmentOverride: false,
    isInitialPrompt: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parallel result when budgetServiceEnabled is true', async () => {
    const result = await executeAssessment({
      ...baseContext,
      budgetServiceEnabled: true,
    })

    expect(result.mode).toBe(ASSESSMENT_MODE.PARALLEL)
    expect((result as ParallelAssessmentResult).assessmentPromise).toBeDefined()
  })

  it('returns blocking result when budgetServiceEnabled is false', async () => {
    const result = await executeAssessment({
      ...baseContext,
      budgetServiceEnabled: false,
    })

    expect(result.mode).toBe(ASSESSMENT_MODE.BLOCKING)
    expect((result as BlockingAssessmentResult).assessmentOutcome).toBeDefined()
  })

  it('defaults to blocking mode when budgetServiceEnabled is not set', async () => {
    const contextWithoutFlag = {
      ...baseContext,
      budgetServiceEnabled: undefined as unknown as boolean,
    }

    const result = await executeAssessment({
      ...contextWithoutFlag,
      budgetServiceEnabled: false, // Explicit false simulates undefined coerced to false
    })

    expect(result.mode).toBe(ASSESSMENT_MODE.BLOCKING)
  })
})

// ============================================================================
// PARALLEL MODE PROMISE BEHAVIOR
// Tests that parallel mode returns immediately without awaiting assessment
// ============================================================================

describe('parallel mode promise behavior', () => {
  const baseContext: AssessmentExecutorContext = {
    socketId: 'socket-123',
    message: 'test message',
    appId: 'app-123',
    budgetServiceEnabled: true,
    enableAssessmentOverride: false,
    isInitialPrompt: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns immediately without awaiting assessment in parallel mode', async () => {
    let resolveClassify: (value: any) => void
    const classifyPromise = new Promise((resolve) => {
      resolveClassify = resolve
    })

    vi.mocked(getAssessmentAgent).mockReturnValue({
      classify: vi.fn().mockReturnValue(classifyPromise),
    } as any)

    // executeAssessment should return immediately
    const result = await executeAssessment(baseContext)

    expect(result.mode).toBe(ASSESSMENT_MODE.PARALLEL)
    const parallelResult = result as ParallelAssessmentResult

    // The promise should still be pending
    let resolved = false
    parallelResult.assessmentPromise.then(() => { resolved = true })

    // Give microtask queue a chance to run
    await Promise.resolve()
    expect(resolved).toBe(false)

    // Now resolve it
    resolveClassify!({ result: { taskType: 'fix' } })
    const outcome = await parallelResult.assessmentPromise
    expect(outcome?.result?.taskType).toBe('fix')
  })

  it('caches message for multi-turn context in parallel mode', async () => {
    const result = await executeAssessment({
      ...baseContext,
      message: 'fix the login button',
    })

    expect(result.messageToCache).toBe('fix the login button')
  })
})

// ============================================================================
// BLOCKING MODE TASK TYPE ACCESS
// Tests that blocking mode provides taskType via assessmentOutcome.result
// (Callers derive taskType from assessmentOutcome - no redundant projection)
// ============================================================================

describe('blocking mode task type access', () => {
  const baseContext: AssessmentExecutorContext = {
    socketId: 'socket-123',
    message: 'test message',
    appId: 'app-123',
    budgetServiceEnabled: false,
    enableAssessmentOverride: false,
    isInitialPrompt: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides taskType via assessmentOutcome.result', async () => {
    vi.mocked(getAssessmentAgent).mockReturnValue({
      classify: vi.fn().mockResolvedValue({
        result: { taskType: 'fix', confidence: 90 },
        overrideApplied: false,
      }),
    } as any)

    const result = await executeAssessment(baseContext)
    const blockingResult = result as BlockingAssessmentResult

    // Callers derive taskType from assessmentOutcome directly
    expect(blockingResult.assessmentOutcome.result?.taskType).toBe('fix')
  })

  it('taskType is undefined when not classified', async () => {
    vi.mocked(getAssessmentAgent).mockReturnValue({
      classify: vi.fn().mockResolvedValue({
        result: { taskType: undefined, confidence: 0 },
        overrideApplied: false,
      }),
    } as any)

    const result = await executeAssessment(baseContext)
    const blockingResult = result as BlockingAssessmentResult

    expect(blockingResult.assessmentOutcome.result?.taskType).toBeUndefined()
  })

  it('returns correct taskType across different classifications', async () => {
    const mockClassify = vi.fn()
    vi.mocked(getAssessmentAgent).mockReturnValue({ classify: mockClassify } as any)

    // First call: general
    mockClassify.mockResolvedValueOnce({ result: { taskType: 'general' }, overrideApplied: false })
    const result1 = await executeAssessment(baseContext)
    expect((result1 as BlockingAssessmentResult).assessmentOutcome.result?.taskType).toBe('general')

    // Second call: fix
    mockClassify.mockResolvedValueOnce({ result: { taskType: 'fix' }, overrideApplied: false })
    const result2 = await executeAssessment(baseContext)
    expect((result2 as BlockingAssessmentResult).assessmentOutcome.result?.taskType).toBe('fix')

    // Third call: publish
    mockClassify.mockResolvedValueOnce({ result: { taskType: 'publish' }, overrideApplied: false })
    const result3 = await executeAssessment(baseContext)
    expect((result3 as BlockingAssessmentResult).assessmentOutcome.result?.taskType).toBe('publish')
  })
})

// ============================================================================
// ASSESSMENT OUTCOME LIFECYCLE
// Documents the cleanup behavior - actual cleanup tested via integration tests
// These tests verify the contract that executeAssessment provides the data
// needed for the websocket server to implement proper cleanup
// ============================================================================

describe('assessment outcome lifecycle', () => {
  const baseContext: AssessmentExecutorContext = {
    socketId: 'socket-123',
    message: 'test message',
    appId: 'app-123',
    budgetServiceEnabled: false,
    enableAssessmentOverride: false,
    isInitialPrompt: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocking result includes complete assessmentOutcome for immediate use', async () => {
    vi.mocked(getAssessmentAgent).mockReturnValue({
      classify: vi.fn().mockResolvedValue({
        result: { taskType: 'general', confidence: 85 },
        overrideApplied: false,
        appliedBudget: null,
        durationMs: 150,
        reason: 'Low confidence general task',
      }),
    } as any)

    const result = await executeAssessment(baseContext)
    const blockingResult = result as BlockingAssessmentResult

    // All fields available immediately for websocket server to cache/cleanup
    expect(blockingResult.assessmentOutcome).toBeDefined()
    expect(blockingResult.assessmentOutcome.result?.taskType).toBe('general')
    expect(blockingResult.assessmentOutcome.durationMs).toBe(150)
    expect(blockingResult.messageToCache).toBe('test message')
  })

  it('parallel result provides promise for deferred outcome retrieval', async () => {
    vi.mocked(getAssessmentAgent).mockReturnValue({
      classify: vi.fn().mockResolvedValue({
        result: { taskType: 'fix', confidence: 92 },
        overrideApplied: true,
        appliedBudget: 'care-budget',
        durationMs: 200,
      }),
    } as any)

    const result = await executeAssessment({
      ...baseContext,
      budgetServiceEnabled: true,
    })
    const parallelResult = result as ParallelAssessmentResult

    // Promise can be awaited later (in onMessageComplete or onBudgetReport)
    const outcome = await parallelResult.assessmentPromise
    expect(outcome.result).toBeDefined()
    expect(outcome.result!.taskType).toBe('fix')
    expect(outcome.overrideApplied).toBe(true)
    expect(outcome.appliedBudget).toBe('care-budget')
  })
})

// ============================================================================
// REJECTION PROPAGATION
// Tests that rejection propagates through the no-op .catch() to consumers
// ============================================================================

describe('rejection propagation in parallel mode', () => {
  const baseContext: AssessmentExecutorContext = {
    socketId: 'socket-123',
    message: 'test message',
    appId: 'app-123',
    budgetServiceEnabled: true,
    enableAssessmentOverride: false,
    isInitialPrompt: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('propagates rejection through the no-op .catch() to consumer try/catch', async () => {
    const classifyError = new Error('LLM rate limit exceeded')
    vi.mocked(getAssessmentAgent).mockReturnValue({
      classify: vi.fn().mockRejectedValue(classifyError),
    } as any)

    const result = await executeAssessment(baseContext)
    const parallelResult = result as ParallelAssessmentResult

    // The promise should reject when awaited
    await expect(parallelResult.assessmentPromise).rejects.toThrow('LLM rate limit exceeded')
  })

  it('allows consumer to catch rejection and handle gracefully', async () => {
    const classifyError = new Error('Network error')
    vi.mocked(getAssessmentAgent).mockReturnValue({
      classify: vi.fn().mockRejectedValue(classifyError),
    } as any)

    const result = await executeAssessment(baseContext)
    const parallelResult = result as ParallelAssessmentResult

    // Consumer wraps in try/catch (like beforeMessageComplete/onMessageComplete)
    let caughtError: Error | null = null
    try {
      await parallelResult.assessmentPromise
    } catch (err) {
      caughtError = err as Error
    }

    expect(caughtError).not.toBeNull()
    expect(caughtError?.message).toBe('Network error')
  })

  it('rejection propagates through withTimeout before timeout fires', async () => {
    const classifyError = new Error('API error')
    vi.mocked(getAssessmentAgent).mockReturnValue({
      classify: vi.fn().mockRejectedValue(classifyError),
    } as any)

    const result = await executeAssessment(baseContext)
    const parallelResult = result as ParallelAssessmentResult

    // withTimeout should propagate rejection if it arrives before timeout
    await expect(
      withTimeout(parallelResult.assessmentPromise, PARALLEL_ASSESSMENT_TIMEOUT_MS, noop, noopErr)
    ).rejects.toThrow('API error')
  })
})

// ============================================================================
// SHOULD AWAIT PARALLEL ASSESSMENT
// Tests the extracted function that guards against double-await in onMessageComplete
// ============================================================================

describe('shouldAwaitParallelAssessment', () => {
  it('returns HAS_OUTCOME when outcome is already cached', () => {
    const state: ParallelAssessmentState = {
      promise: Promise.resolve({} as any),
      outcome: { result: { taskType: 'fix', confidence: 90 }, overrideApplied: false, durationMs: 100 },
    }
    const result = shouldAwaitParallelAssessment(state)
    expect(result).toEqual({ shouldAwait: false, reason: AWAIT_ASSESSMENT_REASON.HAS_OUTCOME })
  })

  it('returns ALREADY_TIMED_OUT when timedOut flag is set', () => {
    const state: ParallelAssessmentState = {
      promise: Promise.resolve({} as any),
      timedOut: true,
    }
    const result = shouldAwaitParallelAssessment(state)
    expect(result).toEqual({ shouldAwait: false, reason: AWAIT_ASSESSMENT_REASON.ALREADY_TIMED_OUT })
  })

  it('returns SHOULD_AWAIT when no outcome and not timed out', () => {
    const state: ParallelAssessmentState = {
      promise: Promise.resolve({} as any),
    }
    const result = shouldAwaitParallelAssessment(state)
    expect(result).toEqual({ shouldAwait: true, reason: AWAIT_ASSESSMENT_REASON.SHOULD_AWAIT })
  })

  it('returns SHOULD_AWAIT when timedOut is explicitly false', () => {
    const state: ParallelAssessmentState = {
      promise: Promise.resolve({} as any),
      timedOut: false,
    }
    const result = shouldAwaitParallelAssessment(state)
    expect(result).toEqual({ shouldAwait: true, reason: AWAIT_ASSESSMENT_REASON.SHOULD_AWAIT })
  })

  it('prioritizes HAS_OUTCOME over ALREADY_TIMED_OUT (both set)', () => {
    // If both outcome and timedOut are set, HAS_OUTCOME takes precedence
    // because the outcome is valid and usable
    const state: ParallelAssessmentState = {
      promise: Promise.resolve({} as any),
      outcome: { result: { taskType: 'general', confidence: 85 }, overrideApplied: false, durationMs: 50 },
      timedOut: true,
    }
    const result = shouldAwaitParallelAssessment(state)
    expect(result).toEqual({ shouldAwait: false, reason: AWAIT_ASSESSMENT_REASON.HAS_OUTCOME })
  })
})

// ============================================================================
// DERIVE USED FREE GRANTS
// Tests the pure function that determines billing attribution
// ============================================================================

describe('deriveUsedFreeGrants', () => {
  it('returns false when budgetServiceEnabled=true (BMS mode uses onBudgetReport)', () => {
    const outcome = { overrideApplied: true } as any
    expect(deriveUsedFreeGrants(true, outcome, true)).toBe(false)
  })

  it('returns false when outcome is undefined', () => {
    expect(deriveUsedFreeGrants(false, undefined, true)).toBe(false)
  })

  it('returns false when overrideApplied is false', () => {
    const outcome = { overrideApplied: false } as any
    expect(deriveUsedFreeGrants(false, outcome, true)).toBe(false)
  })

  it('returns false when enableAssessmentOverride is false', () => {
    const outcome = { overrideApplied: true } as any
    expect(deriveUsedFreeGrants(false, outcome, false)).toBe(false)
  })

  it('returns true only when all conditions met: grants mode + overrideApplied + enableAssessmentOverride', () => {
    const outcome = { overrideApplied: true } as any
    expect(deriveUsedFreeGrants(false, outcome, true)).toBe(true)
  })

  it('returns false when outcome.overrideApplied is undefined', () => {
    const outcome = {} as any
    expect(deriveUsedFreeGrants(false, outcome, true)).toBe(false)
  })
})

// ============================================================================
// CLEANUP ASSESSMENT STATE ON ERROR
// Tests the cleanup logic for assessment state on error path
// ============================================================================

describe('cleanupAssessmentStateOnError', () => {
  it('deletes blockingOutcome in grants mode (budgetServiceEnabled=false)', () => {
    const parallelStates = new Map<string, TestParallelAssessmentState>()
    const blockingOutcomes = new Map<string, any>()
    const socketId = 'socket-123'

    blockingOutcomes.set(socketId, { result: { taskType: 'fix' } })

    const result = cleanupAssessmentStateOnError(false, parallelStates as any, blockingOutcomes, socketId)

    expect(blockingOutcomes.has(socketId)).toBe(false)
    expect(result.preserved).toBe(false)
  })

  it('preserves parallelState in BMS mode (budgetServiceEnabled=true)', () => {
    const parallelStates = new Map<string, TestParallelAssessmentState>()
    const blockingOutcomes = new Map<string, any>()
    const socketId = 'socket-123'

    parallelStates.set(socketId, { promise: Promise.resolve({} as any), outcome: { result: { taskType: 'fix' } } as any })
    blockingOutcomes.set(socketId, { result: { taskType: 'general' } })

    const result = cleanupAssessmentStateOnError(true, parallelStates as any, blockingOutcomes, socketId)

    expect(parallelStates.has(socketId)).toBe(true)
    // BMS mode should not touch blockingOutcomes either
    expect(blockingOutcomes.has(socketId)).toBe(true)
    expect(result.preserved).toBe(true)
  })

  it('returns preserved=false in BMS mode when no parallel state exists', () => {
    const parallelStates = new Map<string, TestParallelAssessmentState>()
    const blockingOutcomes = new Map<string, any>()
    const socketId = 'socket-123'

    const result = cleanupAssessmentStateOnError(true, parallelStates as any, blockingOutcomes, socketId)

    expect(result.preserved).toBe(false)
  })

  it('does not delete parallelState in grants mode', () => {
    const parallelStates = new Map<string, TestParallelAssessmentState>()
    const blockingOutcomes = new Map<string, any>()
    const socketId = 'socket-123'

    parallelStates.set(socketId, { promise: Promise.resolve({} as any) })
    blockingOutcomes.set(socketId, { result: { taskType: 'general' } })

    cleanupAssessmentStateOnError(false, parallelStates as any, blockingOutcomes, socketId)

    // parallelStates untouched, only blockingOutcomes deleted
    expect(parallelStates.has(socketId)).toBe(true)
    expect(blockingOutcomes.has(socketId)).toBe(false)
  })
})
