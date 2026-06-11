import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
const mockRead = vi.fn()
vi.mock('../../services/logo/logo-job-state.js', () => ({ readLogoJob: () => mockRead() }))
vi.mock('../../workspace/index.js', () => ({ createForWorkspace: () => ({ files: {} }) }))

import { buildLogoStatusContextMessage } from '../logo-status-context.js'

beforeEach(() => vi.clearAllMocks())

it('returns null when there is no job', async () => {
  mockRead.mockResolvedValueOnce(null)
  expect(await buildLogoStatusContextMessage({ appId: 'app-1' })).toBeNull()
})

it('reports in-progress for a generating job (after_history)', async () => {
  mockRead.mockResolvedValueOnce({ jobId: 'j', status: 'generating', slots: ['logo/horizontal'] })
  const msg = await buildLogoStatusContextMessage({ appId: 'app-1' })
  expect(msg?.content.toLowerCase()).toContain('in progress')
  expect(msg?.insertionOrder).toBe('after_history')
})

it('reports failure with the error message', async () => {
  mockRead.mockResolvedValueOnce({ jobId: 'j', status: 'failed', slots: ['logo/horizontal'], error: 'boom' })
  const msg = await buildLogoStatusContextMessage({ appId: 'app-1' })
  expect(msg?.content).toContain('FAILED')
  expect(msg?.content).toContain('boom')
})
