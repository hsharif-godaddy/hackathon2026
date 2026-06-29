import { AppRepository } from '../../database/repositories/AppRepository.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import {
  isInitialBuildCompleteInFunnel,
  isPostInteractionEmittedInFunnel,
  persistInitialBuildCompleteAndEmit,
  trackInitialBuildPostInteractionAsync,
} from './initial-build-funnel.js';

function isInitialBuildMarkedComplete(appId: string): boolean {
  const app = new AppRepository().findById(appId);
  return app?.initialBuildComplete ?? isInitialBuildCompleteInFunnel(appId);
}

/**
 * Backfill DB + completed_async when squash-merge tracking was missed but a prior
 * assistant turn already carried a commitHash (browser completed event path).
 */
export async function healMissedInitialBuildComplete(
  appId: string,
  conversationId: string,
): Promise<boolean> {
  if (isInitialBuildMarkedComplete(appId)) return true;

  const hadBuildCommit = await new ConversationRepository().hasAgentMessageWithCommitHash(
    conversationId,
  );
  if (!hadBuildCommit) return false;

  return persistInitialBuildCompleteAndEmit(appId);
}

/** Mirrors browser trackPostInteraction — fires once after initial build is known complete. */
export async function trackPostInteractionIfEligible(
  appId: string,
  conversationId: string,
): Promise<void> {
  if (isPostInteractionEmittedInFunnel(appId)) return;

  const buildComplete =
    isInitialBuildMarkedComplete(appId) ||
    await healMissedInitialBuildComplete(appId, conversationId);

  if (buildComplete) {
    trackInitialBuildPostInteractionAsync(appId, { buildAlreadyComplete: true });
  }
}
