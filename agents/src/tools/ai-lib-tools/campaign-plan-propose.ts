import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'campaign-plan-propose-tool' })

const plannedAssetSchema = z.object({
  assetType: z.enum(['landing-page', 'banner', 'blog', 'social', 'email', 'ad']).describe('Content channel'),
  title: z.string().describe('Asset title or headline'),
  scheduledDate: z.string().optional().describe('Planned publish date (YYYY-MM-DD)'),
  description: z.string().optional().describe('Brief description of what this content covers'),
})

const campaignPlanProposeInputSchema = z.object({
  name: z.string().describe('Campaign name'),
  offer: z.string().describe('The campaign offer or goal'),
  startDate: z.string().describe('Campaign start date (YYYY-MM-DD)'),
  endDate: z.string().describe('Campaign end date (YYYY-MM-DD)'),
  campaignType: z.enum(['landing-page', 'banner', 'content-only']).describe('Type of site artifact'),
  landingPagePath: z.string().optional().describe('Route path if a landing page is planned'),
  assets: z.array(plannedAssetSchema).min(1).describe('List of planned content pieces'),
})

/**
 * Campaign Plan Propose Tool
 *
 * Presents the campaign plan to the user for approval. This tool STOPS the agent
 * (via stopAfterTools) — the user must approve or request changes before generation begins.
 *
 * The frontend renders this as a plan card with "Approve" and "Make changes" buttons.
 * The user's choice is sent back as a message to the agent.
 */
export const campaignPlanProposeTool: Tool = createTool(
  `Present a campaign plan to the user for approval. This STOPS the agent and waits for the user to approve or request changes.

WHEN TO CALL: After the user answers your discovery questions (from askQuestion in CLARIFY) and you have all the information needed to build a plan. Call this tool with the full plan details.

WHAT HAPPENS: The plan is rendered inline in the chat as a conversational summary (bullet list of assets with dates) followed by approval chips. It looks like chat text, not a card. The agent STOPS and waits.

HOW TO USE: Write a brief conversational intro in your message text (e.g. "Here's what I'm thinking for your campaign:") then call this tool. The tool renders the plan details and approval buttons. Do NOT duplicate the plan details in your message text — just the intro sentence.

CRITICAL RULES:
- Call this tool ONCE per plan presentation (initial or revised)
- Do NOT list the plan assets in your message text — the tool renders them
- Do NOT call any other tools in the same turn as this tool
- If the user requests changes, adjust the plan and call this tool AGAIN with the updated plan
- Only proceed to content generation after the user clicks "Approve"
- NEVER generate content (handoff, socialPostCreate, media, etc.) without this tool having been called AND approved`,
  campaignPlanProposeInputSchema,
  async (input, context) => {
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
          campaignType: input.campaignType,
          landingPagePath: input.landingPagePath,
          assets: input.assets,
        },
      },
      message: `Campaign plan "${input.name}" presented for approval. Waiting for user response.`,
    }
  }
)
