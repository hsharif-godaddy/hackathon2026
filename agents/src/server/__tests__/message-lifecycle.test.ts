import { describe, it, expect, vi } from 'vitest'

import {
  LifecycleSessionStore,
  startParallelAssessment,
} from '../message-lifecycle.js'
import type { AssessmentAgent, AssessmentOutcome } from '../../agents/assessment-agent/index.js'

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
})
