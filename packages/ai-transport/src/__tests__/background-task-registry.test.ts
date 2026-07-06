import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BackgroundTaskRegistry, type BackgroundTaskOutcome } from '../background-task-registry.js'

function createDeferred(): { promise: Promise<BackgroundTaskOutcome>; resolve: (v: BackgroundTaskOutcome) => void; reject: (e: Error) => void } {
  let resolve!: (v: BackgroundTaskOutcome) => void
  let reject!: (e: Error) => void
  const promise: Promise<BackgroundTaskOutcome> = new Promise<BackgroundTaskOutcome>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('BackgroundTaskRegistry', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  describe('register + hasPending', () => {
    it('tracks registered tasks as pending', () => {
      const registry = new BackgroundTaskRegistry()
      const { promise } = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: promise, timeoutMs: 240_000 })
      expect(registry.hasPending()).toBe(true)
      expect(registry.size).toBe(1)
    })

    it('returns false when no tasks registered', () => {
      const registry = new BackgroundTaskRegistry()
      expect(registry.hasPending()).toBe(false)
    })
  })

  describe('drain', () => {
    it('returns settled outcomes and removes them from registry', async () => {
      const registry = new BackgroundTaskRegistry()
      const outcome: BackgroundTaskOutcome = { status: 'completed', taskId: 'job-1', toolName: 'generate_logo', result: { slots: ['a'] } }
      const resolved: Promise<BackgroundTaskOutcome> = Promise.resolve(outcome)
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: resolved, timeoutMs: 240_000 })

      await vi.advanceTimersByTimeAsync(0)

      const drained: BackgroundTaskOutcome[] = registry.drain()
      expect(drained).toEqual([outcome])
      expect(registry.size).toBe(0)
      expect(registry.hasPending()).toBe(false)
    })

    it('returns empty array when nothing settled', () => {
      const registry = new BackgroundTaskRegistry()
      const { promise } = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: promise, timeoutMs: 240_000 })

      const drained: BackgroundTaskOutcome[] = registry.drain()
      expect(drained).toEqual([])
      expect(registry.size).toBe(1)
    })

    it('handles promise rejection as failed outcome', async () => {
      const registry = new BackgroundTaskRegistry()
      const rejected: Promise<BackgroundTaskOutcome> = Promise.reject(new Error('API down'))
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: rejected, timeoutMs: 240_000 })

      await vi.advanceTimersByTimeAsync(0)

      const drained: BackgroundTaskOutcome[] = registry.drain()
      expect(drained).toHaveLength(1)
      expect(drained[0]!.status).toBe('failed')
      expect(drained[0]!.error).toBe('API down')
      expect(drained[0]!.taskId).toBe('job-1')
    })
  })

  describe('awaitNext', () => {
    it('resolves when a task settles before its timeout', async () => {
      const registry = new BackgroundTaskRegistry()
      const { promise, resolve } = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: promise, timeoutMs: 240_000 })

      const awaitPromise: Promise<BackgroundTaskOutcome[]> = registry.awaitNext()

      const outcome: BackgroundTaskOutcome = { status: 'completed', taskId: 'job-1', toolName: 'generate_logo' }
      resolve(outcome)

      const results: BackgroundTaskOutcome[] = await awaitPromise
      expect(results).toHaveLength(1)
      expect(results[0]!.status).toBe('completed')
      expect(results[0]!.taskId).toBe('job-1')
    })

    it('expires task at its per-task timeout', async () => {
      const registry = new BackgroundTaskRegistry()
      const { promise } = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: promise, timeoutMs: 5000 })

      const awaitPromise: Promise<BackgroundTaskOutcome[]> = registry.awaitNext()
      await vi.advanceTimersByTimeAsync(5000)

      const results: BackgroundTaskOutcome[] = await awaitPromise
      expect(results).toHaveLength(1)
      expect(results[0]!.status).toBe('timeout')
      expect(results[0]!.taskId).toBe('job-1')
      expect(registry.hasPending()).toBe(false)
    })

    it('returns empty array when no pending tasks', async () => {
      const registry = new BackgroundTaskRegistry()
      const results: BackgroundTaskOutcome[] = await registry.awaitNext()
      expect(results).toEqual([])
    })

    it('respects different timeouts per task', async () => {
      const registry = new BackgroundTaskRegistry()
      const d1 = createDeferred()
      const d2 = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'fast_tool', done: d1.promise, timeoutMs: 2000 })
      registry.register({ taskId: 'job-2', toolName: 'slow_tool', done: d2.promise, timeoutMs: 60_000 })

      const firstPromise: Promise<BackgroundTaskOutcome[]> = registry.awaitNext()
      await vi.advanceTimersByTimeAsync(2000)

      const first: BackgroundTaskOutcome[] = await firstPromise
      expect(first).toHaveLength(1)
      expect(first[0]!.taskId).toBe('job-1')
      expect(first[0]!.status).toBe('timeout')

      expect(registry.hasPending()).toBe(true)
    })

    it('returns all outcomes when multiple tasks settle in the same tick', async () => {
      const registry = new BackgroundTaskRegistry()
      const d1 = createDeferred()
      const d2 = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: d1.promise, timeoutMs: 240_000 })
      registry.register({ taskId: 'job-2', toolName: 'edit_logo', done: d2.promise, timeoutMs: 240_000 })

      const awaitPromise: Promise<BackgroundTaskOutcome[]> = registry.awaitNext()

      // Resolve both in the same microtask
      d1.resolve({ status: 'completed', taskId: 'job-1', toolName: 'generate_logo' })
      d2.resolve({ status: 'completed', taskId: 'job-2', toolName: 'edit_logo' })

      await vi.advanceTimersByTimeAsync(0)

      const results: BackgroundTaskOutcome[] = await awaitPromise
      expect(results).toHaveLength(2)
      const ids: string[] = results.map((r: BackgroundTaskOutcome) => r.taskId).sort()
      expect(ids).toEqual(['job-1', 'job-2'])
      expect(registry.hasPending()).toBe(false)
    })

    it('handles rejecting done promise without throwing', async () => {
      const registry = new BackgroundTaskRegistry()
      const rejected: Promise<BackgroundTaskOutcome> = Promise.reject(new Error('Unexpected crash'))
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: rejected, timeoutMs: 240_000 })

      await vi.advanceTimersByTimeAsync(0)

      const results: BackgroundTaskOutcome[] = await registry.awaitNext()
      expect(results).toHaveLength(1)
      expect(results[0]!.status).toBe('failed')
      expect(results[0]!.error).toBe('Unexpected crash')
    })
  })

  describe('awaitAll', () => {
    it('resolves all tasks', async () => {
      const registry = new BackgroundTaskRegistry()
      const d1 = createDeferred()
      const d2 = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: d1.promise, timeoutMs: 240_000 })
      registry.register({ taskId: 'job-2', toolName: 'edit_logo', done: d2.promise, timeoutMs: 240_000 })

      const allPromise: Promise<BackgroundTaskOutcome[]> = registry.awaitAll()

      d1.resolve({ status: 'completed', taskId: 'job-1', toolName: 'generate_logo' })
      await vi.advanceTimersByTimeAsync(0)

      d2.resolve({ status: 'completed', taskId: 'job-2', toolName: 'edit_logo' })
      await vi.advanceTimersByTimeAsync(0)

      const results: BackgroundTaskOutcome[] = await allPromise
      expect(results).toHaveLength(2)
      expect(results.map((r: BackgroundTaskOutcome) => r.taskId).sort()).toEqual(['job-1', 'job-2'])
    })

    it('times out tasks at their individual deadlines', async () => {
      const registry = new BackgroundTaskRegistry()
      const d1 = createDeferred()
      const { promise: p2 } = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: d1.promise, timeoutMs: 240_000 })
      registry.register({ taskId: 'job-2', toolName: 'edit_logo', done: p2, timeoutMs: 5000 })

      const allPromise: Promise<BackgroundTaskOutcome[]> = registry.awaitAll()

      d1.resolve({ status: 'completed', taskId: 'job-1', toolName: 'generate_logo' })
      await vi.advanceTimersByTimeAsync(0)

      await vi.advanceTimersByTimeAsync(5000)

      const results: BackgroundTaskOutcome[] = await allPromise
      expect(results).toHaveLength(2)

      const completed: BackgroundTaskOutcome | undefined = results.find((r: BackgroundTaskOutcome) => r.taskId === 'job-1')
      const timedOut: BackgroundTaskOutcome | undefined = results.find((r: BackgroundTaskOutcome) => r.taskId === 'job-2')
      expect(completed!.status).toBe('completed')
      expect(timedOut!.status).toBe('timeout')
    })

    it('returns empty array when no tasks', async () => {
      const registry = new BackgroundTaskRegistry()
      const results: BackgroundTaskOutcome[] = await registry.awaitAll()
      expect(results).toEqual([])
    })

    it('does not lose outcomes when multiple tasks settle simultaneously', async () => {
      const registry = new BackgroundTaskRegistry()
      const d1 = createDeferred()
      const d2 = createDeferred()
      const d3 = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'a', done: d1.promise, timeoutMs: 240_000 })
      registry.register({ taskId: 'job-2', toolName: 'b', done: d2.promise, timeoutMs: 240_000 })
      registry.register({ taskId: 'job-3', toolName: 'c', done: d3.promise, timeoutMs: 240_000 })

      const allPromise: Promise<BackgroundTaskOutcome[]> = registry.awaitAll()

      // All three settle in the same tick
      d1.resolve({ status: 'completed', taskId: 'job-1', toolName: 'a' })
      d2.resolve({ status: 'completed', taskId: 'job-2', toolName: 'b' })
      d3.resolve({ status: 'failed', taskId: 'job-3', toolName: 'c', error: 'oops' })

      await vi.advanceTimersByTimeAsync(0)

      const results: BackgroundTaskOutcome[] = await allPromise
      expect(results).toHaveLength(3)
      expect(results.map((r: BackgroundTaskOutcome) => r.taskId).sort()).toEqual(['job-1', 'job-2', 'job-3'])
    })
  })

  describe('mixed settled and pending', () => {
    it('drain returns only settled, leaves pending', async () => {
      const registry = new BackgroundTaskRegistry()
      const resolved: Promise<BackgroundTaskOutcome> = Promise.resolve({ status: 'completed', taskId: 'job-1', toolName: 'a' })
      const { promise } = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'a', done: resolved, timeoutMs: 240_000 })
      registry.register({ taskId: 'job-2', toolName: 'b', done: promise, timeoutMs: 240_000 })

      await vi.advanceTimersByTimeAsync(0)

      const drained: BackgroundTaskOutcome[] = registry.drain()
      expect(drained).toHaveLength(1)
      expect(drained[0]!.taskId).toBe('job-1')
      expect(registry.hasPending()).toBe(true)
      expect(registry.size).toBe(1)
    })

    it('awaitNext resolves immediately when one task already settled (does not wait for pending timeout)', async () => {
      const registry = new BackgroundTaskRegistry()
      const resolved: Promise<BackgroundTaskOutcome> = Promise.resolve({ status: 'completed', taskId: 'job-1', toolName: 'a' })
      const { promise } = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'a', done: resolved, timeoutMs: 240_000 })
      registry.register({ taskId: 'job-2', toolName: 'b', done: promise, timeoutMs: 60_000 })

      await vi.advanceTimersByTimeAsync(0)

      // Do NOT drain first — awaitNext races settled+pending internally.
      // The settled task's normalized promise resolves immediately in the race,
      // then awaitNext drains and returns it without waiting for job-2's 60s timeout.
      const results: BackgroundTaskOutcome[] = await registry.awaitNext()
      expect(results).toHaveLength(1)
      expect(results[0]!.taskId).toBe('job-1')
      expect(registry.hasPending()).toBe(true)
    })
  })

  describe('consumer pattern (postStreamValidate simulation)', () => {
    it('fast-settled task is surfaced even when hasPending is false', async () => {
      // Simulates: tool registers a promise that resolves before postStreamValidate runs
      const registry = new BackgroundTaskRegistry()
      const fast: Promise<BackgroundTaskOutcome> = Promise.resolve({ status: 'failed', taskId: 'job-1', toolName: 'generate_logo', error: 'Policy rejection' })
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: fast, timeoutMs: 240_000 })

      await vi.advanceTimersByTimeAsync(0)

      // Phase 1: drain settled
      const backgroundOutcomes: BackgroundTaskOutcome[] = []
      const earlySettled: BackgroundTaskOutcome[] = registry.drain()
      backgroundOutcomes.push(...earlySettled)

      // After drain, nothing pending — the old bug returned here and dropped outcomes
      expect(registry.hasPending()).toBe(false)

      // Phase 2: blocking wait (guarded on hasPending)
      if (registry.hasPending()) {
        while (registry.hasPending()) {
          const outcomes: BackgroundTaskOutcome[] = await registry.awaitNext()
          if (outcomes.length === 0) break
          backgroundOutcomes.push(...outcomes)
        }
        backgroundOutcomes.push(...registry.drain())
      }

      // The fast failure must still be surfaced
      expect(backgroundOutcomes).toHaveLength(1)
      expect(backgroundOutcomes[0]!.status).toBe('failed')
      expect(backgroundOutcomes[0]!.error).toBe('Policy rejection')
    })

    it('flag-off path: empty registry produces no outcomes', async () => {
      // When the switchboard flag is off, no tasks are registered → inert
      const registry = new BackgroundTaskRegistry()

      const earlySettled: BackgroundTaskOutcome[] = registry.drain()
      expect(earlySettled).toEqual([])
      expect(registry.hasPending()).toBe(false)
    })

    it('stop-after tool skips background await but preserves drained outcomes for next turn', async () => {
      const registry = new BackgroundTaskRegistry()
      const d1 = createDeferred()
      registry.register({ taskId: 'job-1', toolName: 'generate_logo', done: d1.promise, timeoutMs: 240_000 })

      // Phase 1: drain (nothing settled yet)
      const backgroundOutcomes: BackgroundTaskOutcome[] = []
      backgroundOutcomes.push(...registry.drain())

      // Stop-after detected → would return early in real code
      const hitStopAfter = true
      if (hitStopAfter) {
        // Still pending — outcomes not lost, registry still tracks
        expect(registry.hasPending()).toBe(true)
        expect(registry.size).toBe(1)
      }

      // Simulate next turn: task settles between turns
      d1.resolve({ status: 'completed', taskId: 'job-1', toolName: 'generate_logo' })
      await vi.advanceTimersByTimeAsync(0)

      // Next turn's drain picks it up
      const nextTurnDrained: BackgroundTaskOutcome[] = registry.drain()
      expect(nextTurnDrained).toHaveLength(1)
      expect(nextTurnDrained[0]!.status).toBe('completed')
    })
  })
})
