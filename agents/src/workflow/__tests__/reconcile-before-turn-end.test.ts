import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { WorkflowState, WorkflowStep } from '../types.js'

const { mockFindById, mockCheckoutFilesFn } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockCheckoutFilesFn: vi.fn(),
}))

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}))

vi.mock('../../database/repositories/AppRepository.js', () => {
  return {
    AppRepository: class {
      findById(id: string) { return mockFindById(id) }
    },
  }
})

vi.mock('../../utils/git.js', () => {
  return {
    GitUtils: class {
      checkoutFiles(...args: unknown[]) { return mockCheckoutFilesFn(...args) }
    },
  }
})

import { reconcileBeforeTurnEnd } from '../workflow-store.js'
import { createForWorkspace } from '../../workspace/index.js'

const mockCreateForWorkspace = vi.mocked(createForWorkspace)

function makeStep(overrides: Partial<WorkflowStep> & { id: string }): WorkflowStep {
  return {
    title: overrides.id,
    type: 'auto',
    status: 'pending',
    dependsOn: [],
    ownedFiles: [],
    verify: [],
    ...overrides,
  }
}

function makeState(steps: WorkflowStep[]): WorkflowState {
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

function setupWorkspaceMock(state: WorkflowState | null, overrides?: {
  runCommandSync?: ReturnType<typeof vi.fn>,
  deleteFile?: ReturnType<typeof vi.fn>,
}): void {
  const mockView = state
    ? vi.fn().mockResolvedValue({ content: JSON.stringify(state) })
    : vi.fn().mockRejectedValue(new Error('not_found'))

  const mockRunCommandSync = overrides?.runCommandSync ?? vi.fn().mockResolvedValue({
    exitCode: 0, stdout: '', stderr: '', taskId: 't1', timedOut: false, executionTimeMs: 10,
  })
  const mockDelete = overrides?.deleteFile ?? vi.fn().mockResolvedValue(undefined)

  mockCreateForWorkspace.mockReturnValue({
    tasks: { runCommandSync: mockRunCommandSync } as never,
    files: { view: mockView, delete: mockDelete } as never,
  } as never)

  mockFindById.mockReturnValue({ id: 'test-app', path: '/app' })
  mockCheckoutFilesFn.mockResolvedValue({ success: true })
}

describe('reconcileBeforeTurnEnd', function reconcileTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks()
  })

  it('returns empty when no workflow state exists', async function noState() {
    mockCreateForWorkspace.mockReturnValue(null)
    const result: string[] = await reconcileBeforeTurnEnd('app1')
    expect(result).toEqual([])
  })

  it('returns empty when no failed steps', async function noFailed() {
    const state: WorkflowState = makeState([
      makeStep({ id: 'a', status: 'done', ownedFiles: ['f.ts'] }),
    ])
    setupWorkspaceMock(state)
    const result: string[] = await reconcileBeforeTurnEnd('app1')
    expect(result).toEqual([])
  })

  it('reverts tracked files via git checkout per-file', async function trackedFiles() {
    const state: WorkflowState = makeState([
      makeStep({ id: 'a', status: 'failed', ownedFiles: ['src/a.ts', 'src/b.ts'] }),
    ])

    const mockRunCommandSync = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: ' M src/a.ts\n M src/b.ts\n',
      stderr: '',
      taskId: 't1',
      timedOut: false,
      executionTimeMs: 10,
    })
    const mockDelete = vi.fn()

    setupWorkspaceMock(state, { runCommandSync: mockRunCommandSync, deleteFile: mockDelete })

    const result: string[] = await reconcileBeforeTurnEnd('app1')
    expect(result).toEqual([])
    expect(mockCheckoutFilesFn).toHaveBeenCalledTimes(2)
    expect(mockCheckoutFilesFn).toHaveBeenCalledWith('/app', ['src/a.ts'])
    expect(mockCheckoutFilesFn).toHaveBeenCalledWith('/app', ['src/b.ts'])
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('deletes untracked (new) files via workspace.files.delete', async function untrackedFiles() {
    const state: WorkflowState = makeState([
      makeStep({ id: 'a', status: 'failed', ownedFiles: ['src/new.ts'] }),
    ])

    const mockRunCommandSync = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '?? src/new.ts\n',
      stderr: '',
      taskId: 't1',
      timedOut: false,
      executionTimeMs: 10,
    })
    const mockDelete = vi.fn().mockResolvedValue(undefined)

    setupWorkspaceMock(state, { runCommandSync: mockRunCommandSync, deleteFile: mockDelete })

    const result: string[] = await reconcileBeforeTurnEnd('app1')
    expect(result).toEqual([])
    expect(mockCheckoutFilesFn).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith({ path: 'src/new.ts' })
  })

  it('returns unreverted files when checkout fails', async function checkoutFails() {
    const state: WorkflowState = makeState([
      makeStep({ id: 'a', status: 'failed', ownedFiles: ['src/a.ts'] }),
    ])

    const mockRunCommandSync = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: ' M src/a.ts\n',
      stderr: '',
      taskId: 't1',
      timedOut: false,
      executionTimeMs: 10,
    })

    setupWorkspaceMock(state, { runCommandSync: mockRunCommandSync })
    mockCheckoutFilesFn.mockResolvedValue({ success: false, stderr: 'error' })

    const result: string[] = await reconcileBeforeTurnEnd('app1')
    expect(result).toEqual(['src/a.ts'])
  })

  it('returns unreverted files when delete fails for untracked file', async function deleteFails() {
    const state: WorkflowState = makeState([
      makeStep({ id: 'a', status: 'failed', ownedFiles: ['src/new.ts'] }),
    ])

    const mockRunCommandSync = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '?? src/new.ts\n',
      stderr: '',
      taskId: 't1',
      timedOut: false,
      executionTimeMs: 10,
    })
    const mockDelete = vi.fn().mockRejectedValue(new Error('delete failed'))

    setupWorkspaceMock(state, { runCommandSync: mockRunCommandSync, deleteFile: mockDelete })

    const result: string[] = await reconcileBeforeTurnEnd('app1')
    expect(result).toEqual(['src/new.ts'])
  })
})
