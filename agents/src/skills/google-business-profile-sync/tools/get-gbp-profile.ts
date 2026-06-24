/**
 * getGbpProfile — Google Business Profile sync skill
 *
 * Reads the customer's editable GBP listing via the two-pass client-action /
 * context-attachment round-trip (the agent can't call SocialV2Client directly —
 * it runs in app/, not agents/). Mirrors google-reviews' fetchReviews:
 *
 * - Pass 1: returns a `getGbpProfile` signal with the socialId → the frontend
 *   GbpSyncToolRenderer calls SocialV2Client.getGoogleBusinessProfile and posts
 *   a GBP_PROFILE_READY context attachment.
 * - Pass 2: reads the profile from that attachment and returns it.
 *
 * computeState tracks:
 * - fetching-profile: signal sent, waiting for the context attachment
 * - profile-fetched: profile successfully retrieved
 * - fetch-failed: error (expired token, API failure, missing connection)
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import type { ContextAttachment } from '@airo/shared/context-attachment';
import type { GoogleBusinessProfile } from '@airo/shared/social';
import { SocialPlatform, GBP_PROFILE_READY } from '../../../types/social.js';
import { SocialAssociationRepository } from '../../../database/repositories/SocialAssociationRepository.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.create({ component: 'google-business-profile-sync-skill' });
const socialAssociationRepo = new SocialAssociationRepository();

interface GbpProfileReadyData {
  profile?: GoogleBusinessProfile;
  error?: string;
}

type GetGbpProfileOutput =
  | { success: false; error: string; needsReconnect: boolean }
  | { action: 'getGbpProfile'; success: true; appId: string; socialId: string; locationCount: number }
  | { success: true; profile: GoogleBusinessProfile };

export const getGbpProfileTool: SkillToolDefinition = {
  name: 'getGbpProfile',
  description:
    'Read the connected Google Business Profile listing (name, address, phone, ' +
    'hours, website). Works in two passes: first returns a signal for the frontend ' +
    'to read the listing, then returns the profile from the context attachment on ' +
    'the second call. Call after confirming the profile is connected via checkConnection.',

  parameters: z.object({}),

  async execute(_input, context) {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      const error = 'App ID is required';
      logger.error('google-business-profile-sync.getGbpProfile.missing-app-id', {});
      return { success: false, error, needsReconnect: false };
    }

    // Pass 2: profile delivered via context attachment. Take the LATEST — a retry in
    // the same turn appends a newer one that must not be masked by an older read.
    const contextAttachments = agentContext?.contextAttachments;
    const profileContext = contextAttachments
      ?.filter((att): att is ContextAttachment<GbpProfileReadyData> => att.type === GBP_PROFILE_READY)
      .at(-1);

    if (profileContext) {
      const { profile, error } = profileContext.data;
      // The frontend reports a read failure (expired token, GBP API error, missing
      // location, network) by posting an attachment carrying `error` and no profile.
      // Surface it instead of stalling — the round-trip's pass 2 must resolve either way.
      if (error || !profile) {
        const readError = error ?? 'Failed to read the Google Business Profile listing.';
        logger.warn('google-business-profile-sync.getGbpProfile.context-error', { appId, error: readError });
        return { success: false, error: readError, needsReconnect: /401|unauthor|token/i.test(readError) };
      }
      logger.info('google-business-profile-sync.getGbpProfile.context-read', { appId });
      return { success: true, profile };
    }

    // Pass 1: verify connection and emit the getGbpProfile signal
    try {
      const associations = socialAssociationRepo.findByAppAndPlatform(
        appId,
        SocialPlatform.GOOGLE_BUSINESS_PROFILE
      );

      if (associations.length === 0) {
        const error =
          'No Google Business Profile connection found. ' +
          'Call checkConnection first to establish connection, then retry getGbpProfile.';
        logger.warn('google-business-profile-sync.getGbpProfile.not-connected', { appId });
        return { success: false, error, needsReconnect: true };
      }

      const association = associations[0]!;

      if (associations.length > 1) {
        logger.warn('google-business-profile-sync.getGbpProfile.multi-location', {
          appId,
          count: associations.length,
          chosenSocialId: association.socialId,
        });
      }

      logger.info('google-business-profile-sync.getGbpProfile.signal', {
        appId,
        socialId: association.socialId,
      });

      return {
        action: 'getGbpProfile',
        success: true,
        appId,
        socialId: association.socialId,
        locationCount: associations.length,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('google-business-profile-sync.getGbpProfile.error', { appId, error });
      // Database/internal errors are transient — retry without reconnecting
      return { success: false, error, needsReconnect: false };
    }
  },

  // Always update state, even on errors
  computeState(_input: unknown, output: GetGbpProfileOutput) {
    // Pass 1: signal sent
    if ('action' in output && output.action === 'getGbpProfile') {
      return {
        workflowState: 'fetching-profile',
        nextStep: 'wait-for-context-attachment',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    // Error cases
    if ('error' in output) {
      return {
        workflowState: 'fetch-failed',
        lastError: output.error,
        nextStep: output.needsReconnect ? 'reconnect-gbp' : 'retry-get-profile',
        updatedAt: new Date().toISOString(),
      };
    }

    // Success — profile fetched
    if ('profile' in output) {
      return {
        workflowState: 'profile-fetched',
        nextStep: 'get-site-business-info',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return null;
  },
};
