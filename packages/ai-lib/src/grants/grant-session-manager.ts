import type { CreditGrant } from './types.js'
import { GrantManager } from './grant-manager.js'
import { logger } from '../utils/logger.js'

/**
 * APM agent type (loose typing to avoid strict dependency)
 */
type APMAgent = {
  startSpan?: (name: string) => APMSpan | null
  setLabel?: (key: string, value: string | number | boolean) => void
}
type APMSpan = {
  setLabel?: (key: string, value: string | number | boolean) => void
  end?: () => void
}

interface SessionGrantState {
  grants: CreditGrant[]
  currentIndex: number
  featureEnabled: boolean
  lastUpdated: number
}

/**
 * Manages grant state per WebSocket session
 *
 * Grants are received once per session via grant_context event and cached here.
 * This avoids sending grants with every message while keeping them reasonably fresh.
 *
 * Architecture:
 * - PRIMARY: subscriptionSessions - canonical grant state per subscription
 * - SECONDARY: sessionToSubscription - maps socketId → subscriptionId for lookups
 *
 * This ensures multiple sockets for the same subscription (user with multiple tabs)
 * share grant advancement state correctly.
 *
 * Thread Safety: Map operations are atomic in Node.js single-threaded model.
 */
export class GrantSessionManager {
  /** Maps socketId → subscriptionId for fast lookup */
  private sessionToSubscription = new Map<string, string>()
  /** PRIMARY: Canonical grant state per subscription (shared across all sockets) */
  private subscriptionSessions = new Map<string, SessionGrantState>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private apm: APMAgent | null = null

  /**
   * Set APM agent for instrumentation
   */
  setAPM(apm: APMAgent): void {
    this.apm = apm
  }

  /**
   * Update grants for a session
   * Called when frontend sends grant_context event
   *
   * Stores grants by subscriptionId (primary) and maps socketId → subscriptionId.
   * This ensures multiple sockets for the same subscription share grant state.
   */
  setGrants(sessionId: string, grants: CreditGrant[], featureEnabled: boolean): void {
    const sortedGrants = [...grants].sort(
      (a, b) => new Date(a.useBefore).getTime() - new Date(b.useBefore).getTime()
    )

    const subscriptionId = sortedGrants[0]?.subscriptionId
    if (!subscriptionId) {
      // Clean up existing mapping to avoid inconsistent state
      if (this.sessionToSubscription.has(sessionId)) {
        this.sessionToSubscription.delete(sessionId)
        logger.debug('grants.session.mapping_cleared', { sessionId, reason: 'empty_grants' })
      }
      logger.warn('grants.session.no_subscription_id', { sessionId })
      return
    }

    // Map socketId → subscriptionId for fast lookup
    this.sessionToSubscription.set(sessionId, subscriptionId)

    // Determine currentIndex for the new grant list
    const existingState = this.subscriptionSessions.get(subscriptionId)
    let currentIndex = 0

    if (existingState?.grants.length && sortedGrants.length) {
      const currentGrantId = existingState.grants[existingState.currentIndex]?.id
      const newIndex = sortedGrants.findIndex((g) => g.id === currentGrantId)

      if (newIndex >= 0) {
        // Current grant still exists in new list - preserve position
        currentIndex = newIndex
      } else {
        // Current grant no longer exists (consumed/expired/removed)
        // Reset to 0 and find first usable grant to avoid skipping grants
        currentIndex = 0
        for (let i = 0; i < sortedGrants.length; i++) {
          const grant = sortedGrants[i]
          if (grant && GrantManager.isGrantUsable(grant)) {
            currentIndex = i
            break
          }
        }

        logger.info('grants.session.index_reset', {
          sessionId,
          subscriptionId,
          previousGrantId: currentGrantId,
          newIndex: currentIndex,
          reason: 'current_grant_removed',
        })
      }
    }

    const sessionState: SessionGrantState = {
      grants: sortedGrants,
      currentIndex,
      featureEnabled,
      lastUpdated: Date.now(),
    }

    // Store by subscriptionId (primary key)
    this.subscriptionSessions.set(subscriptionId, sessionState)

    // APM instrumentation
    this.apm?.setLabel?.('grants.count', sortedGrants.length)
    this.apm?.setLabel?.('grants.feature_enabled', featureEnabled)

    logger.info('grants.session.updated', {
      sessionId,
      subscriptionId,
      grantCount: sortedGrants.length,
      featureEnabled,
      currentIndex,
    })
  }

