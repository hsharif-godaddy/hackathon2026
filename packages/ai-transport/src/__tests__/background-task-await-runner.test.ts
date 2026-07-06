import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BackgroundTaskRegistry, type BackgroundTaskOutcome } from '../background-task-registry.js'
import { runBackgroundTaskAwait, formatBackgroundTaskOutcomes } from '../background-task-await-runner.js'

function createDeferred(): { promise: Promise<BackgroundTaskOutcome>; resolve: (v: BackgroundTaskOutcome) => void; reject: (e: Error) => void } {
  let resolve!: (v: BackgroundTaskOutcome) => void
  let reject!: (e: Error) => void
  const promise: Promise<BackgroundTaskOutcome> = new Promise<BackgroundTaskOutcome>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mockLogger(): { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn() }
}

describe('runBackgroundTaskAwait', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns null when registry is empty (flag-off path)', async () => {
    const registry = new BackgroundTaskRegistry()
    const logger = mockLogger()

    const result = await runBackgroundTaskAwait({
      registry,
      toolCalls: [{ toolName: 'generate_logo' }],
      stopAfterTools: undefined,
      abortSignal: new AbortController().signal,
      logger,
    })

    expect(result).toBeNull()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('surfaces fast-settled outcome without blocking (critical: no runaway loop)', async () => {
    const registry = new BackgroundTaskRegistry()
    const fast: Promise<BackgroundTaskOutcome> = Promise.resolve({
      status: 'failed', taskId: 'job-1', toolName: 'generate_logo', error: 'Policy rejection',
    })
    registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: fast, timeoutMs: 240_000 })
    await vi.advanceTimersByTimeAsync(0)

    const logger = mockLogger()
    const result = await runBackgroundTaskAwait({
      registry,
      toolCalls: [{ toolName: 'generate_logo' }],
      stopAfterTools: undefined,
      abortSignal: new AbortController().signal,
      logger,
    })

    expect(result).not.toBeNull()
    expect(result!.outcomes).toHaveLength(1)
    expect(result!.outcomes[0]!.status).toBe('failed')
    expect(result!.continuationPrompt).toContain('FAILED')
    expect(result!.continuationPrompt).toContain('Policy rejection')
    expect(logger.info).toHaveBeenCalledWith('sse.background_tasks.awaited', expect.objectContaining({ taskCount: 1 }))
  })

  it('does not accumulate across calls (prevents runaway auto-continuation)', async () => {
    const registry = new BackgroundTaskRegistry()
    const fast: Promise<BackgroundTaskOutcome> = Promise.resolve({
      status: 'completed', taskId: 'job-1', toolName: 'generate_logo',
    })
    registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: fast, timeoutMs: 240_000 })
    await vi.advanceTimersByTimeAsync(0)

    const logger = mockLogger()
    const params = {
      registry,
      toolCalls: [{ toolName: 'generate_logo' }],
      stopAfterTools: undefined,
      abortSignal: new AbortController().signal,
      logger,
    }

    // First call: surfaces the outcome
    const first = await runBackgroundTaskAwait(params)
    expect(first).not.toBeNull()
    expect(first!.outcomes).toHaveLength(1)

    // Second call (next iteration): registry is empty → null
    const second = await runBackgroundTaskAwait(params)
    expect(second).toBeNull()
  })

  it('blocks for pending tasks then surfaces outcomes', async () => {
    const registry = new BackgroundTaskRegistry()
    const d = createDeferred()
    registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: d.promise, timeoutMs: 240_000 })

    const logger = mockLogger()
    const resultPromise = runBackgroundTaskAwait({
      registry,
      toolCalls: [{ toolName: 'generate_logo' }],
      stopAfterTools: undefined,
      abortSignal: new AbortController().signal,
      logger,
    })

    d.resolve({ status: 'completed', taskId: 'job-1', toolName: 'generate_logo', result: { slots: ['a'] } })
    await vi.advanceTimersByTimeAsync(0)

    const result = await resultPromise
    expect(result).not.toBeNull()
    expect(result!.outcomes).toHaveLength(1)
    expect(result!.outcomes[0]!.status).toBe('completed')
  })

  it('stop-after turn: logs settled outcomes but returns null (stop-after wins)', async () => {
    const registry = new BackgroundTaskRegistry()
    const fast: Promise<BackgroundTaskOutcome> = Promise.resolve({
      status: 'failed', taskId: 'job-1', toolName: 'generate_logo', error: 'Budget exhausted',
    })
    registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: fast, timeoutMs: 240_000 })
    await vi.advanceTimersByTimeAsync(0)

    const logger = mockLogger()
    const result = await runBackgroundTaskAwait({
      registry,
      toolCalls: [{ toolName: 'suggestedResponse' }],
      stopAfterTools: ['suggestedResponse', 'handoff'],
      abortSignal: new AbortController().signal,
      logger,
    })

    // Stop-after wins: no continuation, no __autoContinue
    expect(result).toBeNull()
    // Outcomes logged for observability
    expect(logger.info).toHaveBeenCalledWith('sse.background_tasks.stop_after_dropped', expect.objectContaining({ taskCount: 1 }))
  })

  it('skips blocking await on stop-after but returns null when nothing settled', async () => {
    const registry = new BackgroundTaskRegistry()
    const { promise } = createDeferred()
    registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: promise, timeoutMs: 240_000 })

    const logger = mockLogger()
    const result = await runBackgroundTaskAwait({
      registry,
      toolCalls: [{ toolName: 'handoff' }],
      stopAfterTools: ['suggestedResponse', 'handoff'],
      abortSignal: new AbortController().signal,
      logger,
    })

    // Pending task not blocked on — still in registry for next turn
    expect(result).toBeNull()
    expect(registry.hasPending()).toBe(true)
  })

  it('respects pre-aborted signal (does not block)', async () => {
    const registry = new BackgroundTaskRegistry()
    const { promise } = createDeferred()
    registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: promise, timeoutMs: 240_000 })

    const controller = new AbortController()
    controller.abort()

    const logger = mockLogger()
    const result = await runBackgroundTaskAwait({
      registry,
      toolCalls: [{ toolName: 'generate_logo' }],
      stopAfterTools: undefined,
      abortSignal: controller.signal,
      logger,
    })

    // Pre-aborted: nothing awaited, nothing settled → null
    expect(result).toBeNull()
    // Task still in registry (not lost)
    expect(registry.hasPending()).toBe(true)
  })

  it('passes logContext to logger', async () => {
    const registry = new BackgroundTaskRegistry()
    const fast: Promise<BackgroundTaskOutcome> = Promise.resolve({
      status: 'completed', taskId: 'job-1', toolName: 'generate_logo',
    })
    registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: fast, timeoutMs: 240_000 })
    await vi.advanceTimersByTimeAsync(0)

    const logger = mockLogger()
    await runBackgroundTaskAwait({
      registry,
      toolCalls: [],
      stopAfterTools: undefined,
      abortSignal: new AbortController().signal,
      logger,
      logContext: { appId: 'app-1', conversationId: 'conv-1' },
    })

    expect(logger.info).toHaveBeenCalledWith('sse.background_tasks.awaited', expect.objectContaining({
      appId: 'app-1', conversationId: 'conv-1',
    }))
  })
})

