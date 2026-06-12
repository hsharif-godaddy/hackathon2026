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
