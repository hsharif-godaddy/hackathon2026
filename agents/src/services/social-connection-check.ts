/**
 * Shared factory for the `checkConnection` skill tool.
 *
 * Both the `google-reviews` and `google-business-profile-sync` skills need to
 * verify that a Google Business Profile is connected for the current app and,
 * if not, emit a signal instructing the LLM to initiate OAuth via
 * social-platform__socialConnect. The lookup logic, output shapes, and the
 * multi-location warning are identical; only the logger labels and the
 * workflow-state `nextStep` strings differ per skill.
 *
 * This is generic GBP-connection domain logic with no skill-specific knowledge,
 * so it lives outside any single skill directory (preserving the skills
 * Self-Containment Rule — see agents/src/skills/README.md). Each skill builds
 * its own tool from this factory and owns its own workflow-state vocabulary.
 *
 * The check runs entirely agent-side (reads the local SocialAssociation row) —
 * no client-action round-trip.
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../types/agents-app-context.js';
import { SocialPlatform } from '../types/social.js';
import { SocialAssociationRepository } from '../database/repositories/SocialAssociationRepository.js';
import { Logger } from '../logging/index.js';

const socialAssociationRepo = new SocialAssociationRepository();

/**
 * Output shapes for a connection-check tool. Stable across skills; only the
 * persisted workflow state (computeState) varies.
 */
export type CheckConnectionOutput =
  | { success: false; error: string; recoverable: boolean }
  | { action: 'requiresConnection'; success: false; workflowPending: true; message: string }
  | { connected: true; success: true; socialId: string; locationCount: number };

export interface CheckConnectionToolConfig {
  /** Logger component label, e.g. `google-reviews-skill`. */
  loggerComponent: string;
  /**
   * Log-event key prefix, e.g. `google-reviews`. Kept configurable so each
   * skill preserves its own stable event names (`<prefix>.checkConnection.*`)
   * for existing log queries/dashboards.
   */
  logEventPrefix: string;
  /** Tool description shown to the LLM. */
  description: string;
  /** `nextStep` recorded when the profile is connected. */
  nextStepWhenConnected: string;
  /** `nextStep` recorded when OAuth is still pending. */
  nextStepWhenPending: string;
}

/**
 * Build a `checkConnection` skill tool for a Google Business Profile-backed skill.
 */
export function createGbpConnectionCheckTool(
  config: CheckConnectionToolConfig
): SkillToolDefinition {
  const logger = Logger.create({ component: config.loggerComponent });

  return {
    name: 'checkConnection',
    description: config.description,

    parameters: z.object({}),

    async execute(_input, context) {
      const agentContext = context as AgentsAppContext;
      const appId = agentContext?.metadata?.appId as string;

      if (!appId) {
        const error = 'App ID is required';
        logger.error(`${config.logEventPrefix}.checkConnection.missing-app-id`, {});
        return {
          success: false,
          error,
          recoverable: false,
        };
      }

      try {
        const associations = socialAssociationRepo.findByAppAndPlatform(
          appId,
          SocialPlatform.GOOGLE_BUSINESS_PROFILE
        );

        if (associations.length === 0) {
          logger.info(`${config.logEventPrefix}.checkConnection.not-connected`, { appId });
          return {
            action: 'requiresConnection',
            success: false,
            workflowPending: true,
            message:
              'No Google Business Profile connection found. ' +
              'Call social-platform__socialConnect({ platform: "GOOGLE_BUSINESS_PROFILE" }) ' +
              'to initiate OAuth, then wait for user to complete authentication.',
          };
        }

        const association = associations[0]!;

        if (associations.length > 1) {
          logger.warn(`${config.logEventPrefix}.checkConnection.multi-location`, {
            appId,
            count: associations.length,
            chosenSocialId: association.socialId,
          });
        }

        logger.info(`${config.logEventPrefix}.checkConnection.connected`, {
          appId,
          socialId: association.socialId,
        });

        return {
          connected: true,
          success: true,
          socialId: association.socialId,
          locationCount: associations.length,
        };
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        logger.error(`${config.logEventPrefix}.checkConnection.error`, { appId, error });
        return {
          success: false,
          error,
          recoverable: true,
        };
      }
    },

    // Always update state, even on errors
    computeState(_input: unknown, output: CheckConnectionOutput) {
      // Error case - track for retry
      if ('error' in output) {
        return {
          workflowState: 'connection-check-failed',
          lastError: output.error,
          nextStep: 'retry-connection-check',
          updatedAt: new Date().toISOString(),
        };
      }

      // Not connected - OAuth needed
      if ('workflowPending' in output) {
        return {
          workflowState: 'pending-gbp-connection',
          nextStep: config.nextStepWhenPending,
          lastError: null, // Clear any previous error
          updatedAt: new Date().toISOString(),
        };
      }

      // Connected successfully
      if ('connected' in output) {
        return {
          workflowState: 'connected',
          socialId: output.socialId,
          locationCount: output.locationCount,
          nextStep: config.nextStepWhenConnected,
          lastError: null, // Clear any previous error
          updatedAt: new Date().toISOString(),
        };
      }

      return null;
    },
  };
}
