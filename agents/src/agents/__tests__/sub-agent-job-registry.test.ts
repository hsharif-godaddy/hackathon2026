import { describe, it, expect } from 'vitest'
import { SubAgentJobRegistry } from '../sub-agent-job-registry.js'
import type { SubAgentResult } from '../sub-agent-runner.js'

function ok(summary: string): SubAgentResult {
  return { summary, artifacts: [], status: 'success' }
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

describe('SubAgentJobRegistry dispatch', () => {
  it('returns a jobId synchronously and starts in running state', () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const jobId = reg.dispatch({ agent: 'builder', title: 'Home' }, async () => ok('done'))
    expect(typeof jobId).toBe('string')
    const snap = reg.snapshot().find(j => j.jobId === jobId)
    expect(snap?.status).toBe('running')
  })

  it('await resolves to a structured success result', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const jobId = reg.dispatch({ agent: 'builder', title: 'Home' }, async () => ok('built home'))
    const [res] = await reg.await([jobId])
    expect(res).toMatchObject({ jobId, agent: 'builder', status: 'success', summary: 'built home' })
  })

  it('runs two dispatched jobs concurrently (no blocking between dispatches)', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const a = deferred<void>()
    const b = deferred<void>()
    let aStarted = false
    let bStarted = false
    const ja = reg.dispatch({ agent: 'builder', title: 'A' }, async () => { aStarted = true; await a.promise; return ok('a') })
    const jb = reg.dispatch({ agent: 'builder', title: 'B' }, async () => { bStarted = true; await b.promise; return ok('b') })
    expect(aStarted && bStarted).toBe(true)
    a.resolve(); b.resolve()
    const results = await reg.await([ja, jb])
    expect(results.map(r => r.status)).toEqual(['success', 'success'])
  })

  it('await on a thrown run fn returns a structured error (does not reject)', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const jobId = reg.dispatch({ agent: 'design', title: 'D' }, async () => { throw new Error('boom') })
    const [res] = await reg.await([jobId])
    expect(res.status).toBe('error')
    expect(res.error).toBe('boom')
  })

  it('await on an unknown jobId returns a structured error', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const [res] = await reg.await(['nope'])
    expect(res.status).toBe('error')
    expect(res.error).toContain('nope')
  })

  it('envelope carries durationMs', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const jobId = reg.dispatch({ agent: 'builder', title: 'Home' }, async () => ok('done'))
    const [res] = await reg.await([jobId])
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('threads usage from the run result onto the envelope', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const usage = { modelName: 'm', inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 0, cacheWriteInputTokens: 0, steps: 2 }
    const jobId = reg.dispatch({ agent: 'builder', title: 'Home' }, async () => ({ summary: 'd', artifacts: [], status: 'success', usage } as SubAgentResult))
    const [res] = await reg.await([jobId])
    expect(res.usage).toEqual(usage)
  })

  it('threads structuredOutput from the run result onto the envelope', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const structuredOutput = { verdict: 'pass', score: 9 }
    const jobId = reg.dispatch({ agent: 'plan-review', title: 'Review' }, async () => ({ summary: 'd', artifacts: [], status: 'success', structuredOutput } as SubAgentResult))
    const [res] = await reg.await([jobId])
    expect(res.structuredOutput).toEqual(structuredOutput)
  })

  it('leaves structuredOutput absent on the envelope when the run did not produce one', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const jobId = reg.dispatch({ agent: 'builder', title: 'Home' }, async () => ok('done'))
    const [res] = await reg.await([jobId])
    expect(res.structuredOutput).toBeUndefined()
  })

  it('times out a hung job: aborts the worker and returns a timeout envelope (does not hang)', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4, taskTimeoutMs: 20 })
    let sawAbort = false
    const jobId = reg.dispatch({ agent: 'builder', title: 'slow' }, (signal) =>
      new Promise<SubAgentResult>((resolve) => {
        signal.addEventListener('abort', () => { sawAbort = true; resolve({ summary: 'stopped', artifacts: [], status: 'error' }) })
      }))
    const [res] = await reg.await([jobId])
    expect(res.status).toBe('timeout')
    expect(res.error).toContain('timed out')
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
    expect(sawAbort).toBe(true)
  })

  it('a run that settles just before its timeout is NOT relabeled timeout', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4, taskTimeoutMs: 10_000 })
    const jobId = reg.dispatch({ agent: 'builder', title: 'fast' }, async () => ok('quick'))
    const [res] = await reg.await([jobId])
    expect(res.status).toBe('success')
    expect(res.summary).toBe('quick')
  })

  it('frees the concurrency slot when a hung worker times out, so a queued job still runs', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 1, taskTimeoutMs: 20 })
    // A worker that never settles and ignores its abort signal: run() stays
    // pending forever, so its .finally never fires — only the timeout path can
    // free the slot. Without that, the queued job below never starts and await hangs.
    const hung = reg.dispatch({ agent: 'builder', title: 'hung' }, () => new Promise<SubAgentResult>(() => {}))
    const queued = reg.dispatch({ agent: 'builder', title: 'queued' }, async () => ok('ran'))
    const [hungRes, queuedRes] = await reg.await([hung, queued])
    expect(hungRes.status).toBe('timeout')
    expect(queuedRes.status).toBe('success')
    expect(queuedRes.summary).toBe('ran')
  })

  it('clamps an over-large taskTimeoutMs so the backstop does not fire instantly (setTimeout 32-bit overflow)', async () => {
    // A value above setTimeout's 2^31-1 ms limit clamps to 1ms and would time out
    // every job almost immediately. With the clamp, a ~15ms job (well under any
    // real timeout, well over the overflow's 1ms) must still complete as success.
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4, taskTimeoutMs: 3_000_000_000 })
    const jobId = reg.dispatch({ agent: 'builder', title: 'slow-ish' }, async () => {
      await new Promise<void>(r => { setTimeout(r, 15) })
      return ok('quick')
    })
    const [res] = await reg.await([jobId])
    expect(res.status).toBe('success')
    expect(res.summary).toBe('quick')
  })

  it('abortAll resolves queued (never-started) jobs so await does not hang', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 1 })
    const block = deferred<void>()
    const j1 = reg.dispatch({ agent: 'builder', title: '1' }, async () => { await block.promise; return ok('1') })
    const j2 = reg.dispatch({ agent: 'builder', title: '2' }, async () => ok('2')) // queued behind j1
    reg.abortAll()
    const [r2] = await reg.await([j2]) // must NOT hang
    expect(r2.status).toBe('aborted')
    block.resolve()
  })
})

