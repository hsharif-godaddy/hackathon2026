import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { SimpleCampaignRepository } from '../../database/repositories/SimpleCampaignRepository.js';
import { SimpleCampaignContentType, isCampaignPreLaunch } from '../../database/schema.js';
import type { SimpleCampaign, SimpleCampaignContent } from '../../database/schema.js';
import { deleteSocialDraft } from '../../services/social/social-draft-sync.js';
import { Logger } from '../../logging/index.js';
import type { AgentsAppContext } from '../../types/agents-app-context.js';

const logger = Logger.create({ component: 'social-post-delete' });
const campaignRepo = new SimpleCampaignRepository();

export const socialPostDelete: Tool = createTool(
  `Delete a campaign social post that is still a pre-launch draft.

  Identify the post by its campaign-content id.

  Rules:
  - You can only delete a social post while it is a pre-launch draft. Once the campaign
    is launched the post is bound to the platform; tell the user it must be removed on the
    platform itself.`,
  z.object({
    contentId: z.string().describe('The campaign-content id to delete.'),
  }),
  async (input, context) => {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;
    if (!appId) {
      logger.error('social-post-delete.missing-app-id', {});
      return { success: false, error: 'App ID is required' };
    }

    const content: SimpleCampaignContent | null = campaignRepo.findContentById(input.contentId);
    if (!content) {
      return { success: false, error: `Post not found: ${input.contentId}` };
    }
    // Cross-app guard — see socialPostEdit. Content rows carry no appId; resolve the
    // owning campaign and reject (as not-found) anything outside this app.
    const campaign: SimpleCampaign | null = campaignRepo.findById(content.simpleCampaignId);
    if (!campaign || campaign.appId !== appId) {
      logger.info('social-post-delete.cross-app-reject', { appId, contentId: input.contentId });
      return { success: false, error: `Post not found: ${input.contentId}` };
    }
    if (content.assetType !== SimpleCampaignContentType.Social) {
      return { success: false, error: 'This tool deletes social posts only.' };
    }
    if (!isCampaignPreLaunch(campaign.status)) {
      logger.info('social-post-delete.post-launch-reject', { appId, contentId: input.contentId });
      return { success: false, error: 'Deleting is off after launch; the post is now managed on the platform.' };
    }

    const deleted: boolean = deleteSocialDraft(content);
    if (!deleted) {
      return { success: false, error: 'Failed to delete post' };
    }

    logger.info('social-post-delete.success', { appId, contentId: input.contentId });
    return { success: true, contentId: input.contentId };
  }
);
