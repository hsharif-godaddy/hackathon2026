import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { DevSupervisorError } from '../../DevSupervisorClient.js'
import { readLogoJob, writeLogoJob, type LogoJob } from '../logo-job-state.js'

function makeJob(overrides: Partial<LogoJob> = {}): LogoJob {
  return {
    jobId: 'job-1', status: 'queued', prompt: 'p', layouts: ['horizontal'],
    slots: ['logo/horizontal'], isRegeneration: false, previousSlots: {},
    attempt: 0, createdAt: 'now', updatedAt: 'now', ...overrides,
  }
}

describe('logo-job-state', () => {
  let workspace: { view: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
  beforeEach(() => { workspace = { view: vi.fn(), write: vi.fn() } })

  it('readLogoJob parses the job file', async () => {
    workspace.view.mockResolvedValueOnce({ content: JSON.stringify(makeJob({ status: 'generating' })) })
    const job = await readLogoJob(workspace as never, 'app-1')
    expect(job?.status).toBe('generating')
  })

  it('readLogoJob returns null when the file is missing', async () => {
    workspace.view.mockRejectedValueOnce(new DevSupervisorError('not_found', 404, 'missing'))
    expect(await readLogoJob(workspace as never, 'app-1')).toBeNull()
  })

  it('readLogoJob rethrows non-not_found errors', async () => {
    workspace.view.mockRejectedValueOnce(new DevSupervisorError('internal', 500, 'boom'))
    await expect(readLogoJob(workspace as never, 'app-1')).rejects.toThrow('boom')
  })

  it('writeLogoJob serializes to .airo/logo.json', async () => {
    workspace.write.mockResolvedValueOnce(undefined)
    await writeLogoJob(workspace as never, 'app-1', makeJob())
    expect(workspace.write).toHaveBeenCalledWith({
      path: '.airo/logo.json',
      content: expect.stringContaining('"jobId": "job-1"'),
    })
  })
})
