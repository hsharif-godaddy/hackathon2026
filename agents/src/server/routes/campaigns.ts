import { Router, Request, Response, NextFunction, IRouter } from 'express'
import { generateTextWithTracking } from '@airo/ai-lib'
import { z } from 'zod'
import { SimpleCampaignRepository } from '../../database/repositories/SimpleCampaignRepository.js'
import type { CreateSimpleCampaignContentParams } from '../../database/repositories/SimpleCampaignRepository.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { SimpleCampaignStatus, SimpleCampaignContentType, isCampaignPreLaunch } from '../../database/schema.js'
import type { SimpleCampaign, SimpleCampaignContent } from '../../database/schema.js'
import { editSocialDraft, deleteSocialDraft } from '../../services/social/social-draft-sync.js'
import { skills } from '../../services/features.js'
import { Logger } from '../../logging/index.js'
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { buildCampaignToken } from '../../utils/campaign-utm-signer.js'
import { getAgentModelWithName } from '../../utils/model-selection.js'

const router: IRouter = Router()
const campaignRepo = new SimpleCampaignRepository()
const appRepo = new AppRepository()
const logger = Logger.create({ component: 'campaigns-routes' })

export interface CampaignSuggestionPayload {
  text: string
  prompt: string
}

export function isValidCampaignSuggestionItem(item: unknown): item is CampaignSuggestionPayload {
  if (typeof item !== 'object' || item === null) return false
  const candidate = item as CampaignSuggestionPayload
  return typeof candidate.text === 'string'
    && candidate.text.trim().length > 0
    && typeof candidate.prompt === 'string'
    && candidate.prompt.trim().length > 0
}

export function parseCampaignSuggestions(rawText: string): CampaignSuggestionPayload[] {
  const parsed = JSON.parse(rawText) as { suggestions?: unknown }
  if (!Array.isArray(parsed?.suggestions)) return []

  return parsed.suggestions.filter(isValidCampaignSuggestionItem)
}

function logSuggestionParseWarnings(
  appId: string,
  parsed: { suggestions?: unknown },
  suggestions: CampaignSuggestionPayload[],
): void {
  if (!Array.isArray(parsed?.suggestions)) {
    logger.warn('campaigns.suggestions.invalid_shape', { appId, reason: 'suggestions_not_array' })
    return
  }

  if (parsed.suggestions.length > 0 && suggestions.length === 0) {
    logger.warn('campaigns.suggestions.invalid_shape', {
      appId,
      reason: 'all_items_invalid',
      rawCount: parsed.suggestions.length,
    })
    return
  }

  if (suggestions.length < parsed.suggestions.length) {
    logger.warn('campaigns.suggestions.filtered_items', {
      appId,
      rawCount: parsed.suggestions.length,
      validCount: suggestions.length,
    })
  }
}

const SUGGESTIONS_SYSTEM_PROMPT = `You generate marketing campaign suggestions for a business owner. Return ONLY valid JSON, no other text or formatting.

Given a business name and optional description, produce exactly 3 short campaign suggestions.

Format: {"suggestions":[{"text":"...","prompt":"..."}]}

Rules:
- text: 4-6 words shown as a clickable button label (e.g., "Run a holiday sale")
- prompt: 8-15 words the owner sends to start the campaign (e.g., "Create a Black Friday sale campaign for my store")
- Each suggestion must be a distinct campaign type (e.g., seasonal promotion, email newsletter, social media, product launch)
- Be specific to the business type described`

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
 * Validates the editable fields of a social-draft PATCH. This is the BFF→agents trust
 * boundary (req.body is `any`), so mirror the Zod validation the socialPostEdit tool applies
 * (plus the `scheduledDate` only the route accepts): a non-array `hashtags` or a malformed
 * `scheduledDate` is a clean 400 here, never persisted verbatim into raw_content /
 * social_posts.payload (which would corrupt the shape the launch path reads) or thrown deep
 * in editSocialDraft as a 500. The frontend sends exactly these fields, so `.strict()`
 * rejects anything unexpected. `.refine` enforces at least one field to edit.
 */
const editSocialDraftBodySchema = z
  .object({
    message: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    callToAction: z.string().optional(),
    scheduledDate: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.message !== undefined ||
      body.hashtags !== undefined ||
      body.callToAction !== undefined ||
      body.scheduledDate !== undefined,
    { message: 'Provide at least one field to edit (message, hashtags, callToAction, or scheduledDate)' },
  )

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
 * Resolve a pre-launch social draft for an edit/delete on an already-app-verified campaign.
 * Applies the same guards as the socialPostEdit/Delete tools, in order: content exists and
 * belongs to this campaign (404), is a social asset (400), and the campaign has not been
 * launched yet — once it leaves draft/ready the posts are handed to the platform and are
 * managed there (409). Editability is gated on campaign status, not contentRefId (which is
 * stamped at approve when the draft is materialized).
 * Returns the content, or null after sending the appropriate error response.
 */
function resolveSocialDraftForEdit(campaign: SimpleCampaign, req: Request, res: Response): SimpleCampaignContent | null {
  // Gate the social-draft edit/delete capability on the social feature flag, symmetric with
  // the socialPostEdit/socialPostDelete agent tools (which are only registered when
  // skills.isEnabled('social')). When social is off, surface the same 404 as a missing row so
  // the disabled capability never leaks its existence.
  if (!skills.isEnabled('social')) {
    res.status(404).json({ error: 'Campaign content not found' })
    return null
  }
  const contentId = req.params.contentId as string
  const content: SimpleCampaignContent | null = campaignRepo.findContentById(contentId)
  if (!content || content.simpleCampaignId !== campaign.id) {
    res.status(404).json({ error: 'Campaign content not found' })
    return null
  }
  if (content.assetType !== SimpleCampaignContentType.Social) {
    res.status(400).json({ error: 'Only social posts can be edited or deleted here' })
    return null
  }
  if (!isCampaignPreLaunch(campaign.status)) {
    res.status(409).json({ error: 'Cannot modify a launched post; it is now managed on the platform' })
    return null
  }
  return content
}

/**
 * Stamp the public campaign reference on a campaign for the front-of-site performance view.
 * `campaignRefId` is the campaign's `utm_campaign` token — a deterministic HMAC of the
 * internal id (the same `buildCampaignToken` the marketing_utm writer uses), so it is
 * computed on read with no marketing_utm lookup and is present even before any content is
 * published. The consumer pairs it with `appId` (already on the campaign) to query the
 * Customer Stats API for leads/sources.
 */
function withCampaignRefId<T extends SimpleCampaign>(campaign: T): T & { campaignRefId: string } {
  return { ...campaign, campaignRefId: buildCampaignToken(campaign.id) }
}

/**
 * GET /campaigns/:id - List campaigns for an app
 */
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const appId = req.params.id as string
    const campaigns = campaignRepo.findByAppId(appId).map(withCampaignRefId)
    res.json({ campaigns })
  } catch (error) {
    logger.error('campaigns.list.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to list campaigns' })
  }
})

