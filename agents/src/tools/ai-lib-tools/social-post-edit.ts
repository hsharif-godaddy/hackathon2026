import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { SimpleCampaignRepository } from '../../database/repositories/SimpleCampaignRepository.js';
import { SimpleCampaignContentType, isCampaignPreLaunch } from '../../database/schema.js';
import type { SimpleCampaign, SimpleCampaignContent } from '../../database/schema.js';
import { editSocialDraft } from '../../services/social/social-draft-sync.js';
import { Logger } from '../../logging/index.js';
import type { AgentsAppContext } from '../../types/agents-app-context.js';

const logger = Logger.create({ component: 'social-post-edit' });
const campaignRepo = new SimpleCampaignRepository();

export const socialPostEdit: Tool = createTool(
  `Edit a campaign social post's content BEFORE the campaign is launched.

  Use this to revise a draft social post: change its message, hashtags, or call-to-action.
  Identify the post by its campaign-content id.

  Rules:
  - You can only edit a social post while it is still a pre-launch draft. Once the
    campaign is launched the post is bound to the platform and is managed there, not here.
  - To change the scheduled date, that is handled separately (rescheduling), not by this tool.`,
  z.object({
    contentId: z.string().describe('The campaign-content id to edit.'),
    message: z.string().optional().describe('New post text/caption.'),
    hashtags: z.array(z.string()).optional().describe('Replacement hashtags (without #).'),
    callToAction: z.string().optional().describe('New call-to-action.'),
  }),
  async (input, context) => {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;
    if (!appId) {
      logger.error('social-post-edit.missing-app-id', {});
      return { success: false, error: 'App ID is required' };
    }

    const content: SimpleCampaignContent | null = campaignRepo.findContentById(input.contentId);
    if (!content) {
      return { success: false, error: `Post not found: ${input.contentId}` };
    }
    // Cross-app guard. Content rows carry no appId, so resolve the owning campaign
    // and verify it belongs to this app. Cross-app is surfaced as not-found so the
    // tool never leaks the existence of another app's content in the shared DB.
    const campaign: SimpleCampaign | null = campaignRepo.findById(content.simpleCampaignId);
    if (!campaign || campaign.appId !== appId) {
      logger.info('social-post-edit.cross-app-reject', { appId, contentId: input.contentId });
      return { success: false, error: `Post not found: ${input.contentId}` };
    }
    if (content.assetType !== SimpleCampaignContentType.Social) {
      return { success: false, error: 'This tool edits social posts only.' };
    }
    if (!isCampaignPreLaunch(campaign.status)) {
      logger.info('social-post-edit.post-launch-reject', { appId, contentId: input.contentId });
      return { success: false, error: 'Editing is off after launch; the post is now managed on the platform.' };
    }

    const contentChanged: boolean =
      input.message !== undefined || input.hashtags !== undefined || input.callToAction !== undefined;
    if (!contentChanged) {
      return {
        success: false,
        error: 'No changes provided. Specify at least one field to edit (message, hashtags, or callToAction).',
      };
    }

    const updated: SimpleCampaignContent = editSocialDraft(content, {
      message: input.message,
      hashtags: input.hashtags,
      callToAction: input.callToAction,
    });

    logger.info('social-post-edit.success', { appId, contentId: input.contentId });
    return {
      success: true,
      post: { id: updated.id, status: updated.status, rawContent: updated.rawContent },
    };
  }
);
