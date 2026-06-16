import { z } from 'zod'
import type { SkillToolDefinition } from '@airo/ai-skills'

import { Logger } from '../../../logging/index.js'
import { SimpleCampaignRepository } from '../../../database/repositories/SimpleCampaignRepository.js'
import type { CreateSimpleCampaignParams, CreateSimpleCampaignContentParams } from '../../../database/repositories/SimpleCampaignRepository.js'
import { SimpleCampaignStatus } from '../../../database/schema.js'
import type { SimpleCampaignContentType, SimpleCampaignContentStatus } from '../../../database/schema.js'
import { MediaSearchTool } from '../../../tools/media-search-tool.js'

const logger = Logger.create({ component: 'marketing-campaigns-tools' })

const campaignRepo = new SimpleCampaignRepository()
const mediaSearch = new MediaSearchTool()

function isCampaignsEnabled(context: any): boolean {
  return !!context?.metadata?.marketingCampaignsEnabled
}

function campaignsDisabledResult(): { success: false; error: string } {
  return { success: false, error: 'Marketing campaigns are not available.' }
}

const plannedAssetSchema = z.object({
  assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Content channel'),
  title: z.string().describe('Asset title or headline'),
  scheduledDate: z.string().optional().describe('Planned publish date (YYYY-MM-DD)'),
  description: z.string().optional().describe('Brief description of what this content covers'),
})

export const campaignPlanPropose: SkillToolDefinition = {
  name: 'campaignPlanPropose',
  description: `Present a campaign plan to the user for approval. This STOPS the agent and waits for the user to approve or request changes.

WHEN TO CALL: After the user answers your discovery questions (from askQuestion in CLARIFY) and you have all the information needed to build a plan. Call this tool with the full plan details.

WHAT HAPPENS: The plan is rendered inline in the chat as a conversational summary (bullet list of assets with dates) followed by approval chips. The agent STOPS and waits.

HOW TO USE: Write a brief conversational intro in your message text then call this tool. The tool renders the plan details and approval buttons. Do NOT duplicate the plan details in your message text.

CRITICAL RULES:
- Call this tool ONCE per plan presentation (initial or revised)
- Do NOT list the plan assets in your message text — the tool renders them
- Do NOT call any other tools in the same turn as this tool
- If the user requests changes, adjust the plan and call this tool AGAIN with the updated plan
- Only proceed to content generation after the user clicks "Approve"`,
  parameters: z.object({
    name: z.string().describe('Campaign name'),
    offer: z.string().describe('The campaign offer or goal — keep to 5 words or fewer (e.g. "Increase revenue by 2x")'),
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    assets: z.array(plannedAssetSchema).min(1).describe('List of planned content pieces'),
    assumptions: z.array(z.string()).min(1).describe('3-4 short plain-language assumptions you inferred about the business (audience, main goal, what to feature). Rendered on the card under "Here\'s what I\'m assuming — tell me if any of this is off" so the owner can correct a wrong guess before anything is built.'),
    whyThisMix: z.string().describe('One or two plain sentences explaining why this channel mix serves their goal and what the key assets do (e.g. landing page = one place to buy, blog = search traffic over time, social = reach your followers). No jargon.'),
    expectation: z.string().describe('A rough, directional, honest expectation — a ballpark, NEVER precise numbers or guarantees (e.g. "a small first wave of visitors and a handful of early sales, with the blog building over the following weeks"). Frame as depending on their audience and offer.'),
  }),
  config: { stopAfter: true },
  async execute(input, context) {
    if (!isCampaignsEnabled(context)) {
      logger.warn('campaign-plan-propose.feature_disabled', { appId: context?.metadata?.appId })
      return campaignsDisabledResult()
    }

    const appId = context?.metadata?.appId as string | undefined

    logger.info('campaign-plan-propose.called', {
      appId,
      campaignName: input.name,
      assetCount: input.assets.length,
    })

    return {
      success: true,
      widgetType: 'campaign-plan-propose',
      widgetData: {
        type: 'campaign-plan-propose',
        plan: {
          name: input.name,
          offer: input.offer,
          startDate: input.startDate,
          endDate: input.endDate,
          assets: input.assets,
          assumptions: input.assumptions,
          whyThisMix: input.whyThisMix,
          expectation: input.expectation,
        },
      },
      message: `Campaign plan "${input.name}" presented for approval. Waiting for user response.`,
    }
  }
}

