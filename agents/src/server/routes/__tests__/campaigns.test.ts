import { describe, it, expect, beforeEach, vi } from 'vitest'
import express, { type Express } from 'express'
import request from 'supertest'
import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js'
import type { SimpleCampaign, SimpleCampaignContent } from '../../../database/schema.js'

const APP_ID = 'abc1234567' // matches /^[a-z0-9]{10}$/ so validateAppOwnership accepts it
const OTHER_APP_ID = 'zyx9876543' // a different app in the same per-customer DB

// Mock the repository the route constructs. The route imports SimpleCampaignRepository
// directly (not via the database barrel), so the mock targets that exact module.
// vi.hoisted keeps the mock available inside the hoisted vi.mock factory below.
const { mockCampaignRepo } = vi.hoisted(() => ({
  mockCampaignRepo: {
    findByAppId: vi.fn(),
    findById: vi.fn(),
    getContent: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    transition: vi.fn(),
    launch: vi.fn(),
    delete: vi.fn(),
    addContent: vi.fn(),
  },
}))

vi.mock('../../../database/repositories/SimpleCampaignRepository.js', () => ({
  SimpleCampaignRepository: vi.fn(function () {
    return mockCampaignRepo
  }),
}))

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () {
      return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }),
  },
}))

import campaignsRouter from '../campaigns.js'

/**
 * Build an app with agentContext injected the way jwtAuthMiddleware would. The real
 * validateAppOwnership middleware runs (siteId === appId), so siteId defaults to APP_ID.
 * campaignsEnabled drives the marketing-campaigns feature gate.
 */
function buildApp(opts: { campaignsEnabled?: boolean; siteId?: string } = {}): Express {
  const { campaignsEnabled = true, siteId = APP_ID } = opts
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as AuthenticatedRequest).agentContext = {
      siteId,
      customerId: 'cust-1',
      sessionId: 'sess-1',
      authType: 'basic',
      product: 'AiroAppBuilder',
      marketingCampaignsEnabled: campaignsEnabled,
    } as unknown as AuthenticatedRequest['agentContext']
    next()
  })
  app.use('/', campaignsRouter)
  return app
}

const mockCampaign: SimpleCampaign = {
  id: 'camp_abc123def456',
  appId: APP_ID,
  marketingPlanId: null,
  name: 'Summer Sale',
  status: 'ready',
  offer: '20% off',
  goal: null,
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  launchedAt: null,
  completedAt: null,
  createdBy: 'agent',
  updatedBy: 'agent',
  createdAt: '2026-06-15T10:00:00Z',
  updatedAt: '2026-06-15T10:00:00Z',
}

const mockContent: SimpleCampaignContent = {
  id: 'cont_abc123def456',
  simpleCampaignId: mockCampaign.id,
  assetType: 'blog',
  contentRefId: 'post_123',
  title: 'Summer Sale Blog',
  scheduledDate: null,
  status: 'draft',
  contentPreview: null,
  imageUrl: null,
  createdBy: 'agent',
  createdAt: '2026-06-15T10:00:00Z',
}

