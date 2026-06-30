import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import type { ContextAttachment } from '@airo/shared/context-attachment';
import type { GoogleReview } from '@airo/shared/social';
import { SocialPlatform } from '../../../types/social.js';
import { SocialAssociationRepository } from '../../../database/repositories/SocialAssociationRepository.js';
import { Logger } from '../../../logging/index.js';
import { getActionService } from '../../../server/agent-runtime.js';
import type { IClientActionService } from '../../../services/ClientActionService.js';

const logger = Logger.create({ component: 'google-reviews-skill' });
const socialAssociationRepo = new SocialAssociationRepository();

type ToolContext = { metadata?: { appId?: string }; socketId?: string };

type ExecuteWorkflowOutput =
  | { phase: 'error'; success: false; error: string; recoverable: boolean }
  | { phase: 'awaiting-oauth'; action: 'connect'; platform: 'GOOGLE_BUSINESS_PROFILE'; message: string }
  | { phase: 'complete'; success: true; reviews: GoogleReview[]; averageRating?: number; totalReviewCount?: number; installSkill: true }
  | { phase: 'complete'; success: true; reviews: []; averageRating: undefined; totalReviewCount: 0; installSkill: false; message: string };

function getAppId(context: unknown): string | undefined {
  return (context as AgentsAppContext)?.metadata?.appId as string | undefined;
}

function getClient(context: unknown): IClientActionService | null {
  const socketId = (context as ToolContext)?.socketId;
  if (!socketId || typeof socketId !== 'string') return null;
  return getActionService(socketId);
}

function findGbpAssociations(appId: string) {
  return socialAssociationRepo.findByAppAndPlatform(appId, SocialPlatform.GOOGLE_BUSINESS_PROFILE);
}

export const executeWorkflowTool: SkillToolDefinition = {
  name: 'executeWorkflow',
  description:
    'Execute the full Google Reviews workflow: checks GBP connection, handles OAuth ' +
    'if needed, fetches reviews via the frontend, and returns them for component installation. ' +
    'The tool handles the entire flow deterministically. Retry on transient errors. ' +
    'Pass forceReconnect: true to detach the current business and let the user connect a different Google Business Profile.',

  parameters: z.object({
    forceReconnect: z.boolean().optional().describe(
      'When true, initiates OAuth even if a business is already connected. ' +
      'Use when the user wants to detach the current business and connect a different one.'
    ),
  }),

  config: { timeout: 60000 },

  async execute(input, context) {
    const { forceReconnect } = input as { forceReconnect?: boolean };
    const appId = getAppId(context);

    if (!appId) {
      logger.error('google-reviews.executeWorkflow.missing-app-id', {});
      return { phase: 'error', success: false, error: 'App ID is required', recoverable: false };
    }

    try {
      const associations = findGbpAssociations(appId);

      if (associations.length === 0 || forceReconnect) {
        logger.info('google-reviews.executeWorkflow.needs-oauth', { appId, forceReconnect: !!forceReconnect });
        return {
          phase: 'awaiting-oauth',
          action: 'connect',
          platform: 'GOOGLE_BUSINESS_PROFILE' as const,
          message: forceReconnect
            ? 'Initiating reconnection to Google Business Profile. The user can select a different business.'
            : 'Google Business Profile is not connected. The user needs to authenticate via OAuth to continue.',
        };
      }

      const association = associations[0]!;

      if (associations.length > 1) {
        logger.warn('google-reviews.executeWorkflow.multi-location', {
          appId,
          count: associations.length,
          chosenSocialId: association.socialId,
        });
      }

      const clientActionService = getClient(context);
      if (!clientActionService) {
        logger.error('google-reviews.executeWorkflow.no-client-action-service', { appId });
        return { phase: 'error', success: false, error: 'Client action service unavailable', recoverable: true };
      }

      logger.info('google-reviews.executeWorkflow.fetching', { appId, socialId: association.socialId });

      const result = await clientActionService.executeAction({
        action: 'fetch_google_reviews',
        params: { socialId: association.socialId, appId },
        timeoutMs: 30000,
      });

      if (!result.success) {
        const errorMsg = result.error || 'Failed to fetch reviews';
        const isAuthFailure = /\b(token|reconnect|unauthorized|expired|forbidden|auth)\b/i.test(errorMsg);

        if (isAuthFailure) {
          logger.warn('google-reviews.executeWorkflow.auth-failure', { appId, error: errorMsg });
          return {
            phase: 'awaiting-oauth',
            action: 'connect',
            platform: 'GOOGLE_BUSINESS_PROFILE' as const,
            message: `Authentication failed: ${errorMsg}. The user needs to reconnect their Google Business Profile.`,
          };
        }

        logger.error('google-reviews.executeWorkflow.fetch-failed', { appId, error: errorMsg });
        return { phase: 'error', success: false, error: errorMsg, recoverable: true };
      }

      const data = result.result as { reviews?: GoogleReview[]; averageRating?: number; totalReviewCount?: number } | undefined;
      const reviews = data?.reviews ?? [];
      const averageRating = data?.averageRating;
      const totalReviewCount = data?.totalReviewCount ?? reviews.length;

      logger.info('google-reviews.executeWorkflow.complete', { appId, reviewCount: reviews.length, averageRating });

      if (reviews.length === 0) {
        return {
          phase: 'complete' as const,
          success: true as const,
          reviews: [] as [],
          averageRating: undefined,
          totalReviewCount: 0,
          installSkill: false as const,
          message: 'Google Business Profile is connected but no reviews were found.',
        };
      }

      return {
        phase: 'complete' as const,
        success: true as const,
        reviews,
        averageRating,
        totalReviewCount,
        installSkill: true as const,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('google-reviews.executeWorkflow.error', { appId, error });
      return { phase: 'error', success: false, error, recoverable: true };
    }
  },

  computeState(_input: unknown, output: ExecuteWorkflowOutput) {
    if (output.phase === 'error') {
      return {
        phase: 'error',
        lastError: output.error,
        updatedAt: new Date().toISOString(),
      };
    }

    if (output.phase === 'awaiting-oauth') {
      return {
        phase: 'awaiting-oauth',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    if (output.phase === 'complete') {
      return {
        phase: 'complete',
        reviewCount: output.reviews.length,
        averageRating: output.averageRating,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return null;
  },
};
