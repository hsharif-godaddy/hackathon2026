import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { SimpleCampaignRepository } from '../../database/repositories/SimpleCampaignRepository.js';
import { SocialPostRepository } from '../../database/repositories/SocialPostRepository.js';
import { SimpleCampaignContentType, isCampaignPreLaunch } from '../../database/schema.js';
import type { SimpleCampaign, SimpleCampaignContent } from '../../database/schema.js';
import { editSocialDraft } from '../../services/social/social-draft-sync.js';
import { mergeSocialRawContent } from '../../services/social/social-raw-content.js';
import { Logger } from '../../logging/index.js';
import type { AgentsAppContext } from '../../types/agents-app-context.js';
import { PostState } from '../../types/social.js';

const logger = Logger.create({ component: 'social-post-edit' });
const campaignRepo = new SimpleCampaignRepository();
const socialPostRepo = new SocialPostRepository();

export const socialPostEdit: Tool = createTool(
  `Edit a social post draft's content (campaign or standalone).

  Use this to revise a draft social post: change its message, hashtags, or call-to-action.
  Identify the post by its campaign-content id (preferred) or standalone post id.

  Rules:
  - You can only edit a social post while it is still a draft.
    - Campaign-backed posts are editable only while their campaign is pre-launch.
    - Standalone posts are editable only while their state is DRAFT.
  - To change the scheduled date, that is handled separately (rescheduling), not by this tool.`,
  z.object({
    contentId: z.string().describe('The campaign-content id (preferred) or standalone social post id to edit.'),
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

    const contentChanged: boolean =
      input.message !== undefined || input.hashtags !== undefined || input.callToAction !== undefined;
    if (!contentChanged) {
      return {
        success: false,
        error: 'No changes provided. Specify at least one field to edit (message, hashtags, or callToAction).',
      };
    }

    const content: SimpleCampaignContent | null = campaignRepo.findContentById(input.contentId);
    if (content) {
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

    const standalonePost = socialPostRepo.findById(input.contentId);
    if (!standalonePost || standalonePost.appId !== appId) {
      return { success: false, error: `Post not found: ${input.contentId}` };
    }
    if (standalonePost.state !== PostState.DRAFT) {
      return { success: false, error: 'Editing is off after launch; the post is now managed on the platform.' };
    }

    const rawPayload: string =
      typeof standalonePost.payload === 'string'
        ? standalonePost.payload
        : JSON.stringify(standalonePost.payload ?? {});
    const parsedPayload: { message?: unknown } = (() => {
      try {
        return JSON.parse(rawPayload) as { message?: unknown };
      } catch {
        return {};
      }
    })();
    const currentMessage: string = typeof parsedPayload.message === 'string' ? parsedPayload.message : '';
    const next = mergeSocialRawContent(
      rawPayload,
      { message: input.message, hashtags: input.hashtags, callToAction: input.callToAction },
      currentMessage,
    );
    socialPostRepo.update(standalonePost.id, { payload: next });

    logger.info('social-post-edit.success', { appId, contentId: input.contentId });
    return {
      success: true,
      post: { id: standalonePost.id, status: standalonePost.state, rawContent: next },
    };
  }
);
