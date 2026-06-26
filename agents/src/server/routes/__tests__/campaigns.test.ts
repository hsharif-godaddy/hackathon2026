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
const { mockCampaignRepo, mockSocialPostRepo, mockUtmRepo, mockSkills } = vi.hoisted(() => ({
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
    findContentById: vi.fn(),
    updateContent: vi.fn(),
    deleteContent: vi.fn(),
  },
  // The editSocialDraft/deleteSocialDraft helper (social-draft-sync) constructs these to keep
  // the linked social_posts row + UTM attribution in sync; mock them so the route stays a unit.
  mockSocialPostRepo: { update: vi.fn(), delete: vi.fn() },
  mockUtmRepo: { deleteByContentRefId: vi.fn() },
  // The social-draft routes gate on skills.isEnabled('social'); default it on so the existing
  // edit/delete cases run, and flip it off in the gate test below.
  mockSkills: { isEnabled: vi.fn().mockReturnValue(true), isProfileGated: vi.fn().mockReturnValue(false) },
}))

vi.mock('../../../database/repositories/SimpleCampaignRepository.js', () => ({
  SimpleCampaignRepository: vi.fn(function () {
    return mockCampaignRepo
  }),
}))

vi.mock('../../../database/repositories/SocialPostRepository.js', () => ({
  SocialPostRepository: vi.fn(function () {
    return mockSocialPostRepo
  }),
}))

vi.mock('../../../database/repositories/MarketingUtmRepository.js', () => ({
  MarketingUtmRepository: vi.fn(function () {
    return mockUtmRepo
  }),
}))

// campaignRefId is buildCampaignToken(campaign.id). Stub it so the route test asserts the
// field is wired deterministically without depending on the real HMAC key (getEncryptionKey).
vi.mock('../../../utils/campaign-utm-signer.js', () => ({
  buildCampaignToken: (id: string): string => `cmp_ref_${id}`,
}))

// editSocialDraft/deleteSocialDraft wrap their cascade in getDatabase().transaction(); stub
// it as a synchronous pass-through so the route stays a unit (no real DB), while a throw
// inside the cascade still propagates as it would after a real rollback.
vi.mock('../../../database/connection.js', () => ({
  getDatabase: () => ({ transaction: (fn: () => unknown) => fn }),
}))

// Gate source for the social-draft routes. Preserve the module's other exports and override
// only `skills` so unrelated consumers in the graph are unaffected.
vi.mock('../../../services/features.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/features.js')>()
  return { ...actual, skills: mockSkills }
})

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
  rawContent: null,
  createdBy: 'agent',
  createdAt: '2026-06-15T10:00:00Z',
}

// A pre-launch social draft: assetType social, contentRefId null (not yet materialized),
// editable content carried in rawContent. Belongs to mockCampaign.
const socialDraft: SimpleCampaignContent = {
  ...mockContent,
  id: 'cont_social01234',
  assetType: 'social',
  contentRefId: null,
  contentPreview: 'old caption',
  rawContent: '{"message":"old caption","hashtags":["a"]}',
}

