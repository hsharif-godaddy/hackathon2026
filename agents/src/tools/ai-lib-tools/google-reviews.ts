import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { SocialPlatform, GOOGLE_REVIEWS_READY } from '../../types/social.js';
import { SocialAssociationRepository } from '../../database/repositories/SocialAssociationRepository.js';
import { Logger } from '../../logging/index.js';
import type { AgentsAppContext } from '../../types/websocket-context.js';
import type { ContextAttachment } from '@airo/shared/context-attachment';
import type { GoogleReview } from '@airo/shared/social';

const logger = Logger.create({ component: 'google-reviews' });

const socialAssociationRepo = new SocialAssociationRepository();

interface GoogleReviewsReadyData {
  reviews: GoogleReview[];
  averageRating?: number;
  totalReviewCount?: number;
}

export const googleReviews: Tool = createTool(
  `Fetch Google Business Profile reviews for the current app and return them for site embedding.

This tool works in two passes:
- Pass 1: Checks if Google Business Profile is connected, then signals the frontend to fetch reviews via the browser-side social API. Stay silent and wait.
- Pass 2: After the frontend sends back a google_reviews_ready context attachment, reads the reviews and returns them so you can generate a static GoogleReviews component.

USAGE:
1. Call this tool — it will either return an error (not connected) or a fetchReviews signal.
2. After frontend fetches and returns reviews, call this tool again — it returns the reviews data.
3. Use the reviews to install and configure the GoogleReviews component.

IMPORTANT: Google Business Profile must be connected first (load the social-platform skill to connect).`,
  z.object({}),
  async (_input, context) => {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!agentContext?.metadata?.googleReviewsEnabled) {
      logger.warn('google-reviews.feature-disabled', { appId: appId || 'unknown' });
      return { success: false, error: 'Google Reviews feature is not enabled for this account.' };
    }

    if (!appId) {
      logger.error('google-reviews.missing-app-id', {});
      return { success: false, error: 'App ID is required', reviews: [] };
    }

    // Pass 2: context attachment present → return reviews to agent
    const contextAttachments = agentContext?.contextAttachments;
    const reviewsContext = contextAttachments?.find(
      (att): att is ContextAttachment<GoogleReviewsReadyData> => att.type === GOOGLE_REVIEWS_READY
    );

    if (reviewsContext) {
      const { reviews, averageRating, totalReviewCount } = reviewsContext.data;
      logger.info('google-reviews.context-read', { appId, count: reviews.length });
      return {
        success: true,
        reviews,
        averageRating,
        totalReviewCount,
      };
    }

    // Pass 1: check connection, return fetchReviews signal
    const associations = socialAssociationRepo.findByAppAndPlatform(appId, SocialPlatform.GOOGLE_BUSINESS_PROFILE);

    if (associations.length === 0) {
      logger.warn('google-reviews.not-connected', { appId });
      return {
        success: false,
        error: 'No Google Business Profile connection found. Ask the user to connect their Google Business Profile first.',
        reviews: [],
      };
    }

    const association = associations[0]!;

    if (associations.length > 1) {
      logger.warn('google-reviews.multi-location', { appId, count: associations.length, chosenSocialId: association.socialId });
    }

    logger.info('google-reviews.signal', { appId, socialId: association.socialId });

    return {
      action: 'fetchReviews',
      success: true,
      appId,
      socialId: association.socialId,
      locationCount: associations.length,
    };
  }
);
