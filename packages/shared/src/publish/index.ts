/**
 * Publish-related constants shared between app/ and agents/.
 * These values cross service boundaries (WebSocket/SSE, HTTP).
 */

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
