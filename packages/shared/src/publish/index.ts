/**
 * Publish-related constants shared between app/ and agents/.
 * These values cross service boundaries (WebSocket/SSE, HTTP).
 */

/** Max time the browser waits for publish approval (human think-time only). */
export const PUBLISH_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Agent client-action budget for deploy work. On approval the browser resets
 * this timer from zero; it must be >= {@link PUBLISH_CONFIRMATION_TIMEOUT_MS}.
 */
export const PUBLISH_CLIENT_ACTION_TIMEOUT_MS = 420_000;

/** Post-timeout production status poll budget in the publish skill. */
export const PUBLISH_RECONCILE_POLL_TIMEOUT_MS = 60_000;

/**
 * Skill-tool `Promise.race` deadline: approval window + work budget + reconcile.
 * Covers the full client-action lifetime (approval may consume up to
 * {@link PUBLISH_CONFIRMATION_TIMEOUT_MS} before the work timer resets).
 */
export const PUBLISH_SKILL_TOOL_TIMEOUT_MS =
  PUBLISH_CONFIRMATION_TIMEOUT_MS +
  PUBLISH_CLIENT_ACTION_TIMEOUT_MS +
  PUBLISH_RECONCILE_POLL_TIMEOUT_MS;

export const PublishDenialReason = {
  NoSubscription: 'no_subscription',
  PublishLimitReached: 'publish_limit_reached',
} as const;

export type PublishDenialReason = (typeof PublishDenialReason)[keyof typeof PublishDenialReason];

export const PublishErrorCode = {
  TokenStale: 'TOKEN_STALE',
} as const;

export type PublishErrorCode = (typeof PublishErrorCode)[keyof typeof PublishErrorCode];

export class PublishUpgradeRequiredError extends Error {
  readonly requiresUpgrade = true
  readonly reason: PublishDenialReason

  constructor(reason: PublishDenialReason, message?: string) {
    super(message ?? 'Publishing requires a paid Airo Builder plan. Upgrade to continue and make your app live.')
    this.name = 'PublishUpgradeRequiredError'
    this.reason = reason
  }
}
