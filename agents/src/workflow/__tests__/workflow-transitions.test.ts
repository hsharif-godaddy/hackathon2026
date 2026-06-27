import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleToolCompletion } from '../workflow-transitions.js'
import type { WorkflowState } from '../types.js'

vi.mock('../workflow-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workflow-store.js')>()
  return {
    readWorkflowState: vi.fn(),
    writeWorkflowState: vi.fn().mockResolvedValue(true),
    withWorkflowLock: vi.fn().mockImplementation((_appId: string, fn: () => Promise<unknown>) => fn()),
    areDepsResolved: actual.areDepsResolved,
  }
})

vi.mock('../verify-runner.js', () => ({
  runVerifyChecks: vi.fn().mockResolvedValue({ passed: true, failures: [] }),
}))

vi.mock('../../logging/index.js', () => ({
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

const { readWorkflowState, writeWorkflowState } = await import('../workflow-store.js')
const { runVerifyChecks } = await import('../verify-runner.js')

const mockRead = vi.mocked(readWorkflowState)
const mockWrite = vi.mocked(writeWorkflowState)
const mockVerify = vi.mocked(runVerifyChecks)

function makeState(steps: WorkflowState['steps']): WorkflowState {
  return {
    schemaVersion: 1,
    appId: 'test-app',
    archetype: 'marketing-site',
    northStar: { goals: ['test'], audience: 'testers', voice: 'neutral' },
    steps,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

describe('handleToolCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('runAgent → auto-assign', () => {
    it('marks step in_progress when runAgent has inputs.stepId', async () => {
      const state: WorkflowState = makeState([
        { id: 'build-home', title: 'Build homepage', type: 'auto', status: 'pending', dependsOn: [], ownedFiles: [], verify: [] },
      ])
      mockRead.mockResolvedValue(state)

      await handleToolCompletion(
        'test-app',
        'runAgent',
        { agent: 'builder', title: 'Build homepage', inputs: { stepId: 'build-home' } },
        { jobId: 'job_1' },
        null,
      )

      expect(mockWrite).toHaveBeenCalledOnce()
      expect(state.steps[0]!.status).toBe('in_progress')
      expect(state.steps[0]!.assignedBuilder).toBe('job_1')
    })

    it('does nothing when inputs.stepId is missing', async () => {
      await handleToolCompletion('test-app', 'runAgent', { agent: 'builder', inputs: {} }, { jobId: 'job_1' }, null)
      expect(mockRead).not.toHaveBeenCalled()
    })

    it('does nothing when stepId is an array (invalid)', async () => {
      await handleToolCompletion('test-app', 'runAgent', { agent: 'builder', inputs: { stepId: ['a', 'b'] } }, { jobId: 'job_1' }, null)
      expect(mockRead).not.toHaveBeenCalled()
    })

    it('does not assign already in_progress step', async () => {
      const state: WorkflowState = makeState([
        { id: 's1', title: 'Step', type: 'auto', status: 'in_progress', dependsOn: [], ownedFiles: [], verify: [], assignedBuilder: 'old_job' },
      ])
      mockRead.mockResolvedValue(state)

      await handleToolCompletion('test-app', 'runAgent', { inputs: { stepId: 's1' } }, { jobId: 'job_2' }, null)
      expect(mockWrite).not.toHaveBeenCalled()
      expect(state.steps[0]!.assignedBuilder).toBe('old_job')
    })
  })

  describe('awaitAgents → auto-complete', () => {
    it('marks step done when job status is success and verification passes', async () => {
      const state: WorkflowState = makeState([
        { id: 's1', title: 'Step', type: 'auto', status: 'in_progress', dependsOn: [], ownedFiles: ['src/a.ts'], verify: [{ kind: 'files_exist', spec: 'src/a.ts' }], assignedBuilder: 'job_1' },
      ])
      mockRead.mockResolvedValue(state)
      mockVerify.mockResolvedValue({ passed: true, failures: [] })

      await handleToolCompletion('test-app', 'awaitAgents', {}, { results: [{ jobId: 'job_1', status: 'success', agent: 'builder', title: 'Step' }] }, null)

      expect(mockVerify).toHaveBeenCalledWith('test-app', [{ kind: 'files_exist', spec: 'src/a.ts' }], ['src/a.ts'])
      expect(state.steps[0]!.status).toBe('done')
      expect(mockWrite).toHaveBeenCalledOnce()
    })

    it('marks step failed when verification fails', async () => {
      const state: WorkflowState = makeState([
        { id: 's1', title: 'Step', type: 'auto', status: 'in_progress', dependsOn: [], ownedFiles: ['src/a.ts'], verify: [{ kind: 'files_exist', spec: 'src/a.ts' }], assignedBuilder: 'job_1' },
      ])
      mockRead.mockResolvedValue(state)
      mockVerify.mockResolvedValue({ passed: false, failures: ['File not found: src/a.ts'] })

      await handleToolCompletion('test-app', 'awaitAgents', {}, { results: [{ jobId: 'job_1', status: 'success', agent: 'builder', title: 'Step' }] }, null)

      expect(state.steps[0]!.status).toBe('failed')
      expect(state.steps[0]!.notes).toContain('Verification failed')
    })

    it('marks step failed on job error', async () => {
      const state: WorkflowState = makeState([
        { id: 's1', title: 'Step', type: 'auto', status: 'in_progress', dependsOn: [], ownedFiles: [], verify: [], assignedBuilder: 'job_1' },
      ])
      mockRead.mockResolvedValue(state)

      await handleToolCompletion('test-app', 'awaitAgents', {}, { results: [{ jobId: 'job_1', status: 'error', agent: 'builder', title: 'Step', error: 'timeout' }] }, null)

      expect(state.steps[0]!.status).toBe('failed')
      expect(state.steps[0]!.notes).toContain('Builder error')
    })

    it('marks step failed on job aborted', async () => {
      const state: WorkflowState = makeState([
        { id: 's1', title: 'Step', type: 'auto', status: 'in_progress', dependsOn: [], ownedFiles: [], verify: [], assignedBuilder: 'job_1' },
      ])
      mockRead.mockResolvedValue(state)

      await handleToolCompletion('test-app', 'awaitAgents', {}, { results: [{ jobId: 'job_1', status: 'aborted', agent: 'builder', title: 'Step' }] }, null)

      expect(state.steps[0]!.status).toBe('failed')
      expect(state.steps[0]!.notes).toContain('Builder aborted')
    })

    it('ignores jobs with no matching step', async () => {
      const state: WorkflowState = makeState([
        { id: 's1', title: 'Step', type: 'auto', status: 'in_progress', dependsOn: [], ownedFiles: [], verify: [], assignedBuilder: 'job_other' },
      ])
      mockRead.mockResolvedValue(state)

      await handleToolCompletion('test-app', 'awaitAgents', {}, { results: [{ jobId: 'job_1', status: 'success', agent: 'builder', title: 'Step' }] }, null)

      expect(state.steps[0]!.status).toBe('in_progress')
      expect(mockWrite).not.toHaveBeenCalled()
    })
  })

  describe('askQuestion → gate blocked', () => {
    it('marks eligible gate step as blocked', async () => {
      const state: WorkflowState = makeState([
        { id: 'dep', title: 'Dep', type: 'auto', status: 'done', dependsOn: [], ownedFiles: [], verify: [] },
        { id: 'gate1', title: 'Approval', type: 'gate', status: 'pending', dependsOn: ['dep'], ownedFiles: [], verify: [], gate: { prompt: 'Approve?' } },
      ])
      mockRead.mockResolvedValue(state)

      await handleToolCompletion('test-app', 'askQuestion', {}, { success: true }, null)

      expect(state.steps[1]!.status).toBe('blocked')
      expect(mockWrite).toHaveBeenCalledOnce()
    })

    it('does not block gate whose deps are not met', async () => {
      const state: WorkflowState = makeState([
        { id: 'dep', title: 'Dep', type: 'auto', status: 'pending', dependsOn: [], ownedFiles: [], verify: [] },
        { id: 'gate1', title: 'Approval', type: 'gate', status: 'pending', dependsOn: ['dep'], ownedFiles: [], verify: [], gate: { prompt: 'Approve?' } },
      ])
      mockRead.mockResolvedValue(state)

      await handleToolCompletion('test-app', 'askQuestion', {}, { success: true }, null)

      expect(state.steps[1]!.status).toBe('pending')
      expect(mockWrite).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('does nothing when tool errored', async () => {
      await handleToolCompletion('test-app', 'runAgent', { inputs: { stepId: 's1' } }, null, new Error('fail'))
      expect(mockRead).not.toHaveBeenCalled()
    })

    it('swallows internal errors without throwing', async () => {
      mockRead.mockRejectedValue(new Error('db down'))
      await expect(
        handleToolCompletion('test-app', 'runAgent', { inputs: { stepId: 's1' } }, { jobId: 'j1' }, null),
      ).resolves.toBeUndefined()
    })
  })
})