  /**
   * Get current grant's llmBudgetUserId for LLM requests
   *
   * @param sessionId - WebSocket session ID (socketId)
   * @param fallbackCustomerId - Customer ID to use if grants disabled/unavailable
   * @returns userId for LiteLLM, or undefined if all grants exhausted (signals error)
   */
  getCurrentUserId(sessionId: string, fallbackCustomerId?: string): string | undefined {
    const span = this.apm?.startSpan?.('grants.get_current_user_id')

    try {
      // Look up subscriptionId from socketId, then get state
      const subscriptionId = this.sessionToSubscription.get(sessionId)
      const state = subscriptionId ? this.subscriptionSessions.get(subscriptionId) : undefined

      // Feature disabled - use fallback (legacy behavior)
      if (!state?.featureEnabled) {
        span?.setLabel?.('result', 'feature_disabled')
        return fallbackCustomerId
      }

      // No grants in session - use fallback (fetch may have failed)
      if (!state.grants.length) {
        logger.warn('grants.session.no_grants', { sessionId, subscriptionId })
        span?.setLabel?.('result', 'no_grants')
        return fallbackCustomerId
      }

      // Find first usable grant starting from current index
      for (let i = state.currentIndex; i < state.grants.length; i++) {
        const grant = state.grants[i]
        if (grant && GrantManager.isGrantUsable(grant)) {
          if (i !== state.currentIndex) {
            // Skipped some unusable grants
            logger.info('grants.session.skipped_unusable', {
              sessionId,
              subscriptionId,
              skippedCount: i - state.currentIndex,
              currentGrantId: grant.id,
            })
            state.currentIndex = i
          }

          span?.setLabel?.('result', 'grant_found')
          span?.setLabel?.('grant.id', grant.id)
          span?.setLabel?.('grant.index', i)
          return grant.llmBudgetUserId
        }
      }

      // All grants exhausted - return undefined to signal error
      // DO NOT fallback to customerId - user needs to purchase more credits
      logger.warn('grants.session.all_exhausted', {
        sessionId,
        subscriptionId,
        grantCount: state.grants.length,
      })
      span?.setLabel?.('result', 'all_exhausted')
      return undefined
    } finally {
      span?.end?.()
    }
  }

  /**
   * Advance to next grant after budget exceeded error
   * @returns true if advanced successfully, false if no more usable grants
   */
  advanceToNextGrant(sessionId: string): boolean {
    // Look up subscriptionId from socketId, then get state
    const subscriptionId = this.sessionToSubscription.get(sessionId)
    const state = subscriptionId ? this.subscriptionSessions.get(subscriptionId) : undefined
    if (!state) return false

    const previousGrantId = state.grants[state.currentIndex]?.id

    // Find next usable grant after current
    for (let i = state.currentIndex + 1; i < state.grants.length; i++) {
      const grant = state.grants[i]
      if (grant && GrantManager.isGrantUsable(grant)) {
        state.currentIndex = i

        // APM instrumentation
        this.apm?.setLabel?.('grants.advanced', true)
        this.apm?.setLabel?.('grants.new_index', i)
        this.apm?.setLabel?.('grants.remaining', state.grants.length - i)

        logger.info('grants.session.advanced', {
          sessionId,
          subscriptionId,
          previousGrantId,
          newGrantId: grant.id,
          newIndex: i,
          remainingGrants: state.grants.length - i,
        })
        return true
      }
    }

    logger.warn('grants.session.advance_failed', {
      sessionId,
      subscriptionId,
      message: 'No more usable grants available',
    })
    return false
  }

  /**
   * Check if grants feature is enabled for session (by socketId)
   */
  isFeatureEnabled(sessionId: string): boolean {
    const subscriptionId = this.sessionToSubscription.get(sessionId)
    return subscriptionId
      ? (this.subscriptionSessions.get(subscriptionId)?.featureEnabled ?? false)
      : false
  }

  /**
   * Get current grant's llmBudgetUserId by subscriptionId
   *
   * Used by background tasks (summarization, video generation, etc.)
   * that don't have access to the websocket session.
   *
   * @param subscriptionId - Subscription ID to look up grants for
   * @returns userId for LiteLLM, or undefined if no grants or all exhausted
   */
  getUserIdBySubscription(subscriptionId: string): string | undefined {
    const span = this.apm?.startSpan?.('grants.get_user_id_by_subscription')

    try {
      const state = this.subscriptionSessions.get(subscriptionId)

      // No grants indexed for this subscription
      if (!state) {
        logger.debug('grants.subscription_lookup.not_found', { subscriptionId })
        span?.setLabel?.('result', 'not_found')
        return undefined
      }

      // Feature disabled - grants exist but shouldn't be used
      if (!state.featureEnabled) {
        span?.setLabel?.('result', 'feature_disabled')
        return undefined
      }

      // No grants in session
      if (!state.grants.length) {
        logger.warn('grants.subscription_lookup.no_grants', { subscriptionId })
        span?.setLabel?.('result', 'no_grants')
        return undefined
      }

      // Find first usable grant starting from current index
      for (let i = state.currentIndex; i < state.grants.length; i++) {
        const grant = state.grants[i]
        if (grant && GrantManager.isGrantUsable(grant)) {
          span?.setLabel?.('result', 'grant_found')
          span?.setLabel?.('grant.id', grant.id)
          return grant.llmBudgetUserId
        }
      }

      // All grants exhausted
      logger.warn('grants.subscription_lookup.all_exhausted', {
        subscriptionId,
        grantCount: state.grants.length,
      })
      span?.setLabel?.('result', 'all_exhausted')
      return undefined
    } finally {
      span?.end?.()
    }
  }

