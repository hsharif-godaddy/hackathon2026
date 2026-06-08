import { Router, Request, Response, NextFunction, IRouter } from 'express'
import { CampaignRepository } from '../../database/repositories/CampaignRepository.js'
import type { CreateCampaignInput, CreateAssetInput } from '../../database/repositories/CampaignRepository.js'
import { Logger } from '../../logging/index.js'
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'

const router: IRouter = Router()
const campaignRepo = new CampaignRepository()
const logger = Logger.create({ component: 'campaigns-routes' })

router.use((req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthenticatedRequest
  if (!authReq.agentContext?.marketingCampaignsEnabled) {
    res.status(403).json({ error: 'Marketing campaigns feature is not enabled' })
    return
  }
  next()
})

router.use('/:id([a-z0-9]{10})', validateAppOwnership)

/**
 * GET /campaigns/:id - List campaigns for an app
 */
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const appId = req.params.id as string
    const campaigns = campaignRepo.listByApp(appId)
    res.json({ campaigns })
  } catch (error) {
    logger.error('campaigns.list.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to list campaigns' })
  }
})

/**
 * GET /campaigns/:id/:campaignId - Get campaign with assets
 */
router.get('/:id/:campaignId', (req: Request, res: Response): void => {
  try {
    const campaignId = req.params.campaignId as string
    const campaign = campaignRepo.getById(campaignId)

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    res.json({ campaign })
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
    const { name, campaignType, offer, startDate, endDate, landingPagePath, status } = req.body

    if (!name || !offer) {
      res.status(400).json({ error: 'name and offer are required' })
      return
    }

    const input: CreateCampaignInput = {
      appId,
      name,
      campaignType: campaignType || 'landing-page',
      offer,
      startDate: startDate || '',
      endDate: endDate || '',
      landingPagePath,
      status,
    }

    const campaign = campaignRepo.create(input)
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
    const campaignId = req.params.campaignId as string
    const updates = req.body

    const campaign = campaignRepo.update(campaignId, updates)
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    res.json({ campaign })
  } catch (error) {
    logger.error('campaigns.update.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to update campaign' })
  }
})

/**
 * POST /campaigns/:id/:campaignId/generate - Approve plan and mark as ready (content generated)
 */
router.post('/:id/:campaignId/generate', (req: Request, res: Response): void => {
  try {
    const campaignId = req.params.campaignId as string
    const campaign = campaignRepo.update(campaignId, { status: 'ready' })

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    res.json({ campaign })
  } catch (error) {
    logger.error('campaigns.generate.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to generate campaign content' })
  }
})

/**
 * POST /campaigns/:id/:campaignId/launch - Launch campaign (schedule content)
 */
router.post('/:id/:campaignId/launch', (req: Request, res: Response): void => {
  try {
    const campaignId = req.params.campaignId as string
    const campaign = campaignRepo.update(campaignId, { status: 'active' })

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    res.json({ campaign })
  } catch (error) {
    logger.error('campaigns.launch.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to launch campaign' })
  }
})

/**
 * DELETE /campaigns/:id/:campaignId - Delete campaign
 */
router.delete('/:id/:campaignId', (req: Request, res: Response): void => {
  try {
    const campaignId = req.params.campaignId as string
    const deleted = campaignRepo.delete(campaignId)

    if (!deleted) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

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
    const campaignId = req.params.campaignId as string
    const { assetType, assetRef, title, scheduledDate, status, contentPreview } = req.body

    if (!assetType || !assetRef || !title) {
      res.status(400).json({ error: 'assetType, assetRef, and title are required' })
      return
    }

    const campaign = campaignRepo.getById(campaignId)
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    const input: CreateAssetInput = {
      campaignId,
      assetType,
      assetRef,
      title,
      scheduledDate,
      status,
      contentPreview,
    }

    const asset = campaignRepo.addAsset(input)
    res.status(201).json({ asset })
  } catch (error) {
    logger.error('campaigns.addAsset.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to add asset' })
  }
})

export default router
