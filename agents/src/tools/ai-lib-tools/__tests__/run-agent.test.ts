import { describe, it, expect, vi } from 'vitest'

// Stub the runner so the test doesn't hit a real model.
vi.mock('../../../agents/sub-agent-runner.js', () => {
  return {
    SubAgentRunner: class {
      async execute() {
        return { summary: 'built', artifacts: ['index.html'], status: 'success' }
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
})
