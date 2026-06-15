import { describe, it, expect, beforeEach, vi } from 'vitest'
import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'

const APP_ID = 'abc1234567'

const { mockCampaignRepo } = vi.hoisted(function hoistMocks() {
  return {
    mockCampaignRepo: {
      listByApp: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      addAsset: vi.fn(),
    },
  }
})

vi.mock('../../../database/repositories/CampaignRepository.js', () => ({
  CampaignRepository: vi.fn(function () { return mockCampaignRepo; }),
}))

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}))

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () {
      return { error: vi.fn() }
    }),
  },
}))

import campaignsRouter from '../campaigns.js'

function buildApp(): Express {
  const app = express()
  app.use(express.json())
  app.use('/', campaignsRouter)
  return app
}

describe('campaigns routes', function routeTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  it('lists campaigns without marketingCampaignsEnabled gate', async function listWithoutFlag() {
    const app = buildApp()

    mockCampaignRepo.listByApp.mockReturnValue([
      { id: 'camp-1', appId: APP_ID, name: 'Launch', status: 'ready' },
    ])

    const res = await request(app).get(`/${APP_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.campaigns).toHaveLength(1)
    expect(mockCampaignRepo.listByApp).toHaveBeenCalledWith(APP_ID)
  })

  it('gets campaign by id without marketingCampaignsEnabled gate', async function getWithoutFlag() {
    const app = buildApp()

    mockCampaignRepo.getById.mockReturnValue({
      id: 'camp-1',
      appId: APP_ID,
      name: 'Launch',
      status: 'ready',
      assets: [],
    })

    const res = await request(app).get(`/${APP_ID}/camp-1`)

    expect(res.status).toBe(200)
    expect(res.body.campaign).toMatchObject({ id: 'camp-1', status: 'ready' })
  })
})
