/** Agent-pushed initial-build funnel events (airo-go allowlist, ScopeApp). */
export const INITIAL_BUILD_ASYNC_EVENTS = {
  started: 'build.initial_build_started_async',
  questionReceived: 'build.initial_build_question_received_async',
  handoff: 'build.initial_build_handoff_async',
  completed: 'build.initial_build_completed_async',
  postInteraction: 'build.initial_build_post_interaction_async',
} as const;

/**
 * Event emitters (authoritative server-side paths):
 * - started: MessageExecutionService when lifecycleContext.isInitialPrompt
 * - questionReceived: askQuestion / suggestedResponse tools
 * - handoff: create-agent-handoff-tool on success
 * - completed: git-hook-service squash merge (primary); healMissedInitialBuildComplete;
 *   git-tool commit (legacy fallback when squash path did not run)
 * - postInteraction: trackPostInteractionIfEligible on non-initial user turns
 */

export type InitialBuildAsyncEventType =
  typeof INITIAL_BUILD_ASYNC_EVENTS[keyof typeof INITIAL_BUILD_ASYNC_EVENTS];
