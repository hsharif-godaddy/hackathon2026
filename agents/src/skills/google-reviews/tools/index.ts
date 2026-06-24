/**
 * Google Reviews Skill Tools
 *
 * Provides two tools for the Google reviews workflow with state management:
 *   checkConnection — verify GBP connection, initiate OAuth if needed
 *   fetchReviews — fetch reviews via two-pass mechanism (signal + context attachment)
 *
 * Each tool implements computeState() to track workflow progression and enable
 * resume-after-interruption (e.g., OAuth, errors, conversation summarization).
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import type { ContextAttachment } from '@airo/shared/context-attachment';
import type { GoogleReview } from '@airo/shared/social';
import { SocialPlatform, GOOGLE_REVIEWS_READY } from '../../../types/social.js';
import { SocialAssociationRepository } from '../../../database/repositories/SocialAssociationRepository.js';
import { Logger } from '../../../logging/index.js';
import { createGbpConnectionCheckTool } from '../../../services/social-connection-check.js';

const logger = Logger.create({ component: 'google-reviews-skill' });
const socialAssociationRepo = new SocialAssociationRepository();

interface GoogleReviewsReadyData {
  reviews: GoogleReview[];
  averageRating?: number;
  totalReviewCount?: number;
}

/**
 * FetchReviews tool output shapes
 */
type FetchReviewsOutput =
  | { success: false; error: string; reviews: []; needsReconnect: boolean }
  | { action: 'fetchReviews'; success: true; appId: string; socialId: string; locationCount: number }
  | { success: true; reviews: GoogleReview[]; averageRating?: number; totalReviewCount?: number };

/**
 * Tool 1: checkConnection
 *
 * Checks if Google Business Profile is connected. If not, returns a signal
 * instructing the LLM to call social-platform__socialConnect directly.
 *
 * Built from the shared connection-check factory
 * (agents/src/services/social-connection-check.ts) — the lookup logic is
 * shared with google-business-profile-sync; only the workflow-state `nextStep`
 * strings differ.
 *
 * computeState tracks:
 * - pending-gbp-connection: OAuth initiated, waiting for user to complete
 * - connected: GBP connected, ready to fetch reviews
 * - connection-check-failed: Error occurred, can retry
 */
export const checkConnectionTool: SkillToolDefinition = createGbpConnectionCheckTool({
  loggerComponent: 'google-reviews-skill',
  logEventPrefix: 'google-reviews',
  description:
    'Check if Google Business Profile is connected. If not connected, returns ' +
    'a signal to initiate OAuth via social-platform__socialConnect. ' +
    'Call this first before attempting to fetch reviews.',
  nextStepWhenConnected: 'fetch-reviews',
  nextStepWhenPending: 'fetch-reviews-and-install',
});

/**
 * Tool 2: fetchReviews
 *
 * Fetches Google reviews via two-pass mechanism:
 * - Pass 1: Returns fetchReviews signal → frontend fetches via browser API → context attachment
 * - Pass 2: Reads reviews from context attachment and returns them
 *
 * computeState tracks:
 * - fetching-reviews: Signal sent, waiting for context attachment
 * - reviews-fetched: Reviews successfully retrieved
 * - fetch-failed: Error (expired token, API failure)
 * - no-reviews-found: Valid response but empty reviews array
 */
export const fetchReviewsTool: SkillToolDefinition = {
  name: 'fetchReviews',
  description:
    'Fetch Google Business Profile reviews for the current app. ' +
    'Works in two passes: first returns a signal for frontend to fetch reviews, ' +
    'then reads the reviews from context attachment on second call. ' +
    'Call after confirming GBP is connected via checkConnection.',

  parameters: z.object({}),

  async execute(_input, context) {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      const error = 'App ID is required';
      logger.error('google-reviews.fetchReviews.missing-app-id', {});
      return { success: false, error, reviews: [], needsReconnect: false };
    }

    // Pass 2: Check for context attachment with reviews
    const contextAttachments = agentContext?.contextAttachments;
    const reviewsContext = contextAttachments?.find(
      (att): att is ContextAttachment<GoogleReviewsReadyData> =>
        att.type === GOOGLE_REVIEWS_READY
    );

    if (reviewsContext) {
      const { reviews, averageRating, totalReviewCount } = reviewsContext.data;
      logger.info('google-reviews.fetchReviews.context-read', {
        appId,
        count: reviews.length,
      });

      return {
        success: true,
        reviews,
        averageRating,
        totalReviewCount,
      };
    }

    // Pass 1: Check connection and return fetchReviews signal
    try {
      const associations = socialAssociationRepo.findByAppAndPlatform(
        appId,
        SocialPlatform.GOOGLE_BUSINESS_PROFILE
      );

      if (associations.length === 0) {
        const error =
          'No Google Business Profile connection found. ' +
          'Call checkConnection first to establish connection, then retry fetchReviews.';
        logger.warn('google-reviews.fetchReviews.not-connected', { appId });
        return {
          success: false,
          error,
          reviews: [],
          needsReconnect: true, // Missing connection - must connect before retrying
        };
      }

      const association = associations[0]!;

      if (associations.length > 1) {
        logger.warn('google-reviews.fetchReviews.multi-location', {
          appId,
          count: associations.length,
          chosenSocialId: association.socialId,
        });
      }

      logger.info('google-reviews.fetchReviews.signal', {
        appId,
        socialId: association.socialId,
      });

      return {
        action: 'fetchReviews',
        success: true,
        appId,
        socialId: association.socialId,
        locationCount: associations.length,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('google-reviews.fetchReviews.error', { appId, error });

      // Database errors are transient - retry without reconnecting
      return {
        success: false,
        error,
        reviews: [],
        needsReconnect: false, // Database/internal errors don't require reconnection
      };
    }
  },

  // Always update state, even on errors
  computeState(_input: unknown, output: FetchReviewsOutput) {
    // Pass 1: fetch signal sent
    if ('action' in output && output.action === 'fetchReviews') {
      return {
        workflowState: 'fetching-reviews',
        nextStep: 'wait-for-context-attachment',
        lastError: null, // Clear any previous error
        updatedAt: new Date().toISOString(),
      };
    }

    // Error cases
    if ('error' in output) {
      // Use structured flag to determine if reconnection is needed
      return {
        workflowState: 'fetch-failed',
        lastError: output.error,
        nextStep: output.needsReconnect ? 'reconnect-gbp' : 'retry-fetch',
        updatedAt: new Date().toISOString(),
      };
    }

    // Success - reviews fetched (output must have 'reviews' property now)
    if ('reviews' in output && output.reviews.length > 0) {
      return {
        workflowState: 'reviews-fetched',
        reviewCount: output.reviews.length,
        averageRating: output.averageRating,
        nextStep: 'install-component',
        lastError: null, // Clear any previous error
        updatedAt: new Date().toISOString(),
      };
    }

    // No reviews found (valid response but empty)
    if ('reviews' in output && output.reviews.length === 0) {
      return {
        workflowState: 'no-reviews-found',
        nextStep: 'inform-user',
        lastError: null, // Clear any previous error
        updatedAt: new Date().toISOString(),
      };
    }

    return null;
  },
};
