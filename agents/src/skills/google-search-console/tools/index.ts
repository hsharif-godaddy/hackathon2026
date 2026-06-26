import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import { SocialPlatform } from '../../../types/social.js';
import { SocialAssociationRepository } from '../../../database/repositories/SocialAssociationRepository.js';
import { AppMetadataRepository } from '../../../database/repositories/AppMetadataRepository.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.create({ component: 'google-search-console-skill' });
const socialAssociationRepo = new SocialAssociationRepository();
const metadataRepo = new AppMetadataRepository();

type CheckGscConnectionOutput =
  | { success: false; error: string; recoverable: boolean }
  | { action: 'requiresConnection'; success: false; workflowPending: true; message: string }
  | { action: 'pendingVerification'; success: false; workflowPending: true; message: string }
  | { connected: true; success: true; socialId: string };

/**
 * checkGscConnection
 *
 * Checks if Google Search Console is connected for this app. If not, returns a
 * signal instructing the LLM to call social-platform__socialConnect directly.
 *
 * computeState tracks:
 * - pending-gsc-connection: OAuth initiated, waiting for user to publish + verify
 * - connected: GSC association exists in DB
 * - connection-check-failed: Error occurred, can retry
 */
export const checkGscConnectionTool: SkillToolDefinition = {
  name: 'checkGscConnection',
  description:
    'Check if Google Search Console is connected for this app. ' +
    'If not connected, returns a signal to initiate OAuth via social-platform__socialConnect. ' +
    'Call this first before guiding the user through GSC setup.',

  parameters: z.object({}),

  async execute(_input, context) {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      logger.error('google-search-console.checkGscConnection.missing-app-id', {});
      return {
        success: false,
        error: 'App ID is required',
        recoverable: false,
      };
    }

    try {
      const associations = socialAssociationRepo.findByAppAndPlatform(
        appId,
        SocialPlatform.GOOGLE_SEARCH_CONSOLE
      );

      if (associations.length === 0) {
        // Check whether OAuth has already been done but verification is still pending.
        // SeoPanel writes googleVerificationToken to app metadata after tag injection;
        // if that key exists but there's no association yet, we're in the verify step.
        const metadata = metadataRepo.get(appId);
        const hasPendingToken = typeof metadata.googleVerificationToken === 'string' &&
          metadata.googleVerificationToken.length > 0;

        if (hasPendingToken) {
          logger.info('google-search-console.checkGscConnection.pending-verification', { appId });
          return {
            action: 'pendingVerification',
            success: false,
            workflowPending: true,
            message:
              'Google verification tag has been added to your site but ownership is not yet confirmed. ' +
              'The user needs to click "Publish site" then "Verify with Google" in the chat widget to complete the connection.',
          };
        }

        logger.info('google-search-console.checkGscConnection.not-connected', { appId });
        return {
          action: 'requiresConnection',
          success: false,
          workflowPending: true,
          message:
            'No Google Search Console connection found. ' +
            'Call social-platform__socialConnect({ platform: "GOOGLE_SEARCH_CONSOLE" }) ' +
            'to initiate OAuth. The chat widget handles publish and verify — stay silent after calling.',
        };
      }

      const association = associations[0]!;
      logger.info('google-search-console.checkGscConnection.connected', {
        appId,
        socialId: association.socialId,
      });

      return {
        connected: true,
        success: true,
        socialId: association.socialId,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('google-search-console.checkGscConnection.error', { appId, error });
      return {
        success: false,
        error,
        recoverable: true,
      };
    }
  },

  computeState(_input: unknown, output: CheckGscConnectionOutput) {
    if ('error' in output) {
      return {
        workflowState: 'connection-check-failed',
        lastError: output.error,
        nextStep: 'retry-connection-check',
        updatedAt: new Date().toISOString(),
      };
    }

    if ('action' in output && output.action === 'pendingVerification') {
      return {
        workflowState: 'pending-verification',
        nextStep: 'guide-verify-in-chat',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    if ('workflowPending' in output) {
      return {
        workflowState: 'pending-gsc-connection',
        nextStep: 'guide-publish-and-verify',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    if ('connected' in output) {
      return {
        workflowState: 'connected',
        socialId: output.socialId,
        nextStep: 'inform-user',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return null;
  },
};