describe('SubAgentJobRegistry concurrency + abort', () => {
  it('queues jobs past the cap and drains them as slots free', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 1 })
    const order: string[] = []
    const d1 = deferred<void>()
    const j1 = reg.dispatch({ agent: 'builder', title: '1' }, async () => { order.push('start1'); await d1.promise; return ok('1') })
    const j2 = reg.dispatch({ agent: 'builder', title: '2' }, async () => { order.push('start2'); return ok('2') })
    // cap=1 → job2 must be queued, not started, while job1 runs.
    expect(reg.snapshot().find(j => j.jobId === j2)?.status).toBe('queued')
    expect(order).toEqual(['start1'])
    d1.resolve()
    await reg.await([j1, j2])
    expect(order).toEqual(['start1', 'start2'])
  })

  it('abortAll marks running jobs aborted and the signal fires', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    let sawAbort = false
    const jobId = reg.dispatch({ agent: 'builder', title: 'X' }, (signal) =>
      new Promise<SubAgentResult>((_, reject) => {
        signal.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')) })
      }))
    reg.abortAll()
    const [res] = await reg.await([jobId])
    expect(sawAbort).toBe(true)
    expect(res.status).toBe('aborted')
  })

  it('abortAll on a worker that ignores its signal resolves as aborted (not timeout) without waiting for the backstop', async () => {
    // Long timeout: if abortAll relied on the backstop timer to resolve the job, the
    // await would either hang for ~10s or surface as 'timeout'. settleAborted must
    // resolve it promptly and classify a deliberate cancellation as 'aborted'.
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4, taskTimeoutMs: 10_000 })
    const started = deferred<void>()
    const jobId = reg.dispatch({ agent: 'builder', title: 'stubborn' }, () => {
      started.resolve()
      return new Promise<SubAgentResult>(() => {}) // never settles, ignores abort
    })
    await started.promise
    reg.abortAll()
    const [res] = await reg.await([jobId])
    expect(res.status).toBe('aborted')
  })

  it('reports aborted even when the run fn RESOLVES with error after abort (runner swallows AbortError)', async () => {
    // The real SubAgentRunner catches AbortError and returns { status: 'error' };
    // the registry must still classify a signalled abort as 'aborted', not 'error'.
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const started = deferred<void>()
    const jobId = reg.dispatch({ agent: 'builder', title: 'X' }, (signal) =>
      new Promise<SubAgentResult>((resolve) => {
        started.resolve()
        signal.addEventListener('abort', () =>
          resolve({ summary: 'aborted by user', artifacts: [], status: 'error' }))
      }))
    await started.promise
    reg.abortAll()
    const [res] = await reg.await([jobId])
    expect(res.status).toBe('aborted')
  })
})

describe('SubAgentJobRegistry re-entry sessions', () => {
  function withSession(summary: string, agent: string): SubAgentResult {
    return {
      summary, artifacts: [], status: 'success',
      _session: { messages: [], filesRead: [], filesWritten: [] },
      _sessionAgent: agent,
    }
  }

  it('sessionJobIdsByAgent lists cached sessions for an agent (ambiguity detection)', async () => {
    const reg = new SubAgentJobRegistry({ maxConcurrent: 4 })
    const j1 = reg.dispatch({ agent: 'builder', title: '1' }, async () => withSession('a', 'builder'))
    const j2 = reg.dispatch({ agent: 'builder', title: '2' }, async () => withSession('b', 'builder'))
    const j3 = reg.dispatch({ agent: 'design', title: '3' }, async () => withSession('c', 'design'))
    await reg.await([j1, j2, j3])
    expect(reg.sessionJobIdsByAgent('builder').sort()).toEqual([j1, j2].sort())
    expect(reg.sessionJobIdsByAgent('design')).toEqual([j3])
    expect(reg.sessionJobIdsByAgent('media')).toEqual([])
  })
})
