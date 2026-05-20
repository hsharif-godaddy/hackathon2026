import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { SocialPlatform } from '../../types/social.js';
import { SocialAssociationRepository } from '../../database/repositories/SocialAssociationRepository.js';
import { Logger } from '../../logging/index.js';
import type { AgentsAppContext } from '../../types/websocket-context.js';

const logger = Logger.create({ component: 'social-read' });

const socialAssociationRepo = new SocialAssociationRepository();

export const socialRead: Tool = createTool(
  `Read stored social platform connections for the current app.

  Use this to check whether a platform is connected before attempting to use its data.
  Returns stored connection details (platform, socialId, createdAt).

  Useful before calling googleReviews to confirm Google Business Profile is connected.`,
  z.object({
    platform: z.enum(Object.values(SocialPlatform) as [string, ...string[]])
      .optional()
      .describe('Filter by platform. Omit to return all connections.'),
  }),
  async (input, context) => {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      logger.error('social-read.missing-app-id', {});
      return { success: false, error: 'App ID is required', connections: [] };
    }

    const platform = input.platform as SocialPlatform | undefined;

    const associations = platform
      ? socialAssociationRepo.findByAppAndPlatform(appId, platform)
      : socialAssociationRepo.findByAppId(appId);

    logger.info('social-read.success', { appId, platform, count: associations.length });

    return {
      success: true,
      connections: associations.map(a => ({
        id: a.id,
        platform: a.platform,
        socialId: a.socialId,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }
);
