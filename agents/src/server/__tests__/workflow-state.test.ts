import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'

vi.mock('../../workflow/workflow-store.js', () => ({
  readWorkflowState: vi.fn(),
}))

vi.mock('../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn((_req, _res, next) => next()),
}))

import { readWorkflowState } from '../../workflow/workflow-store.js'
import workflowStateRouter from '../routes/workflow-state.js'

describe('GET /apps/:appId/workflow', () => {
  let app: Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = express()
    app.use('/apps', workflowStateRouter)
  })

  it('returns workflow state when it exists', async () => {
    const mockState = {
      schemaVersion: 1,
      appId: 'ab12cd34ef',
      archetype: 'site',
      northStar: { goals: ['sell widgets'], audience: 'small biz', voice: 'friendly' },
      steps: [{ id: 'interview', title: 'Interview', type: 'gate', status: 'done', dependsOn: [], ownedFiles: [], verify: [] }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T01:00:00Z',
    }
    vi.mocked(readWorkflowState).mockResolvedValue(mockState)

    const res = await request(app).get('/apps/ab12cd34ef/workflow')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(mockState)
  })

  it('returns 404 when no workflow exists', async () => {
    vi.mocked(readWorkflowState).mockResolvedValue(null)

    const res = await request(app).get('/apps/ab12cd34ef/workflow')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'No workflow found' })
  })
})
