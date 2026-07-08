import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Logger } from '../../logging/index.js';
import { SocialAssociationRepository } from '../../database/repositories/SocialAssociationRepository.js';
import { SocialPostRepository } from '../../database/repositories/SocialPostRepository.js';
import type { AgentsAppContext } from '../../types/agents-app-context.js';
import { SocialPlatform } from '../../types/social.js';
import type { ContextAttachment } from '@airo/shared/context-attachment';
import type { SocialPost } from '../../types/social-posts.js';

const logger = Logger.create({ component: 'social-post-publish' });
const socialAssociationRepo = new SocialAssociationRepository();
const socialPostRepo = new SocialPostRepository();
const publishPlatforms = ['facebook', 'instagram'] as const;
type PublishPlatformInput = (typeof publishPlatforms)[number];

interface PendingPublish {
  publishId?: string;
  platforms: PublishPlatformInput[];
  platformData?: Array<{
    platform: PublishPlatformInput;
    message: string;
    imageUrls: string[];
    scheduledAt?: Date;
  }>;
  message: string;
  imageUrls: string[];
  scheduledAt?: Date;
}

interface SocialPublishReadyData {
  platform: PublishPlatformInput;
  platforms?: PublishPlatformInput[];
  connectionVerified: boolean;
  pendingPublish: PendingPublish;
  postData: SocialPost;
}

interface SocialPostTargetData {
  contentId: string;
}

interface PublishToolInput {
  platform?: PublishPlatformInput;
  scheduledAt?: string;
}

function toSocialPlatform(platform: PublishPlatformInput): SocialPlatform {
  if (platform === 'instagram') {
    return SocialPlatform.INSTAGRAM;
  }
  return SocialPlatform.FACEBOOK;
}

function formatPlatform(platform: SocialPlatform): string {
  if (platform === SocialPlatform.FACEBOOK) {
    return 'Facebook';
  }
  if (platform === SocialPlatform.INSTAGRAM) {
    return 'Instagram';
  }
  return platform;
}

function getHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function formatHashtags(hashtags: string[]): string {
  if (hashtags.length === 0) {
    return '';
  }
  return hashtags.map((tag) => `#${tag}`).join(' ');
}

