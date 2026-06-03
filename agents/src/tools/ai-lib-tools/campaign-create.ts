import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { CampaignRepository } from '../../database/repositories/CampaignRepository.js'
import type { CreateAssetInput } from '../../database/repositories/CampaignRepository.js'
import { MediaSearchTool } from '../media-search-tool.js'

const campaignRepo = new CampaignRepository()
const mediaSearch = new MediaSearchTool()

export const campaignCreateTool: Tool = createTool(
  `Save generated campaign content and mark the campaign as ready for launch. Call this AFTER all campaign assets have been generated (landing page built, blog posts written, social posts created).

This tool finds the existing campaign plan (created by campaignPlanCreate) and updates it to "ready" status with the actual generated assets. It does NOT create a new campaign — it completes the existing one.

The campaign will then show "Launch Campaign" button for the user to schedule publishing.`,
  z.object({
    name: z.string().describe('Campaign name — must match the existing plan name'),
    campaignType: z.enum(['landing-page', 'banner', 'content-only']).describe('Type of site artifact created'),
    offer: z.string().describe('The campaign offer/message (e.g. "25% off everything")'),
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    landingPagePath: z.string().optional().describe('Route path if landing page was created (e.g. "/labor-day-sale")'),
    assets: z.array(z.object({
      assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Type of asset'),
      assetRef: z.string().describe('Reference: file path for blogs/pages, post ID for social, or description for email/ad'),
      title: z.string().describe('Asset title or headline'),
      scheduledDate: z.string().optional().describe('Scheduled publish/send date (YYYY-MM-DD)'),
      status: z.enum(['draft', 'scheduled', 'published', 'sent']).optional().describe('Current status'),
      contentPreview: z.string().optional().describe('Brief content preview (first 100 chars)'),
      imageUrl: z.string().optional().describe('URL of the image used for this content (pass the actual media URL selected during generation)'),
    })).describe('All campaign assets to track'),
  }),
  async (args, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      return JSON.stringify({ success: false, error: 'No appId in context' })
    }

    const existing = campaignRepo.listByApp(appId)
    const draftCampaign = existing.find(c => c.status === 'draft' || c.status === 'ready')

    if (draftCampaign) {
      campaignRepo.update(draftCampaign.id, {
        status: 'ready',
        landingPagePath: args.landingPagePath,
      })

      campaignRepo.deleteAssetsByCampaign(draftCampaign.id)

      for (const asset of args.assets) {
        let imageUrl: string | undefined
        try {
          const searchQuery = `${asset.title} ${args.name}`.slice(0, 60)
          const result = await mediaSearch.searchMedia(searchQuery, 'image', 1, appId)
          if (result.success) {
            imageUrl = result.url || (result.urls && result.urls[0]) || undefined
          }
        } catch {
          // Fall through without image
        }

        const assetInput: CreateAssetInput = {
          campaignId: draftCampaign.id,
          assetType: asset.assetType,
          assetRef: asset.assetRef,
          title: asset.title,
          scheduledDate: asset.scheduledDate,
          status: asset.status || 'scheduled',
          contentPreview: asset.contentPreview,
          imageUrl,
        }
        campaignRepo.addAsset(assetInput)
      }

      const saved = campaignRepo.getById(draftCampaign.id)
      return {
        success: true,
        widget: {
          widgetType: 'campaign-plan',
          widgetData: { campaign: saved }
        },
        campaign: saved,
      }
    }

    const campaign = campaignRepo.create({
      appId,
      name: args.name,
      campaignType: args.campaignType,
      offer: args.offer,
      startDate: args.startDate,
      endDate: args.endDate,
      landingPagePath: args.landingPagePath,
      status: 'ready',
    })

    for (const asset of args.assets) {
      let imageUrl: string | undefined = asset.imageUrl
      if (!imageUrl) {
        try {
          const searchQuery = `${asset.title} ${args.name}`.slice(0, 60)
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
        assetType: asset.assetType,
        assetRef: asset.assetRef,
        title: asset.title,
        scheduledDate: asset.scheduledDate,
        status: asset.status || 'scheduled',
        contentPreview: asset.contentPreview,
        imageUrl,
      }
      campaignRepo.addAsset(assetInput)
    }

    const saved = campaignRepo.getById(campaign.id)
    return {
      success: true,
      widget: {
        widgetType: 'campaign-plan',
        widgetData: { campaign: saved }
      },
      campaign: saved,
    }
  }
)
