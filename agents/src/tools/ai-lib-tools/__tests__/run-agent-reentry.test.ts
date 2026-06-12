import { describe, it, expect, vi } from 'vitest'

const continueSpy = vi.fn(async () => ({ summary: 'tweaked', artifacts: [], status: 'success' }))
vi.mock('../../../agents/sub-agent-runner.js', () => ({
  SubAgentRunner: class {
    async execute() { return { summary: 'fresh', artifacts: [], status: 'success' } }
    continueExecution = continueSpy
  },
  buildContinuationMessage: (task: string) => task,
}))
vi.mock('../../../agents/sub-agents/index.js', () => ({
  getSubAgentConfig: async () => ({ id: 'design', name: 'Design', system: '', tools: {}, model: 'm', maxSteps: 1 }),
}))

import { runAgentAITool, awaitAgentsAITool } from '../run-agent.js'
import { subAgentJobRegistry } from '../../../agents/sub-agent-job-registry.js'

const ctx = { metadata: { appPath: '/tmp/app', conversationId: 'conv-reentry', appId: 'app1' } }

describe('runAgent re-entry', () => {
  it('falls back to a cold run when the referenced session is absent', async () => {
    const out = await (runAgentAITool as any).execute(
      { agent: 'design', title: 'Tweak', task: 'fix contrast', inputs: {}, mode: 'background', continue: true, fromJobId: 'job_missing' },
      { experimental_context: ctx } as never
    )
    const joined = await (awaitAgentsAITool as any).execute({ jobIds: [out.jobId] }, { experimental_context: ctx } as never)
    expect(joined.results[0].status).toBe('success')
    expect(continueSpy).not.toHaveBeenCalled()
  })

  it('uses continueExecution when a cached session exists for fromJobId', async () => {
    const reg = subAgentJobRegistry.get('conv-reentry')
    ;(reg as any).sessions.set('job_seed', {
      agent: 'design', messages: [{ role: 'user', content: [{ type: 'text', text: 'orig' }] }],
      filesRead: [], filesWritten: [], lastUsed: Date.now(),
    })
    const out = await (runAgentAITool as any).execute(
      { agent: 'design', title: 'Tweak', task: 'fix contrast', inputs: {}, mode: 'background', continue: true, fromJobId: 'job_seed' },
      { experimental_context: ctx } as never
    )
    await (awaitAgentsAITool as any).execute({ jobIds: [out.jobId] }, { experimental_context: ctx } as never)
    expect(continueSpy).toHaveBeenCalledTimes(1)
  })
})
