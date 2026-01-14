import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { SocialPlatform } from '../../types/social.js';
import { Logger } from '../../logging/index.js';

const logger = Logger.create({ service: 'social-connect' });

export const socialConnect: Tool = createTool(
  `Connect social media platforms via OAuth authentication flow.

  This tool initiates platform connection and returns a UI widget with authentication button.

  AVAILABLE PLATFORMS:
  - Facebook (Facebook Pages)
  - Instagram (Instagram Business accounts via Facebook page)
  - Google Business Profile (Google Business location)
  - TikTok Shop (TikTok Shop only, not regular TikTok accounts)

  USAGE WORKFLOW:
  1. When user asks to connect, call socialConnect({ platform })
  2. Tool returns widget with OAuth button - stay silent, let UI handle it
  3. User completes authentication in popup window
  4. User confirms completion, you acknowledge success

  IMPORTANT NOTES:
  - Returns authentication widget signal - frontend fetches OAuth URL directly
  - Widget opens popup for secure OAuth flow
  - Do NOT provide additional instructions - widget handles everything
  - Wait for user to confirm authentication completion before proceeding

  Use this tool when user wants to connect a platform or before posting content.`,
  z.object({
    platform: z.nativeEnum(SocialPlatform).describe('Social platform to connect'),
  }),
  async (input, context) => {
    const { platform } = input;
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      logger.error('social-connect.missing-app-id', {
        platform,
      });
      return {
        action: 'connect',
        success: false,
        platform,
        error: 'App ID is required for social operations',
      };
    }

    const state = `${platform}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    // Check for pending post data (user tried to publish without connection)
    const contextAttachments = (context as any)?.contextAttachments;
    const connectWithPost = contextAttachments?.find((att: any) => att.type === 'social_connect_with_post');
    const pendingPublish = connectWithPost?.data?.pendingPublish;
    const postData = connectWithPost?.data?.postData;

    logger.info('social-connect.signal', {
      appId,
      platform,
      state,
      hasPendingPost: !!postData,
    });

    return {
      action: 'connect',
      success: true,
      platform,
      appId,
      state,
      pendingPublish,
      postData,
    };
  }
);
