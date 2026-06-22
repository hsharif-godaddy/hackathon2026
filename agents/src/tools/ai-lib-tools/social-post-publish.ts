import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Logger } from '../../logging/index.js';
import type { AgentsAppContext } from '../../types/agents-app-context.js';
import type { ContextAttachment } from '@airo/shared/context-attachment';
import type { SocialPost } from '../../types/social-posts.js';

const logger = Logger.create({ component: 'social-post-publish' });

interface PendingPublish {
  publishId?: string;
  platform: 'facebook' | 'instagram';
  message: string;
  imageUrls: string[];
  scheduledAt?: Date;
}

interface SocialPublishReadyData {
  platform: 'facebook' | 'instagram';
  connectionVerified: boolean;
  pendingPublish: PendingPublish;
  postData: SocialPost;
}

export const socialPostPublish: Tool = createTool(
  `Publish or schedule a social media post to Facebook or Instagram.

This tool triggers the publish widget to post content to connected social platforms. It:
- Generates a unique publishId for tracking the publish operation
- Triggers the publish widget that handles platform connection checks and posting/scheduling
- Shows real-time status and results to the user
- Requires no parameters (post data is already in frontend state)

IMPORTANT:
- Post content is already captured in frontend state from the preview modal
- Widget handles connection flow, API calls, and status display
- Stay silent after calling this tool - let the widget show the status
- Only respond after user confirms completion
- When user sends "Post {StyleLabel} to {Platform}" (immediate) OR "Schedule {StyleLabel} for {Platform} on {DateTime}" (scheduled), the message includes a social_publish_ready context attachment indicating the frontend has already verified the platform connection exists

Use this when user wants to publish or schedule a post they've created and reviewed.`,
  z.object({}),
  async (_input, context) => {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      logger.error('social-post-publish.missing-app-id', {});
      return {
        action: 'publish',
        success: false,
        error: 'App ID is required for publishing',
      };
    }

    const publishId = randomUUID();

    const contextAttachments = agentContext?.contextAttachments;
    const socialPublishContext = contextAttachments?.find(
      (att): att is ContextAttachment<SocialPublishReadyData> => att.type === 'social_publish_ready'
    );

    const pendingPublish = socialPublishContext?.data?.pendingPublish;
    const postData = socialPublishContext?.data?.postData;

    logger.info('social-post-publish.trigger', {
      appId,
      publishId,
      platform: socialPublishContext?.data?.platform,
      hasPostData: !!postData,
    });

    return {
      action: 'publish',
      success: true,
      appId,
      publishId,
      pendingPublish,
      postData,
    };
  }
);
