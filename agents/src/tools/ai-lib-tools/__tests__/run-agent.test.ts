import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

const runnerMock = vi.hoisted(() => ({
  execute: vi.fn(),
}))

// Stub the runner so the test doesn't hit a real model.
vi.mock('../../../agents/sub-agent-runner.js', () => {
  return {
    SubAgentRunner: class {
      async execute(...args: unknown[]) {
        return runnerMock.execute(...args)
      }
    },
    buildContinuationMessage: (task: string) => task,
  }
})
vi.mock('../../../agents/sub-agents/index.js', () => ({
  getSubAgentConfig: async () => ({ id: 'builder', name: 'Builder', system: '', tools: {}, model: 'm', maxSteps: 1 }),
}))

import { runAgentAITool, awaitAgentsAITool } from '../run-agent.js'

const ctx = { metadata: { appPath: '/tmp/app', conversationId: 'conv-test', appId: 'app1' } }

describe('runAgent (non-blocking) + awaitAgents', () => {
  beforeEach(() => {
    runnerMock.execute.mockImplementation(async () => ({ summary: 'built', artifacts: ['index.html'], status: 'success' }))
  })

  afterEach(() => {
    vi.useRealTimers()
    runnerMock.execute.mockReset()
  })

  it('returns a jobId immediately without the sub-agent result', async () => {
    const out = await runAgentAITool.execute!(
      { agent: 'builder', title: 'Home', task: 'build', inputs: {}, mode: 'background' },
      { experimental_context: ctx } as never
    ) as Record<string, unknown>
    expect(out.jobId).toMatch(/^job_/)
    expect(out.status).toBe('running')
    expect(out.summary).toBeUndefined()
  })

  it('awaitAgents returns the structured result for that job', async () => {
    const disp = await runAgentAITool.execute!(
      { agent: 'builder', title: 'Home', task: 'build', inputs: {}, mode: 'background' },
      { experimental_context: ctx } as never
    ) as Record<string, unknown>
    const out = await awaitAgentsAITool.execute!(
      { jobIds: [disp.jobId as string] },
      { experimental_context: ctx } as never
    ) as { results: Array<Record<string, unknown>> }
    expect(out.results[0]).toMatchObject({ jobId: disp.jobId, status: 'success', summary: 'built' })
  })

  it('emits timeout details instead of late runner outputs after a timeout', async () => {
    vi.useFakeTimers()
    const emitted: Array<{ type: string; data: { event?: string; detail?: string } }> = []
    const eventEmitter = {
      emit: (type: string, data: { event?: string; detail?: string }) => {
        emitted.push({ type, data })
      },
    }
    const timeoutCtx = {
      metadata: {
        appPath: '/tmp/app',
        conversationId: 'conv-timeout',
        appId: 'app1',
        toolId: 'tool-timeout',
        eventEmitter,
      },
    }

    runnerMock.execute.mockImplementationOnce(async (...args: unknown[]) => {
      const signal = args[4] as AbortSignal
      return new Promise(resolve => {
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            resolve({
              summary: 'late success',
              artifacts: ['late.html'],
              visualOutputs: [{ type: 'page', label: 'Late page', url: '/late' }],
              status: 'success',
            })
          }, 0)
        }, { once: true })
      })
    })

    const disp = await runAgentAITool.execute!(
      { agent: 'builder', title: 'Home', task: 'build', inputs: {}, mode: 'background' },
      { experimental_context: timeoutCtx } as never
    ) as Record<string, unknown>
    const awaited = awaitAgentsAITool.execute!(
      { jobIds: [disp.jobId as string] },
      { experimental_context: timeoutCtx } as never
    ) as Promise<{ results: Array<Record<string, unknown>> }>

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    const out = await awaited
    // The backstop aborted the worker, whose late resolve is scheduled via a
    // setTimeout(0) in the mock; drain all pending timers so the run closure
    // resumes and emits its outputs event before we assert on it.
    await vi.runAllTimersAsync()

    expect(out.results[0]).toMatchObject({
      jobId: disp.jobId,
      status: 'timeout',
      summary: 'Sub-agent timed out after 900000ms',
      error: 'Sub-agent timed out after 900000ms',
      artifacts: [],
    })

    const outputsEvent = emitted.find(e => e.type === 'subagent_event' && e.data.event === 'outputs')
    expect(outputsEvent).toBeDefined()
    expect(JSON.parse(outputsEvent!.data.detail!)).toEqual({
      status: 'timeout',
      summary: 'Sub-agent timed out after 900000ms',
      artifacts: [],
      visualOutputs: [],
    })
  })
})