describe('formatBackgroundTaskOutcomes', () => {
  it('formats completed outcome', () => {
    const result: string = formatBackgroundTaskOutcomes([
      { status: 'completed', taskId: 'job-1', toolName: 'generate_logo', result: { slots: ['a'] } },
    ])
    expect(result).toContain('[System: Background tasks settled]')
    expect(result).toContain('generate_logo (job-1): completed.')
    expect(result).toContain('slots')
  })

  it('formats failed outcome', () => {
    const result: string = formatBackgroundTaskOutcomes([
      { status: 'failed', taskId: 'job-1', toolName: 'generate_logo', error: 'API error' },
    ])
    expect(result).toContain('FAILED')
    expect(result).toContain('API error')
  })

  it('formats timeout outcome', () => {
    const result: string = formatBackgroundTaskOutcomes([
      { status: 'timeout', taskId: 'job-1', toolName: 'generate_logo', error: 'Timed out after 240000ms' },
    ])
    expect(result).toContain('TIMED OUT')
  })

  it('formats multiple outcomes', () => {
    const result: string = formatBackgroundTaskOutcomes([
      { status: 'completed', taskId: 'job-1', toolName: 'generate_logo' },
      { status: 'failed', taskId: 'job-2', toolName: 'edit_logo', error: 'oops' },
    ])
    const lines: string[] = result.split('\n')
    expect(lines).toHaveLength(3)
  })
})
