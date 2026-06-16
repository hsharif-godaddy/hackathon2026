import { Router, Request, Response, NextFunction, IRouter } from 'express'
import { SimpleCampaignRepository } from '../../database/repositories/SimpleCampaignRepository.js'
import type { CreateSimpleCampaignContentParams } from '../../database/repositories/SimpleCampaignRepository.js'
import { SimpleCampaignStatus } from '../../database/schema.js'
import type { SimpleCampaign, SimpleCampaignContent } from '../../database/schema.js'
import { Logger } from '../../logging/index.js'
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'

const router: IRouter = Router()
const campaignRepo = new SimpleCampaignRepository()
const logger = Logger.create({ component: 'campaigns-routes' })

router.use((req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthenticatedRequest
  if (!authReq.agentContext?.marketingCampaignsEnabled) {
    res.status(403).json({ error: 'Marketing campaigns feature is not enabled' })
    return
  }
  next()
})

// Tenant isolation: ensure the :id (appId) in the URL belongs to the caller's site.
// MUST come before the route handlers below (Express middleware only applies to
// routes defined after it). See agents/CLAUDE.md "Security — Tenant Isolation".
router.use('/:id([a-z0-9]{10})', validateAppOwnership)

/**
 * Map a repository error to an HTTP status. Invalid lifecycle operations are client
 * errors (409 Conflict), missing rows are 404, everything else is a 500.
 */
function statusForError(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('not found')) return 404
  if (message.startsWith('Invalid transition') || message.startsWith('Cannot launch')) return 409
  return 500
}

/**
 * Load a campaign by id and confirm it belongs to the appId in the URL. Even with
 * validateAppOwnership on :id, a campaignId from a different app in the same
 * (per-customer) DB must not be reachable by swapping the path segment.
 * Returns the campaign, or null after sending a 404 response.
 */
function resolveCampaignForApp(req: Request, res: Response): SimpleCampaign | null {
  const appId = req.params.id as string
  const campaignId = req.params.campaignId as string
  const campaign = campaignRepo.findById(campaignId)
  if (!campaign || campaign.appId !== appId) {
    res.status(404).json({ error: 'Campaign not found' })
    return null
  }
  return campaign
}

/**
 * GET /campaigns/:id - List campaigns for an app
 */
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const appId = req.params.id as string
    const campaigns = campaignRepo.findByAppId(appId)
    res.json({ campaigns })
  } catch (error) {
    logger.error('campaigns.list.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to list campaigns' })
  }
})

/**
 * Shape a campaign's content rows as the campaign-detail UI expects them: an `assets`
 * array on the campaign. The UI reads `assetRef` (our model stores it as `contentRefId`),
 * so map that field across. Content stays the system of record; this is just the
 * read-projection the detail modal renders.
 */
function withAssets(campaign: SimpleCampaign): SimpleCampaign & { assets: unknown[] } {
  const assets: unknown[] = campaignRepo.getContent(campaign.id).map((content: SimpleCampaignContent) => ({
    id: content.id,
    assetType: content.assetType,
    assetRef: content.contentRefId,
    title: content.title,
    scheduledDate: content.scheduledDate ?? undefined,
    status: content.status,
    contentPreview: content.contentPreview ?? undefined,
    imageUrl: content.imageUrl ?? undefined,
  }))
  return { ...campaign, assets }
}

/**
 * GET /campaigns/:id/:campaignId - Get campaign with its content pieces (as `assets`)
 */
router.get('/:id/:campaignId', (req: Request, res: Response): void => {
  try {
    const campaign = resolveCampaignForApp(req, res)
    if (!campaign) return

    res.json({ campaign: withAssets(campaign) })
  } catch (error) {
    logger.error('campaigns.get.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to get campaign' })
  }
})

/**
 * POST /campaigns/:id - Create campaign
 */
router.post('/:id', (req: Request, res: Response): void => {
  try {
    const appId = req.params.id as string
    const { name, offer, startDate, endDate } = req.body

    if (!name || !offer) {
      res.status(400).json({ error: 'name and offer are required' })
      return
    }

    const campaign = campaignRepo.create({
      appId,
      name,
      offer,
      startDate,
      endDate,
    })
    res.status(201).json({ campaign })
  } catch (error) {
    logger.error('campaigns.create.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to create campaign' })
  }
})

/**
 * PUT /campaigns/:id/:campaignId - Update campaign
 */
router.put('/:id/:campaignId', (req: Request, res: Response): void => {
  try {
    const existing = resolveCampaignForApp(req, res)
    if (!existing) return

    const campaign = campaignRepo.update(existing.id, req.body)
    res.json({ campaign })
  } catch (error) {
    logger.error('campaigns.update.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(statusForError(error)).json({ error: 'Failed to update campaign' })
  }
})

/**
 * POST /campaigns/:id/:campaignId/generate - Approve plan and mark as ready (content generated)
 */
router.post('/:id/:campaignId/generate', (req: Request, res: Response): void => {
  try {
    const existing = resolveCampaignForApp(req, res)
    if (!existing) return

    const campaign = campaignRepo.transition(existing.id, SimpleCampaignStatus.Ready)
    res.json({ campaign })
  } catch (error) {
    logger.error('campaigns.generate.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(statusForError(error)).json({ error: 'Failed to generate campaign content' })
  }
})

/**
 * POST /campaigns/:id/:campaignId/launch - Launch campaign (schedule content)
 */
router.post('/:id/:campaignId/launch', (req: Request, res: Response): void => {
  try {
    const existing = resolveCampaignForApp(req, res)
    if (!existing) return

    const campaign = campaignRepo.launch(existing.id)
    res.json({ campaign })
  } catch (error) {
    logger.error('campaigns.launch.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(statusForError(error)).json({ error: 'Failed to launch campaign' })
  }
})

/**
 * DELETE /campaigns/:id/:campaignId - Delete campaign
 */
router.delete('/:id/:campaignId', (req: Request, res: Response): void => {
  try {
    const existing = resolveCampaignForApp(req, res)
    if (!existing) return

    campaignRepo.delete(existing.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('campaigns.delete.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to delete campaign' })
  }
})

/**
 * POST /campaigns/:id/:campaignId/assets - Add asset to campaign
 */
router.post('/:id/:campaignId/assets', (req: Request, res: Response): void => {
  try {
    const { assetType, assetRef, title, scheduledDate, status, contentPreview } = req.body

    if (!assetType || !assetRef || !title) {
      res.status(400).json({ error: 'assetType, assetRef, and title are required' })
      return
    }

    const campaign = resolveCampaignForApp(req, res)
    if (!campaign) return

    // The UI sends `assetRef` (its long-standing field name); we store it as contentRefId.
    const input: CreateSimpleCampaignContentParams = {
      simpleCampaignId: campaign.id,
      assetType,
      contentRefId: assetRef,
      title,
      scheduledDate,
      status,
      contentPreview,
    }

    const content: SimpleCampaignContent = campaignRepo.addContent(input)
    res.status(201).json({ content })
  } catch (error) {
    logger.error('campaigns.addAsset.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to add asset' })
  }
})

export default router