describe('campaigns routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks resets call history but not implementations; re-assert the social flag on
    // so the gate-off test below cannot bleed into the others.
    mockSkills.isEnabled.mockReturnValue(true)
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

    it('exposes campaignRefId (utm_campaign token) alongside appId for stats-API lookups', async () => {
      const app = buildApp()
      mockCampaignRepo.findByAppId.mockReturnValue([mockCampaign])

      const res = await request(app).get(`/${APP_ID}`)

      expect(res.body.campaigns[0]).toMatchObject({
        id: mockCampaign.id,
        appId: APP_ID,
        campaignRefId: `cmp_ref_${mockCampaign.id}`,
      })
    })
  })

  describe('GET /:id/:campaignId (detail)', () => {
    it('returns the campaign with its content pieces as assets (contentRefId → assetRef)', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.getContent.mockReturnValue([mockContent])

      const res = await request(app).get(`/${APP_ID}/${mockCampaign.id}`)

      expect(res.status).toBe(200)
      expect(res.body.campaign).toMatchObject({ id: mockCampaign.id, status: 'ready', campaignRefId: `cmp_ref_${mockCampaign.id}` })
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

    it('includes rawContent in the asset projection', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.getContent.mockReturnValue([
        { ...mockContent, assetType: 'social', contentRefId: null, rawContent: '{"message":"hi","hashtags":["a"]}' },
      ])

      const res = await request(app).get(`/${APP_ID}/${mockCampaign.id}`)

      expect(res.status).toBe(200)
      expect(res.body.campaign.assets[0].rawContent).toBe('{"message":"hi","hashtags":["a"]}')
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

  describe('PATCH /:id/:campaignId/content/:contentId (edit social draft)', () => {
    it('merges message and hashtags into raw_content and refreshes content_preview', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(socialDraft)
      mockCampaignRepo.updateContent.mockImplementation((_id: string, p: Record<string, unknown>) => ({
        ...socialDraft,
        ...p,
      }))

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ message: 'new caption', hashtags: ['b'], callToAction: 'Book' })

      expect(res.status).toBe(200)
      const arg = mockCampaignRepo.updateContent.mock.calls[0][1]
      expect(JSON.parse(arg.rawContent)).toEqual({ message: 'new caption', hashtags: ['b'], callToAction: 'Book' })
      expect(arg.contentPreview).toBe('new caption')
      expect(mockCampaignRepo.updateContent).toHaveBeenCalledWith(socialDraft.id, expect.any(Object))
    })

    it('preserves untouched fields when an edit omits them', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue({
        ...socialDraft,
        rawContent: '{"message":"old caption","hashtags":["a"],"callToAction":"Old","platform":"instagram"}',
      })
      mockCampaignRepo.updateContent.mockImplementation((_id: string, p: Record<string, unknown>) => ({ ...socialDraft, ...p }))

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ message: 'new caption' })

      expect(res.status).toBe(200)
      const written = JSON.parse(mockCampaignRepo.updateContent.mock.calls[0][1].rawContent)
      expect(written).toEqual({ message: 'new caption', hashtags: ['a'], callToAction: 'Old', platform: 'instagram' })
    })

    it('returns 400 when no editable fields are provided', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(socialDraft)

      const res = await request(app).patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`).send({})

      expect(res.status).toBe(400)
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('returns 400 (not a 500/corrupt write) when hashtags is not an array', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(socialDraft)

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ hashtags: 'summer' })

      expect(res.status).toBe(400)
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('returns 400 (not a 500) when scheduledDate is not a valid datetime', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(socialDraft)

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ scheduledDate: 'next tuesday' })

      expect(res.status).toBe(400)
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('returns 404 (no existence leak) when the social feature flag is off', async () => {
      mockSkills.isEnabled.mockReturnValue(false)
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(socialDraft)

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ message: 'x' })

      expect(res.status).toBe(404)
      expect(mockCampaignRepo.findContentById).not.toHaveBeenCalled()
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('returns 404 when the content row does not exist', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(null)

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/cont_missing000`)
        .send({ message: 'x' })

      expect(res.status).toBe(404)
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('returns 404 when the content belongs to a different campaign', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, simpleCampaignId: 'camp_other00000' })

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ message: 'x' })

      expect(res.status).toBe(404)
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('returns 404 when the campaign belongs to a different app (tenant cross-check)', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue({ ...mockCampaign, appId: OTHER_APP_ID })

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ message: 'x' })

      expect(res.status).toBe(404)
      expect(mockCampaignRepo.findContentById).not.toHaveBeenCalled()
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('returns 400 when the asset is not a social post', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, assetType: 'blog' })

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ message: 'x' })

      expect(res.status).toBe(400)
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('returns 409 when the campaign has launched (status past ready)', async () => {
      const app = buildApp()
      // The draft keeps its approve-time contentRefId; launch is gated on campaign status.
      mockCampaignRepo.findById.mockReturnValue({ ...mockCampaign, status: 'active' })
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, contentRefId: 'post_123' })

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ message: 'x' })

      expect(res.status).toBe(409)
      expect(mockCampaignRepo.updateContent).not.toHaveBeenCalled()
    })

    it('edits a materialized draft and syncs the linked social_posts payload (contentRefId set)', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign) // status 'ready'
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, contentRefId: 'post_123' })
      mockCampaignRepo.updateContent.mockImplementation((_id: string, p: Record<string, unknown>) => ({ ...socialDraft, ...p }))

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ message: 'new caption' })

      expect(res.status).toBe(200)
      expect(mockCampaignRepo.updateContent).toHaveBeenCalled()
      expect(mockSocialPostRepo.update).toHaveBeenCalledWith(
        'post_123',
        expect.objectContaining({ payload: expect.objectContaining({ message: 'new caption' }) }),
      )
    })

    it('persists scheduledDate to the content row and the linked post scheduled_at', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign) // status 'ready'
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, contentRefId: 'post_123' })
      mockCampaignRepo.updateContent.mockImplementation((_id: string, p: Record<string, unknown>) => ({ ...socialDraft, ...p }))

      const res = await request(app)
        .patch(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)
        .send({ scheduledDate: '2026-06-27T18:00:00.000Z' })

      expect(res.status).toBe(200)
      expect(mockCampaignRepo.updateContent.mock.calls[0][1].scheduledDate).toBe('2026-06-27T18:00:00.000Z')
      const postArg = mockSocialPostRepo.update.mock.calls[0][1]
      expect((postArg.scheduledAt as Date).toISOString()).toBe('2026-06-27T18:00:00.000Z')
    })
  })

  describe('DELETE /:id/:campaignId/content/:contentId (delete social draft)', () => {
    it('deletes a pre-launch social draft', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(socialDraft)
      mockCampaignRepo.deleteContent.mockReturnValue(true)

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ success: true })
      expect(mockCampaignRepo.deleteContent).toHaveBeenCalledWith(socialDraft.id)
    })

    it('returns 404 when the content row does not exist', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(null)

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}/content/cont_missing000`)

      expect(res.status).toBe(404)
      expect(mockCampaignRepo.deleteContent).not.toHaveBeenCalled()
    })

    it('returns 404 when the content belongs to a different campaign', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, simpleCampaignId: 'camp_other00000' })

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)

      expect(res.status).toBe(404)
      expect(mockCampaignRepo.deleteContent).not.toHaveBeenCalled()
    })

    it('returns 404 when the campaign belongs to a different app (tenant cross-check)', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue({ ...mockCampaign, appId: OTHER_APP_ID })

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)

      expect(res.status).toBe(404)
      expect(mockCampaignRepo.deleteContent).not.toHaveBeenCalled()
    })

    it('returns 400 when the asset is not a social post', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, assetType: 'blog' })

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)

      expect(res.status).toBe(400)
      expect(mockCampaignRepo.deleteContent).not.toHaveBeenCalled()
    })

    it('returns 409 when the campaign has launched (status past ready)', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue({ ...mockCampaign, status: 'active' })
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, contentRefId: 'post_123' })

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)

      expect(res.status).toBe(409)
      expect(mockCampaignRepo.deleteContent).not.toHaveBeenCalled()
    })

    it('deletes a materialized draft and cascades to social_posts + UTM (contentRefId set)', async () => {
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign) // status 'ready'
      mockCampaignRepo.findContentById.mockReturnValue({ ...socialDraft, contentRefId: 'post_123' })
      mockCampaignRepo.deleteContent.mockReturnValue(true)

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)

      expect(res.status).toBe(200)
      expect(mockCampaignRepo.deleteContent).toHaveBeenCalledWith(socialDraft.id)
      expect(mockSocialPostRepo.delete).toHaveBeenCalledWith('post_123')
      expect(mockUtmRepo.deleteByContentRefId).toHaveBeenCalledWith('post_123')
    })

    it('returns 404 (no existence leak) when the social feature flag is off', async () => {
      mockSkills.isEnabled.mockReturnValue(false)
      const app = buildApp()
      mockCampaignRepo.findById.mockReturnValue(mockCampaign)
      mockCampaignRepo.findContentById.mockReturnValue(socialDraft)

      const res = await request(app).delete(`/${APP_ID}/${mockCampaign.id}/content/${socialDraft.id}`)

      expect(res.status).toBe(404)
      expect(mockCampaignRepo.findContentById).not.toHaveBeenCalled()
      expect(mockCampaignRepo.deleteContent).not.toHaveBeenCalled()
    })
  })
})
