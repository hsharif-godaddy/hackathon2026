import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { CampaignRepository } from '../../database/repositories/CampaignRepository.js'
import type { CreateCampaignInput, CreateAssetInput } from '../../database/repositories/CampaignRepository.js'
import { MediaSearchTool } from '../media-search-tool.js'

const campaignRepo = new CampaignRepository()
const mediaSearch = new MediaSearchTool()

export const campaignPlanCreateTool: Tool = createTool(
  `Save a completed campaign and render the campaign artifact card with a "Launch Campaign" button.

CRITICAL TIMING: Call this tool ONLY in the SUMMARY step — AFTER all content has been fully generated (landing page built, blog posts written, social posts created, email/ad copy written). This is the LAST tool you call in the campaign flow.

DO NOT call this tool:
- During the planning/discovery phase
- Before the user approves the plan
- Before content generation is complete

The correct flow is:
1. Ask discovery questions (askQuestion)
2. Present plan as TEXT in chat + ask for approval (askQuestion)
3. User approves → verify prerequisites → generate all content
4. THEN call this tool to save and show the campaign card

The rendered card shows the campaign with a "Launch Campaign" button the user clicks when ready to schedule publishing.`,
  z.object({
    name: z.string().describe('Campaign name (e.g. "Summer Sale 2026", "Grand Opening Week")'),
    offer: z.string().describe('The campaign offer or goal (e.g. "25% off all services", "Drive awareness for new location")'),
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    campaignType: z.enum(['landing-page', 'banner', 'content-only']).default('content-only').describe('Type of campaign artifact'),
    landingPagePath: z.string().optional().describe('Route path if a landing page is planned'),
    plannedContent: z.array(z.object({
      assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Content channel'),
      title: z.string().describe('Planned content title or headline'),
      scheduledDate: z.string().optional().describe('Planned publish date (YYYY-MM-DD)'),
      contentPreview: z.string().optional().describe('Brief description of what this content will cover'),
      imageUrl: z.string().optional().describe('URL of the image used for this content piece (pass the actual image URL used during generation if available)'),
    })).describe('List of planned content items for the campaign'),
  }),
  async (args, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      return JSON.stringify({ success: false, error: 'No appId in context' })
    }

    const existingDrafts = campaignRepo.listByApp(appId).filter(c => c.status === 'draft')
    for (const draft of existingDrafts) {
      campaignRepo.delete(draft.id)
    }

    const campaignInput: CreateCampaignInput = {
      appId,
      name: args.name,
      campaignType: args.campaignType,
      offer: args.offer,
      startDate: args.startDate,
      endDate: args.endDate,
      landingPagePath: args.landingPagePath,
      status: 'ready',
    }

    const campaign = campaignRepo.create(campaignInput)

    for (const item of args.plannedContent) {
      let imageUrl: string | undefined = item.imageUrl
      if (!imageUrl) {
        try {
          const searchQuery = `${item.title} ${args.name}`.slice(0, 60)
          const result = await mediaSearch.searchMedia(searchQuery, 'image', 1, appId)
          if (result.success) {
            imageUrl = result.url || (result.urls && result.urls[0]) || undefined
          }
        } catch {
          // Fall through without image
        }
      }

      const assetInput: CreateAssetInput = {
        campaignId: campaign.id,
        assetType: item.assetType,
        assetRef: item.scheduledDate || 'planned',
        title: item.title,
        scheduledDate: item.scheduledDate,
        status: 'scheduled',
        contentPreview: item.contentPreview,
        imageUrl,
      }
      campaignRepo.addAsset(assetInput)
    }

    const saved = campaignRepo.getById(campaign.id)

    return {
      success: true,
      widget: {
        widgetType: 'campaign-plan',
        widgetData: {
          campaign: saved,
        }
      },
      campaign: saved,
    }
  }
)