describe('campaigns routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('marketingCampaignsEnabled gate', () => {
    it('returns 403 when the feature is not enabled', async () => {
      const app = buildApp({ campaignsEnabled: false })

      const res = await request(app).get(`/${APP_ID}`)

      expect(res.status).toBe(403)
      expect(mockCampaignRepo.findByAppId).not.toHaveBeenCalled()
    })

    it('allows the request through when the feature is enabled', async () => {
      const app = buildApp({ campaignsEnabled: true })
      mockCampaignRepo.findByAppId.mockReturnValue([])

      const res = await request(app).get(`/${APP_ID}`)

      expect(res.status).toBe(200)
    })
  })

  describe('GET /:id (list)', () => {
    it('lists campaigns for the app', async () => {
      const app = buildApp()
      mockCampaignRepo.findByAppId.mockReturnValue([mockCampaign])

      const res = await request(app).get(`/${APP_ID}`)

      expect(res.status).toBe(200)
      expect(res.body.campaigns).toHaveLength(1)
      expect(mockCampaignRepo.findByAppId).toHaveBeenCalledWith(APP_ID)
    })
  })

  describe('GET /:id/:campaignId (detail)', () => {
    it('returns the campaign with its content pieces as assets (contentRefId → assetRef)', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.getContent.mockReturnValue([mockContent])

      const res = await request(app).get(`/${APP_ID}/${mockCampaign.id}`)

      expect(res.status).toBe(200)
      expect(res.body.campaign).toMatchObject({ id: mockCampaign.id, status: 'ready' })
      expect(mockCampaignRepo.getContent).toHaveBeenCalledWith(mockCampaign.id)
      expect(res.body.campaign.assets).toEqual([
        expect.objectContaining({
          id: mockContent.id,
          assetType: 'blog',
          assetRef: mockContent.contentRefId,
          title: mockContent.title,
          status: 'draft',
        }),
      ])
    })

    it('returns an empty assets array when the campaign has no content', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.getContent.mockReturnValue([])

      const res = await request(app).get(`/${APP_ID}/${mockCampaign.id}`)

      expect(res.status).toBe(200)
      expect(res.body.campaign.assets).toEqual([])
    })

    it('returns 404 when the campaign does not exist', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(null)

      const res = await request(app).get(`/${APP_ID}/camp_missing0000`)

      expect(res.status).toBe(404)
    })

    it('returns 404 when the campaign belongs to a different app (tenant cross-check)', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue({ ...mockCampaign, appId: OTHER_APP_ID })

      const res = await request(app).get(`/${APP_ID}/${mockCampaign.id}`)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /:id (create)', () => {
    it('creates a campaign from the request body', async () => {
      const app = buildApp()
      mockCampaignRepo.create.mockReturnValue(mockCampaign)

      const res = await request(app)
        .post(`/${APP_ID}`)
        .send({ name: 'Summer Sale', offer: '20% off', startDate: '2026-07-01', endDate: '2026-07-31' })

      expect(res.status).toBe(201)
      expect(res.body.campaign).toMatchObject({ id: mockCampaign.id })
      expect(mockCampaignRepo.create).toHaveBeenCalledWith({
        appId: APP_ID,
        name: 'Summer Sale',
        offer: '20% off',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      })
    })

    it('returns 400 when name or offer is missing', async () => {
      const app = buildApp()

      const res = await request(app).post(`/${APP_ID}`).send({ name: 'Only a name' })

      expect(res.status).toBe(400)
      expect(mockCampaignRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('POST /:id/:campaignId/generate', () => {
    it('transitions the campaign to ready', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.transition.mockReturnValue({ ...mockCampaign, status: 'ready' })

      const res = await request(app).post(`/${APP_ID}/${mockCampaign.id}/generate`)

      expect(res.status).toBe(200)
      expect(mockCampaignRepo.transition).toHaveBeenCalledWith(mockCampaign.id, 'ready')
    })

    it('maps an invalid transition to 409', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.transition.mockImplementation(() => {
        throw new Error('Invalid transition: completed → ready')
      })

      const res = await request(app).post(`/${APP_ID}/${mockCampaign.id}/generate`)

      expect(res.status).toBe(409)
    })
  })

  describe('POST /:id/:campaignId/launch', () => {
    it('launches the campaign', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.launch.mockReturnValue({
        ...mockCampaign,
        status: 'active',
        launchedAt: '2026-07-01T00:00:00Z',
      })

      const res = await request(app).post(`/${APP_ID}/${mockCampaign.id}/launch`)

      expect(res.status).toBe(200)
      expect(mockCampaignRepo.launch).toHaveBeenCalledWith(mockCampaign.id)
    })

    it('maps a cannot-launch error to 409', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue({ ...mockCampaign, status: 'draft' })
      mockCampaignRepo.launch.mockImplementation(() => {
        throw new Error('Cannot launch campaign in status: draft')
      })

      const res = await request(app).post(`/${APP_ID}/${mockCampaign.id}/launch`)

      expect(res.status).toBe(409)
    })
  })

  describe('DELETE /:id/:campaignId', () => {
    it('deletes the campaign', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ success: true })
      expect(mockCampaignRepo.delete).toHaveBeenCalledWith(mockCampaign.id)
    })
  })

  describe('POST /:id/:campaignId/assets (add content)', () => {
    it('adds content, mapping the UI assetRef to contentRefId', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.addContent.mockReturnValue(mockContent)

      const res = await request(app)
        .post(`/${APP_ID}/${mockCampaign.id}/assets`)
        .send({ assetType: 'blog', assetRef: 'post_123', title: 'Summer Sale Blog' })

      expect(res.status).toBe(201)
      expect(res.body.content).toMatchObject({ id: mockContent.id })
      expect(mockCampaignRepo.addContent).toHaveBeenCalledWith(
        expect.objectContaining({
          simpleCampaignId: mockCampaign.id,
          assetType: 'blog',
          contentRefId: 'post_123',
          title: 'Summer Sale Blog',
        }),
      )
    })

    it('returns 400 when required content fields are missing', async () => {
      const app = buildApp()

      const res = await request(app).post(`/${APP_ID}/${mockCampaign.id}/assets`).send({ assetType: 'blog' })

      expect(res.status).toBe(400)
      expect(mockCampaignRepo.addContent).not.toHaveBeenCalled()
    })
  })
})