export const socialPostPublish: Tool = createTool(
  `Publish or schedule a social media post to Facebook or Instagram.

This tool triggers the publish widget to post content to connected social platforms. It:
- Generates a unique publishId for tracking the publish operation
- Triggers the publish widget that handles platform connection checks and posting/scheduling
- Shows real-time status and results to the user
- Accepts optional parameter: platform ('facebook' | 'instagram') for standalone publish requests without social_publish_ready context
- Accepts optional parameter: scheduledAt (ISO datetime) for standalone schedule requests

IMPORTANT:
- Post content is already captured in frontend state from the preview modal
- Widget handles connection flow, API calls, and status display
- Stay silent after calling this tool - let the widget show the status
- Only respond after user confirms completion
- When user sends "Post {StyleLabel} to {Platform}" (immediate) OR "Schedule {StyleLabel} for {Platform} on {DateTime}" (scheduled), the message includes a social_publish_ready context attachment indicating the frontend has already verified the platform connection exists

Use this when user wants to publish or schedule a post they've created and reviewed.`,
  z.object({
    platform: z.enum(publishPlatforms).optional().describe('Target platform for standalone publish requests when social_publish_ready context is not present.'),
    scheduledAt: z.string().datetime({ offset: true }).optional().describe('Scheduled publish datetime (ISO 8601) for standalone schedule requests. Omit for publish now.'),
  }),
  async (input, context) => {
    const toolInput = input as PublishToolInput;
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

    let pendingPublish = socialPublishContext?.data?.pendingPublish;
    let postData = socialPublishContext?.data?.postData;

    logger.info('social-post-publish.trigger', {
      appId,
      publishId,
      platform: socialPublishContext?.data?.platform,
      hasPostData: !!postData,
    });

    if (!socialPublishContext) {
      const requestedPlatformInput = toolInput.platform;
      const requestedPlatform = requestedPlatformInput ? toSocialPlatform(requestedPlatformInput) : undefined;
      const scheduledAt: Date | undefined = toolInput.scheduledAt ? new Date(toolInput.scheduledAt) : undefined;

      if (!requestedPlatform) {
        logger.warn('social-post-publish.standalone.missing-platform', {
          appId,
          publishId,
        });
        return {
          action: 'publish',
          success: false,
          error: 'Specify platform (facebook or instagram) before publishing.',
          message: 'Specify platform (facebook or instagram) before publishing.',
        };
      }

      const associations = socialAssociationRepo.findByAppAndPlatform(appId, requestedPlatform);
      if (associations.length === 0) {
        logger.info('social-post-publish.standalone.missing-connection', {
          appId,
          publishId,
          platform: requestedPlatform,
        });
        return {
          action: 'publish',
          success: false,
          error: `Connect to ${formatPlatform(requestedPlatform)} first.`,
          message: `Connect to ${formatPlatform(requestedPlatform)} first.`,
        };
      }

      const socialPostTarget = contextAttachments?.find(
        (att): att is ContextAttachment<SocialPostTargetData> => att.type === 'social_post_target'
      );
      if (!socialPostTarget?.data?.contentId) {
        logger.warn('social-post-publish.standalone.missing-target', {
          appId,
          publishId,
        });
        return {
          action: 'publish',
          success: false,
          error: 'Select a social post first, then try publishing again.',
          message: 'Select a social post first, then try publishing again.',
        };
      }

      const standalonePost = socialPostRepo.findById(socialPostTarget.data.contentId);
      if (!standalonePost || standalonePost.appId !== appId) {
        logger.warn('social-post-publish.standalone.post-not-found', {
          appId,
          publishId,
          contentId: socialPostTarget.data.contentId,
          hasPost: !!standalonePost,
          postAppId: standalonePost?.appId,
        });
        return {
          action: 'publish',
          success: false,
          error: 'Selected social post was not found.',
          message: 'Selected social post was not found.',
        };
      }

      const payload = standalonePost.payload as unknown as {
        message?: unknown;
        hashtags?: unknown;
        callToAction?: unknown;
        imageUrls?: unknown;
        images?: Array<{ url?: string }>;
        styleLabel?: unknown;
        topic?: unknown;
      };
      const payloadMessage = typeof payload.message === 'string' ? payload.message : '';
      const hashtags = getHashtags(payload.hashtags);
      const callToAction = typeof payload.callToAction === 'string' ? payload.callToAction : '';
      const imageUrls = Array.isArray(payload.imageUrls)
        ? payload.imageUrls.filter((url): url is string => typeof url === 'string')
        : Array.isArray(payload.images)
          ? payload.images.map((img) => img.url).filter((url): url is string => typeof url === 'string')
          : [];
      const message = [payloadMessage, callToAction, formatHashtags(hashtags)].filter(Boolean).join('\n\n');
      const platform = requestedPlatform === SocialPlatform.FACEBOOK ? 'facebook' : 'instagram';

      pendingPublish = {
        platforms: [platform],
        platformData: [
          {
            platform,
            message,
            imageUrls,
            ...(scheduledAt ? { scheduledAt } : {}),
          },
        ],
        message,
        imageUrls,
        ...(scheduledAt ? { scheduledAt } : {}),
      };
      postData = {
        id: standalonePost.id,
        styleLabel: typeof payload.styleLabel === 'string' ? payload.styleLabel : 'Social Post',
        content: payloadMessage,
        hashtags,
        platform,
        ...(callToAction ? { callToAction } : {}),
        topic: typeof payload.topic === 'string' ? payload.topic : 'social',
      };
    }

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
