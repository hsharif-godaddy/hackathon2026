import { INITIAL_BUILD_ASYNC_EVENTS } from './event-types.js';
import { postAgentLifecycleEvent } from './client.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';

interface FunnelState {
  active: boolean;
  startedEmitted: boolean;
  questionEmitted: boolean;
  handoffEmitted: boolean;
  completeEmitted: boolean;
  postInteractionEmitted: boolean;
}

/** Prod: one agent process per app — at most one entry. Local/shared runs may accumulate keys until process exit. */
const stateByApp = new Map<string, FunnelState>();

function emptyState(): FunnelState {
  return {
    active: false,
    startedEmitted: false,
    questionEmitted: false,
    handoffEmitted: false,
    completeEmitted: false,
    postInteractionEmitted: false,
  };
}

function getState(appId: string): FunnelState {
  let state = stateByApp.get(appId);
  if (!state) {
    state = emptyState();
    stateByApp.set(appId, state);
  }
  return state;
}

/** First SSE turn of the create-flow initial prompt — mirrors browser activateInitialBuildFunnel. */
export function trackInitialBuildStartedAsync(appId: string): void {
  if (!appId) return;
  const state = getState(appId);
  if (state.startedEmitted) return;

  state.active = true;
  state.startedEmitted = true;
  void postAgentLifecycleEvent(appId, INITIAL_BUILD_ASYNC_EVENTS.started);
}

/** askQuestion / suggestedResponse tool — mirrors browser trackQuestionReceived. */
export function trackInitialBuildQuestionReceivedAsync(appId: string): void {
  if (!appId) return;
  const state = getState(appId);
  if (!state.active || state.questionEmitted) return;

  state.questionEmitted = true;
  void postAgentLifecycleEvent(appId, INITIAL_BUILD_ASYNC_EVENTS.questionReceived);
}

/** Successful handoff tool — mirrors browser trackHandoff. */
export function trackInitialBuildHandoffAsync(appId: string): void {
  if (!appId) return;
  const state = getState(appId);
  if (!state.active || state.handoffEmitted) return;

  state.handoffEmitted = true;
  void postAgentLifecycleEvent(appId, INITIAL_BUILD_ASYNC_EVENTS.handoff);
}

/** First real git commit — mirrors browser postInitialBuildEvent / trackBuildComplete. */
export function trackInitialBuildCompletedAsync(appId: string): void {
  if (!appId) return;
  const state = getState(appId);
  if (state.completeEmitted) return;

  state.active = true;
  state.completeEmitted = true;
  void postAgentLifecycleEvent(appId, INITIAL_BUILD_ASYNC_EVENTS.completed);
}

/**
 * Persist initial_build_complete in SQLite, then emit completed_async.
 * Returns false when the app is missing or the DB write did not stick.
 */
export function persistInitialBuildCompleteAndEmit(appId: string): boolean {
  if (!appId) return false;
  const updated = new AppRepository().markInitialBuildComplete(appId);
  if (!updated?.initialBuildComplete) return false;
  trackInitialBuildCompletedAsync(appId);
  return true;
}

/** In-memory funnel completion — set when completed_async is emitted. */
export function isInitialBuildCompleteInFunnel(appId: string): boolean {
  return getState(appId).completeEmitted;
}

/** True after post_interaction_async was emitted for this app in-process. Does not create funnel state. */
export function isPostInteractionEmittedInFunnel(appId: string): boolean {
  if (!appId) return false;
  return stateByApp.get(appId)?.postInteractionEmitted ?? false;
}

/** User message after initial build complete — mirrors browser trackPostInteraction. */
export function trackInitialBuildPostInteractionAsync(
  appId: string,
  options?: { buildAlreadyComplete?: boolean },
): void {
  if (!appId) return;
  const state = getState(appId);
  const buildComplete = state.completeEmitted || options?.buildAlreadyComplete;
  if (!buildComplete || state.postInteractionEmitted) return;

  state.postInteractionEmitted = true;
  void postAgentLifecycleEvent(appId, INITIAL_BUILD_ASYNC_EVENTS.postInteraction);
}

/** Test-only reset — module state must not leak across vitest cases. */
export function resetInitialBuildFunnelStateForTests(): void {
  stateByApp.clear();
}
