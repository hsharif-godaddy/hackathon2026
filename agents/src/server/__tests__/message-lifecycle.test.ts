import { describe, it, expect, vi } from 'vitest'

import {
  LifecycleSessionStore,
  isOverrideApplicable,
  startParallelAssessment,
} from '../message-lifecycle.js'
import type { AssessmentAgent, AssessmentOutcome } from '../../agents/assessment-agent/index.js'
import { AssessmentTaskType, AssessmentReason, ClassifierMode, FixSessionPhase } from '../../agents/assessment-agent/index.js'
import type { ClassificationResult } from '../../agents/assessment-agent/index.js'

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

function makeOutcome(taskType: 'publish' | 'domain' | 'fix' | 'general' = 'fix'): AssessmentOutcome {
  return {
    result: { taskType, confidence: 0.9 },
    overrideApplied: false,
    durationMs: 100,
    reason: 'test',
  } as AssessmentOutcome
}

function makeDeps(classify: AssessmentAgent['classify']) {
  return {
    getAssessmentAgent: () => ({ classify } as unknown as AssessmentAgent),
    sessionStore: new LifecycleSessionStore(),
    logger: silentLogger,
  }
}

describe('startParallelAssessment', () => {
  it('short-circuits when enableAssessmentAgent is false', async () => {
    const classify = vi.fn()
    const deps = makeDeps(classify as any)
    const handle = startParallelAssessment(deps, {
      appId: 'a', sessionKey: 's', message: 'hi',
      isInitialPrompt: false, enableAssessmentAgent: false, enableAssessmentOverride: false,
    })
    expect(classify).not.toHaveBeenCalled()
    expect(await handle.awaitOutcome({ timeoutMs: 100 })).toBeUndefined()
  })

  it('seeds sessionStore with the user message eagerly', () => {
    const classify = vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
    const deps = makeDeps(classify as any)
    startParallelAssessment(deps, {
      appId: 'a', sessionKey: 's', message: 'hi',
      isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
    })
    expect(deps.sessionStore.getLastUserMessage('s')).toBe('hi')
  })

  it('populates task type in sessionStore when classifier resolves', async () => {
    let resolveClassify!: (o: AssessmentOutcome) => void
    const classify = vi.fn().mockReturnValue(new Promise<AssessmentOutcome>((resolve) => { resolveClassify = resolve }))
    const deps = makeDeps(classify as any)
    const handle = startParallelAssessment(deps, {
      appId: 'a', sessionKey: 's', message: 'hi',
      isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
    })
    resolveClassify(makeOutcome('publish'))
    const outcome = await handle.awaitOutcome({ timeoutMs: 100 })
    expect(outcome?.result?.taskType).toBe('publish')
    expect(deps.sessionStore.getLastAssessmentTaskType('s')).toBe('publish')
  })

  it('returns undefined on classifier rejection without throwing', async () => {
    const classify = vi.fn().mockRejectedValue(new Error('boom'))
    const deps = makeDeps(classify as any)
    const handle = startParallelAssessment(deps, {
      appId: 'a', sessionKey: 's', message: 'hi',
      isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
    })
    expect(await handle.awaitOutcome({ timeoutMs: 100 })).toBeUndefined()
  })

  it('returns undefined when the classifier exceeds the timeout', async () => {
    vi.useFakeTimers()
    try {
      const classify = vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
      const deps = makeDeps(classify as any)
      const handle = startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
      })
      const pending = handle.awaitOutcome({ timeoutMs: 500 })
      await vi.advanceTimersByTimeAsync(500)
      expect(await pending).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('caches the outcome so repeat awaits do not re-call the classifier', async () => {
    const classify = vi.fn().mockResolvedValue(makeOutcome('fix'))
    const deps = makeDeps(classify as any)
    const handle = startParallelAssessment(deps, {
      appId: 'a', sessionKey: 's', message: 'hi',
      isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
    })
    const a = await handle.awaitOutcome({ timeoutMs: 100 })
    const b = await handle.awaitOutcome({ timeoutMs: 100 })
    expect(a).toBe(b)
    expect(classify).toHaveBeenCalledTimes(1)
  })

  describe('getTimeoutFallback', () => {
    function lrFixResult(confidence: number): ClassificationResult {
      return {
        taskType: AssessmentTaskType.Fix,
        confidence,
        similarity: confidence / 100,
        matchedExample: '',
        margin: (confidence - 50) / 50,
        method: 'embedding-lr',
        hasNegation: false,
        requiresHaikuVerification: true,
      }
    }

    function lrGeneralResult(confidence: number): ClassificationResult {
      return {
        taskType: AssessmentTaskType.General,
        confidence,
        similarity: 1 - confidence / 100,
        matchedExample: '',
        margin: (confidence - 50) / 50,
        method: 'embedding-lr',
        hasNegation: false,
        requiresHaikuVerification: true,
      }
    }

    it('returns undefined when disabled (enableAssessmentAgent=false)', () => {
      const deps = makeDeps(vi.fn() as any)
      const handle = startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: false, enableAssessmentOverride: false,
      })
      expect(handle.getTimeoutFallback()).toBeUndefined()
    })

    it('returns undefined when LR result is not yet available (classify still running)', () => {
      const classify = vi.fn().mockReturnValue(new Promise(() => {}))
      const deps = makeDeps(classify as any)
      const handle = startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
        classifierMode: ClassifierMode.LogisticRegression,
        enableFixSession: true,
      })
      expect(handle.getTimeoutFallback()).toBeUndefined()
    })

    it('returns undefined when LR said general (no fix signal)', async () => {
      const classify = vi.fn().mockImplementation((_prompt: string, context: any) => {
        context?.onClassifierResult?.(lrGeneralResult(85))
        return new Promise(() => {}) // Haiku never resolves
      })
      const deps = makeDeps(classify as any)
      deps.sessionStore.activateFixSession('s')
      const handle = startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
        classifierMode: ClassifierMode.LogisticRegression,
        enableFixSession: true,
      })
      // Allow microtask to fire onClassifierResult
      await Promise.resolve()
      expect(handle.getTimeoutFallback()).toBeUndefined()
    })

    it('returns undefined when LR said fix but no fix session is active', async () => {
      const classify = vi.fn().mockImplementation((_prompt: string, context: any) => {
        context?.onClassifierResult?.(lrFixResult(75))
        return new Promise(() => {})
      })
      const deps = makeDeps(classify as any)
      const handle = startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
        classifierMode: ClassifierMode.LogisticRegression,
        enableFixSession: true,
      })
      await Promise.resolve()
      expect(handle.getTimeoutFallback()).toBeUndefined()
    })

    it('returns fix outcome when LR said fix AND fix session is active', async () => {
      const classify = vi.fn().mockImplementation((_prompt: string, context: any) => {
        context?.onClassifierResult?.(lrFixResult(75))
        return new Promise(() => {})
      })
      const deps = makeDeps(classify as any)
      deps.sessionStore.activateFixSession('s')
      const handle = startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
        classifierMode: ClassifierMode.LogisticRegression,
        enableFixSession: true,
      })
      await Promise.resolve()
      const fallback = handle.getTimeoutFallback()
      expect(fallback).toBeDefined()
      expect(fallback!.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(fallback!.result?.confidence).toBe(75)
      expect(fallback!.reason).toBe(AssessmentReason.EmbeddingTimeoutFallback)
      expect(fallback!.completedInTime).toBe(false)
      expect(fallback!.overrideApplied).toBe(true)
      expect(fallback!.appliedBudget).toBe('airo-builder:fix-task')
    })

    it('does not apply override when LR fix confidence is below threshold', async () => {
      const classify = vi.fn().mockImplementation((_prompt: string, context: any) => {
        context?.onClassifierResult?.(lrFixResult(50))
        return new Promise(() => {})
      })
      const deps = makeDeps(classify as any)
      deps.sessionStore.activateFixSession('s')
      const handle = startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
        classifierMode: ClassifierMode.LogisticRegression,
        enableFixSession: true,
      })
      await Promise.resolve()
      const fallback = handle.getTimeoutFallback()
      expect(fallback).toBeDefined()
      expect(fallback!.result?.taskType).toBe(AssessmentTaskType.Fix)
      expect(fallback!.overrideApplied).toBe(false)
      expect(fallback!.appliedBudget).toBeUndefined()
    })

    it('returns undefined when enableFixSession is false even with active session', async () => {
      const classify = vi.fn().mockImplementation((_prompt: string, context: any) => {
        context?.onClassifierResult?.(lrFixResult(75))
        return new Promise(() => {})
      })
      const deps = makeDeps(classify as any)
      deps.sessionStore.activateFixSession('s')
      const handle = startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
        classifierMode: ClassifierMode.LogisticRegression,
        enableFixSession: false,
      })
      await Promise.resolve()
      expect(handle.getTimeoutFallback()).toBeUndefined()
    })
  })

  describe('onClassifierResult callback', () => {
    it('passes onClassifierResult to the classify call', async () => {
      let receivedContext: any
      const classify = vi.fn().mockImplementation((_prompt: string, context: any) => {
        receivedContext = context
        return Promise.resolve(makeOutcome('fix'))
      })
      const deps = makeDeps(classify as any)
      startParallelAssessment(deps, {
        appId: 'a', sessionKey: 's', message: 'hi',
        isInitialPrompt: false, enableAssessmentAgent: true, enableAssessmentOverride: false,
        classifierMode: ClassifierMode.LogisticRegression,
      })
      await Promise.resolve()
      expect(receivedContext.onClassifierResult).toBeTypeOf('function')
    })
  })
})

describe('isOverrideApplicable', () => {
  it('returns true when overrideApplied + appliedBudget + enableAssessmentOverride', () => {
    const outcome = { overrideApplied: true, appliedBudget: 'airo-builder:fix-task' } as AssessmentOutcome
    expect(isOverrideApplicable(outcome, true)).toBe(true)
  })

  it('returns false when enableAssessmentOverride is false', () => {
    const outcome = { overrideApplied: true, appliedBudget: 'airo-builder:fix-task' } as AssessmentOutcome
    expect(isOverrideApplicable(outcome, false)).toBe(false)
  })

  it('returns false when overrideApplied is false', () => {
    const outcome = { overrideApplied: false, appliedBudget: 'airo-builder:fix-task' } as AssessmentOutcome
    expect(isOverrideApplicable(outcome, true)).toBe(false)
  })

  it('returns false when appliedBudget is undefined', () => {
    const outcome = { overrideApplied: true } as AssessmentOutcome
    expect(isOverrideApplicable(outcome, true)).toBe(false)
  })

  it('returns false when outcome is undefined', () => {
    expect(isOverrideApplicable(undefined, true)).toBe(false)
  })
})