export const campaignPlanCreate: SkillToolDefinition = {
  name: 'campaignPlanCreate',
  description: `Save a completed campaign and render the campaign artifact card with a "Launch Campaign" button.

CRITICAL TIMING: Call this tool ONLY in the SUMMARY step — AFTER all content has been fully generated (landing page built, blog posts written, social posts created, email/ad copy written). This is the LAST tool you call in the campaign flow.

DO NOT call this tool:
- During the planning/discovery phase
- Before the user approves the plan
- Before content generation is complete`,
  parameters: z.object({
    name: z.string().describe('Campaign name'),
    offer: z.string().describe('The campaign offer or goal — keep to 5 words or fewer (e.g. "Increase revenue by 2x")'),
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    plannedContent: z.array(z.object({
      assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Content channel'),
      title: z.string().describe('Planned content title or headline'),
      scheduledDate: z.string().optional().describe('Planned publish date (YYYY-MM-DD)'),
      contentPreview: z.string().optional().describe('Brief description of what this content will cover'),
      imageUrl: z.string().optional().describe('URL of the image used for this content piece'),
      status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional().describe("Publish status shown on the card badge. Use 'scheduled' for built site assets (landing page, blog) that go out at launch, and 'draft' for social/email/ad that still need the user to publish. Never 'published' before the user launches."),
    })).describe('List of planned content items for the campaign'),
  }),
  async execute(args, context) {
    if (!isCampaignsEnabled(context)) {
      logger.warn('campaign-plan-create.feature_disabled', { appId: context?.metadata?.appId })
      return campaignsDisabledResult()
    }

    const appId = context?.metadata?.appId as string | undefined

    if (!appId) {
      return JSON.stringify({ success: false, error: 'No appId in context' })
    }

    const existingDrafts = campaignRepo.findByAppId(appId).filter(c => c.status === 'draft')
    for (const draft of existingDrafts) {
      campaignRepo.delete(draft.id)
    }

    const campaignInput: CreateSimpleCampaignParams = {
      appId,
      name: args.name,
      offer: args.offer,
      startDate: args.startDate,
      endDate: args.endDate,
    }

    const campaign = campaignRepo.create(campaignInput)

    // campaignPlanCreate is the terminal SUMMARY tool; its card shows a "Launch
    // Campaign" button. launch() requires status 'ready' (not 'draft'), so move the
    // freshly-created draft to ready here. transition() returns the updated campaign,
    // so we reuse it for the widget instead of re-reading from the DB.
    const readyCampaign = campaignRepo.transition(campaign.id, SimpleCampaignStatus.Ready)

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

      // contentRefId holds a real content identifier only; it is intentionally left
      // null here. These rows are the card's tracking projection (title/type/date/
      // status) — the pointer to the actual content row is captured later when a
      // resolver wires asset_type + contentRefId to the live content.
      const assetInput: CreateSimpleCampaignContentParams = {
        simpleCampaignId: campaign.id,
        assetType: item.assetType as SimpleCampaignContentType,
        title: item.title,
        scheduledDate: item.scheduledDate,
        status: (item.status ?? 'scheduled') as SimpleCampaignContentStatus,
        contentPreview: item.contentPreview,
        imageUrl,
      }
      campaignRepo.addContent(assetInput)
    }

    return {
      success: true,
      widget: {
        widgetType: 'campaign-plan',
        widgetData: { campaign: readyCampaign },
      },
      campaign: readyCampaign,
    }
  }
}

export const campaignCreate: SkillToolDefinition = {
  name: 'campaignCreate',
  description: `Save a generated campaign and mark it ready for launch. Call this AFTER all campaign assets have been generated (landing page built, blog posts written, social posts created).

This tool persists the campaign record together with its actual generated assets (each asset carries a real contentRef) and marks it "ready".`,
  parameters: z.object({
    name: z.string().describe('Campaign name — must match the existing plan name'),
    offer: z.string().describe('The campaign offer or goal — keep to 5 words or fewer (e.g. "Increase revenue by 2x")'),
    startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
    endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
    assets: z.array(z.object({
      assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Type of asset'),
      externalRef: z.string().describe('Reference: file path for blogs/pages, post ID for social, or description for email/ad'),
      title: z.string().describe('Asset title or headline'),
      scheduledDate: z.string().optional().describe('Scheduled publish/send date (YYYY-MM-DD)'),
      status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional().describe('Current status'),
      contentPreview: z.string().optional().describe('Brief content preview'),
      imageUrl: z.string().optional().describe('URL of the image used for this content'),
    })).describe('All campaign assets to track'),
  }),
  async execute(args, context) {
    if (!isCampaignsEnabled(context)) {
      logger.warn('campaign-create.feature_disabled', { appId: context?.metadata?.appId })
      return campaignsDisabledResult()
    }

    const appId = context?.metadata?.appId as string | undefined

    if (!appId) {
      return JSON.stringify({ success: false, error: 'No appId in context' })
    }

    // Create the campaign and attach its (already-generated, real) content. We do NOT
    // look up and reuse a prior draft: that made the result depend on there being
    // exactly one draft, and forced a delete-then-recreate of placeholder content.
    // Each call persists a fresh campaign with the real assets it was given.
    const campaign = campaignRepo.create({
      appId,
      name: args.name,
      offer: args.offer,
      startDate: args.startDate,
      endDate: args.endDate,
    })

    const readyCampaign = campaignRepo.transition(campaign.id, SimpleCampaignStatus.Ready)

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

      const assetInput: CreateSimpleCampaignContentParams = {
        simpleCampaignId: campaign.id,
        assetType: asset.assetType as SimpleCampaignContentType,
        contentRefId: asset.externalRef,
        title: asset.title,
        scheduledDate: asset.scheduledDate,
        status: (asset.status || 'scheduled') as SimpleCampaignContentStatus,
        contentPreview: asset.contentPreview,
        imageUrl,
      }
      campaignRepo.addContent(assetInput)
    }

    return {
      success: true,
      widget: {
        widgetType: 'campaign-plan',
        widgetData: { campaign: readyCampaign },
      },
      campaign: readyCampaign,
    }
  }
}

export const tools: SkillToolDefinition[] = [
  campaignPlanPropose,
  campaignPlanCreate,
  campaignCreate,
]
