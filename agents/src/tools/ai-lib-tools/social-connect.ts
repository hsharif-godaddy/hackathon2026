import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { SocialPlatform, CONNECT_REQUEST_FROM_PUBLISH } from '../../types/social.js';
import { Logger } from '../../logging/index.js';
import type { AgentsAppContext } from '../../types/websocket-context.js';
import type { ContextAttachment } from '@airo/shared/context-attachment';

const logger = Logger.create({ component: 'social-connect' });

interface SocialConnectData {
  platforms: string[];
  pendingPublish?: unknown;
  postData?: unknown;
}

export const socialConnect: Tool = createTool(
  `Connect social media platforms via OAuth authentication flow.

  This tool initiates platform connection and returns a UI widget with authentication button.

  AVAILABLE PLATFORMS:
  - Facebook (Facebook Pages)
  - Instagram (Instagram Business accounts via Facebook page)
  - Google Business Profile / GMB (reviews, locations, insights)

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
    platform: z.enum(SocialPlatform).describe('Social platform to connect'),
  }),
  async (input, context) => {
    const { platform } = input;
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

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
    const contextAttachments = agentContext?.contextAttachments;
    const connectWithPost = contextAttachments?.find(
      (att): att is ContextAttachment<SocialConnectData> => att.type === CONNECT_REQUEST_FROM_PUBLISH
    );
    const pendingPublish = connectWithPost?.data?.pendingPublish;
    const postData = connectWithPost?.data?.postData;
    const platforms = connectWithPost?.data?.platforms;  // Array of all platforms that need connecting

    logger.info('social-connect.signal', {
      appId,
      platform,
      state,
      hasPendingPost: !!postData,
      platforms,
    });

    return {
      action: 'connect',
      success: true,
      platform,
      platforms,  // Include full list for sequential flow
      appId,
      state,
      pendingPublish,
      postData,
    };
  }
);