  /**
   * Check if grants feature is enabled for a subscription
   * Used by background tasks to determine if they should use grant-based billing
   */
  isFeatureEnabledBySubscription(subscriptionId: string): boolean {
    return this.subscriptionSessions.get(subscriptionId)?.featureEnabled ?? false
  }

  /**
   * Check if subscription has indexed grants
   */
  hasGrantsBySubscription(subscriptionId: string): boolean {
    const state = this.subscriptionSessions.get(subscriptionId)
    return !!state && state.grants.length > 0
  }

  /**
   * Check if session has grant context (by socketId)
   */
  hasGrants(sessionId: string): boolean {
    const subscriptionId = this.sessionToSubscription.get(sessionId)
    if (!subscriptionId) return false
    const state = this.subscriptionSessions.get(subscriptionId)
    return !!state && state.grants.length > 0
  }

  /**
   * Check if session grant state is stale (by socketId)
   * @param maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
   */
  isStale(sessionId: string, maxAgeMs: number = 5 * 60 * 1000): boolean {
    const subscriptionId = this.sessionToSubscription.get(sessionId)
    if (!subscriptionId) return true
    const state = this.subscriptionSessions.get(subscriptionId)
    if (!state) return true
    return Date.now() - state.lastUpdated > maxAgeMs
  }

  /**
   * Clean up session on disconnect
   * Note: Does NOT remove subscription state - other sockets may still be using it
   */
  removeSession(sessionId: string): void {
    if (this.sessionToSubscription.delete(sessionId)) {
      logger.debug('grants.session.removed', { sessionId })
    }
  }

  /**
   * Start periodic cleanup of stale subscription states
   * Prevents memory leaks if all sockets disconnect but subscription state remains
   *
   * @param intervalMs - Cleanup interval (default: 1 hour)
   * @param maxAgeMs - Maximum subscription state age (default: 24 hours)
   */
  startCleanupInterval(
    intervalMs: number = 60 * 60 * 1000,
    maxAgeMs: number = 24 * 60 * 60 * 1000
  ): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      let subscriptionCleanedCount = 0
      let socketCleanedCount = 0

      // Clean up stale subscription states
      for (const [subscriptionId, state] of this.subscriptionSessions) {
        if (now - state.lastUpdated > maxAgeMs) {
          this.subscriptionSessions.delete(subscriptionId)
          subscriptionCleanedCount++
        }
      }

      // Clean up orphaned socket mappings
      for (const [sessionId, subscriptionId] of this.sessionToSubscription) {
        if (!this.subscriptionSessions.has(subscriptionId)) {
          this.sessionToSubscription.delete(sessionId)
          socketCleanedCount++
        }
      }

      if (subscriptionCleanedCount > 0 || socketCleanedCount > 0) {
        logger.info('grants.session.cleanup', {
          subscriptionCleanedCount,
          socketCleanedCount,
          remainingSubscriptions: this.subscriptionSessions.size,
          remainingSocketMappings: this.sessionToSubscription.size,
        })
      }
    }, intervalMs)
  }

  /**
   * Stop periodic cleanup (for graceful shutdown)
   */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Get session state for debugging/logging (by socketId)
   */
  getState(sessionId: string): SessionGrantState | undefined {
    const subscriptionId = this.sessionToSubscription.get(sessionId)
    return subscriptionId ? this.subscriptionSessions.get(subscriptionId) : undefined
  }

  /**
   * Get subscription state for debugging/logging
   */
  getSubscriptionState(subscriptionId: string): SessionGrantState | undefined {
    return this.subscriptionSessions.get(subscriptionId)
  }

  /**
   * Get total number of active subscriptions (for monitoring)
   */
  getSubscriptionCount(): number {
    return this.subscriptionSessions.size
  }

  /**
   * Get total number of socket mappings (for monitoring)
   */
  getSocketCount(): number {
    return this.sessionToSubscription.size
  }

  /**
   * Reset all state (for testing only)
   *
   * Clears all session mappings, subscription states, and stops cleanup interval.
   * This should ONLY be used in tests to ensure clean state between test cases.
   *
   * @internal - Do not use in production code
   */
  reset(): void {
    this.sessionToSubscription.clear()
    this.subscriptionSessions.clear()
    this.stopCleanupInterval()
    this.apm = null

    logger.debug('grants.session.reset', {
      message: 'Grant session manager reset (testing only)',
    })
  }
}

// Singleton instance
export const grantSessionManager = new GrantSessionManager()