/**
 * GET /campaigns/:id/suggestions - AI-generated campaign suggestions for the app
 */
router.get('/:id/suggestions', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const appId = req.params.id as string

  try {
    const app = appRepo.findById(appId)
    const businessContext = [
      `Business name: ${app?.name ?? 'Unknown'}`,
      app?.initialPrompt ? `Description: ${app.initialPrompt.slice(0, 500)}` : null,
    ].filter(Boolean).join('\n')

    const { model, modelName } = await getAgentModelWithName('fast')
    const result = await generateTextWithTracking({
      model,
      modelName,
      system: SUGGESTIONS_SYSTEM_PROMPT,
      prompt: businessContext,
      maxOutputTokens: 200,
      context: {
        appId,
        toolName: 'campaignSuggestions',
        description: 'Marketing campaign suggestions',
      },
    })

    const parsedJson = JSON.parse(result.text) as { suggestions?: unknown }
    const suggestions = Array.isArray(parsedJson?.suggestions)
      ? parsedJson.suggestions.filter(isValidCampaignSuggestionItem)
      : []
    logSuggestionParseWarnings(appId, parsedJson, suggestions)
    res.json({ suggestions })
  } catch (error) {
    logger.error('campaigns.suggestions.error', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: 'Failed to generate campaign suggestions' })
  }
})

/**
 * Shape a campaign's content rows as the campaign-detail UI expects them: an `assets`
 * array on the campaign. The UI reads `assetRef` (our model stores it as `contentRefId`),
 * so map that field across. Content stays the system of record; this is just the
 * read-projection the detail modal renders.
 */
function withAssets(campaign: SimpleCampaign): SimpleCampaign & { campaignRefId: string; assets: unknown[] } {
  const assets: unknown[] = campaignRepo.getContent(campaign.id).map((content: SimpleCampaignContent) => ({
    id: content.id,
    assetType: content.assetType,
    assetRef: content.contentRefId,
    title: content.title,
    scheduledDate: content.scheduledDate ?? undefined,
    status: content.status,
    contentPreview: content.contentPreview ?? undefined,
    imageUrl: content.imageUrl ?? undefined,
    rawContent: content.rawContent ?? undefined,
  }))
  return { ...withCampaignRefId(campaign), assets }
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

/**
 * PATCH /campaigns/:id/:campaignId/content/:contentId - Edit a pre-launch social draft.
 * Edits the draft's message, hashtags, call-to-action, and/or scheduledDate. The merged content
 * is written to raw_content (message mirrored to content_preview) and, when the draft has been
 * materialized, kept in sync on the linked social_posts row (payload + scheduled_at) via
 * editSocialDraft, so the post that publishes matches the edit. The image is display-only here —
 * replacement requires regeneration and is deferred.
 */
router.patch('/:id/:campaignId/content/:contentId', (req: Request, res: Response): void => {
  try {
    const campaign: SimpleCampaign | null = resolveCampaignForApp(req, res)
    if (!campaign) return

    const content: SimpleCampaignContent | null = resolveSocialDraftForEdit(campaign, req, res)
    if (!content) return

    const parsed = editSocialDraftBodySchema.safeParse(req.body)
    if (!parsed.success) {
      const details: { path: string; message: string }[] = parsed.error.issues.map((issue: z.ZodIssue): { path: string; message: string } => ({ path: issue.path.join('.'), message: issue.message }))
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid edit payload', details })
      return
    }

    const updated: SimpleCampaignContent = editSocialDraft(content, parsed.data)
    res.json({ content: updated })
  } catch (error) {
    logger.error('campaigns.editContent.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(statusForError(error)).json({ error: 'Failed to edit content' })
  }
})

/**
 * DELETE /campaigns/:id/:campaignId/content/:contentId - Delete a pre-launch social draft.
 */
router.delete('/:id/:campaignId/content/:contentId', (req: Request, res: Response): void => {
  try {
    const campaign: SimpleCampaign | null = resolveCampaignForApp(req, res)
    if (!campaign) return

    const content: SimpleCampaignContent | null = resolveSocialDraftForEdit(campaign, req, res)
    if (!content) return

    deleteSocialDraft(content)
    res.json({ success: true })
  } catch (error) {
    logger.error('campaigns.deleteContent.error', { error: error instanceof Error ? error.message : String(error) })
    res.status(statusForError(error)).json({ error: 'Failed to delete content' })
  }
})

export default router
