import type { CreditGrant } from '@airo/shared/grants'
import { GrantManager } from '@airo/shared/grants'
import { logger } from '../utils/logger.js'

/**
 * Special subscription IDs for non-standard billing
 * These bypass grants and use dedicated budgets
 */
export enum BudgetOverride {
  CareAgent = 'airo-builder:care-agent',
  TestAccounts = 'airo-builder:test-accounts',
}

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
 * Callback type for requesting grant refresh from frontend
 */
export type GrantRefreshCallback = (sessionId: string) => void

/**
 * Pending refresh state for a session waiting for new grants
 */
interface PendingRefresh {
  /** Promise that resolves when new grants arrive or timeout */
  promise: Promise<boolean>
  /** Resolve function to complete the promise */
  resolve: (hasNewGrants: boolean) => void
  /** Number of grants before refresh was requested */
  previousGrantCount: number
  /** Grant IDs before refresh was requested */
  previousGrantIds: Set<string>
  /** Timeout handle for cleanup */
  timeoutId: ReturnType<typeof setTimeout>
  /** Timestamp when refresh was requested (for stale detection) */
  createdAt: number
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
  /** Callback to request grant refresh from frontend (set by websocket server) */
  private requestRefreshCallback: GrantRefreshCallback | null = null
  /** Pending refresh promises waiting for new grants to arrive */
  private pendingRefreshes = new Map<string, PendingRefresh>()

  /**
   * Set APM agent for instrumentation
   */
  setAPM(apm: APMAgent): void {
    this.apm = apm
  }

  /**
   * Set callback for requesting grant refresh from frontend
   * Called when grants are exhausted and we need fresh data
   *
   * @param callback - Function to call with sessionId when refresh is needed
   */
  setRefreshCallback(callback: GrantRefreshCallback): void {
    this.requestRefreshCallback = callback
  }

  /**
   * Request a grant refresh and wait for new grants to arrive
   *
   * This method:
   * 1. Calls the refresh callback to emit request_grant_refresh to the frontend
   * 2. Returns a Promise that resolves when setGrants is called with new usable grants
   * 3. Times out after the specified duration
   *
   * If a refresh is already pending for this subscription, returns the existing promise
   * to avoid race conditions where multiple concurrent calls cancel each other.
   *
   * @param sessionId - WebSocket session ID (socketId)
   * @param timeoutMs - Maximum time to wait for new grants (default: 5 seconds)
   * @returns Promise that resolves to true if new usable grants arrived, false if timed out or no callback
   */
  async requestGrantRefreshAndWait(sessionId: string, timeoutMs: number = 5000): Promise<boolean> {
    // Get current state for comparison
    const subscriptionId = this.sessionToSubscription.get(sessionId)
    const currentState = subscriptionId ? this.subscriptionSessions.get(subscriptionId) : undefined
    const previousGrantCount = currentState?.grants.length ?? 0
    const previousGrantIds = new Set(currentState?.grants.map((g) => g.id) ?? [])

    // If no callback registered, we can't request refresh
    if (!this.requestRefreshCallback) {
      logger.warn('grants.session.refresh_no_callback', {
        sessionId,
        subscriptionId,
        message: 'No refresh callback registered - grant refresh mechanism not configured',
      })
      return false
    }

    // If no subscriptionId, we can't track the pending refresh
    // This happens when grants haven't been received yet for this session
    if (!subscriptionId) {
      logger.warn('grants.session.refresh_no_subscription', {
        sessionId,
        message: 'Cannot request grant refresh - no subscription mapped to session yet',
      })
      return false
    }

    // If there's already a pending refresh for this subscription, return that promise
    // This prevents race conditions where multiple concurrent calls cancel each other
    const existingPending = this.pendingRefreshes.get(subscriptionId)
    if (existingPending) {
      logger.debug('grants.session.refresh_reusing_pending', {
        sessionId,
        subscriptionId,
        pendingAge: Date.now() - existingPending.createdAt,
      })
      return existingPending.promise
    }

    // Create promise that will be resolved when new grants arrive
    let resolvePromise: (hasNewGrants: boolean) => void
    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    })

    const timeoutId = setTimeout(() => {
      this.pendingRefreshes.delete(subscriptionId)
      logger.warn('grants.session.refresh_timeout', {
        sessionId,
        subscriptionId,
        timeoutMs,
      })
      resolvePromise!(false)
    }, timeoutMs)

    this.pendingRefreshes.set(subscriptionId, {
      promise,
      resolve: resolvePromise!,
      previousGrantCount,
      previousGrantIds,
      timeoutId,
      createdAt: Date.now(),
    })

    // Request refresh from frontend
    logger.info('grants.session.refresh_requested', {
      sessionId,
      subscriptionId,
      previousGrantCount,
    })
    this.requestRefreshCallback(sessionId)

    return promise
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
        // Current grant still exists in new list
        const currentGrantInNewList = sortedGrants[newIndex]
        if (currentGrantInNewList && GrantManager.isGrantUsable(currentGrantInNewList)) {
          // Current grant is still usable, but check if there's a NEW grant (not in previous list)
          // at a lower index that expires sooner. 
          const existingGrantIds = new Set(existingState.grants.map((g) => g.id))
          let betterNewGrantIndex = -1

          for (let i = 0; i < newIndex; i++) {
            const grant = sortedGrants[i]
            if (grant && GrantManager.isGrantUsable(grant) && !existingGrantIds.has(grant.id)) {
              betterNewGrantIndex = i
              break
            }
          }

          if (betterNewGrantIndex >= 0) {
            currentIndex = betterNewGrantIndex
            logger.info('grants.session.index_reset', {
              sessionId,
              subscriptionId,
              previousGrantId: currentGrantId,
              newIndex: currentIndex,
              newGrantId: sortedGrants[betterNewGrantIndex]?.id,
              reason: 'new_better_grant_available',
            })
          } else {
            // No new better grant available - preserve current position
            currentIndex = newIndex
          }
        } else {
          // Current grant exists but is no longer usable (exhausted/expired)
          // Find the first usable grant in the list
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
            reason: 'current_grant_unusable',
          })
        }
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

    // Check if there's a pending refresh waiting for new grants
    const pendingRefresh = this.pendingRefreshes.get(subscriptionId)
    if (pendingRefresh) {
      // Check if we have new/different grants
      const hasNewGrants =
        sortedGrants.length !== pendingRefresh.previousGrantCount ||
        sortedGrants.some((g) => !pendingRefresh.previousGrantIds.has(g.id))

      // Check if any grant is usable - this is the key requirement
      // Even if grants changed, we only resolve true if there's a usable one
      const hasUsableGrant = sortedGrants.some((g) => GrantManager.isGrantUsable(g))

      // Only resolve with true if there's actually a usable grant
      // This prevents false positives where grants changed but all are still exhausted
      if (hasUsableGrant) {
        clearTimeout(pendingRefresh.timeoutId)
        this.pendingRefreshes.delete(subscriptionId)
        logger.info('grants.session.refresh_resolved', {
          sessionId,
          subscriptionId,
          hasNewGrants,
          hasUsableGrant,
          newGrantCount: sortedGrants.length,
        })
        pendingRefresh.resolve(true)
      } else if (hasNewGrants) {
        // Grants changed but none are usable - log for debugging but keep waiting
        logger.debug('grants.session.refresh_no_usable', {
          sessionId,
          subscriptionId,
          hasNewGrants,
          newGrantCount: sortedGrants.length,
          message: 'New grants received but none are usable, continuing to wait',
        })
      }
    }
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

      // No grants in session - use fallback (fetch may have failed or grants not provisioned yet)
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
      const isUsable = grant && GrantManager.isGrantUsable(grant)

      if (isUsable) {
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
      currentIndex: state.currentIndex,
      totalGrants: state.grants.length,
      message: 'No more usable grants available after current index',
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
   *
   * If this is the last socket for a subscription and there's a pending refresh,
   * the pending refresh is cancelled to avoid unnecessary timeout waiting.
   */
  removeSession(sessionId: string): void {
    const subscriptionId = this.sessionToSubscription.get(sessionId)

    if (this.sessionToSubscription.delete(sessionId)) {
      logger.debug('grants.session.removed', { sessionId, subscriptionId })

      // Check if this was the last socket for this subscription
      if (subscriptionId) {
        const hasOtherSockets = Array.from(this.sessionToSubscription.values()).includes(subscriptionId)

        // If no other sockets and there's a pending refresh, cancel it
        if (!hasOtherSockets) {
          const pendingRefresh = this.pendingRefreshes.get(subscriptionId)
          if (pendingRefresh) {
            clearTimeout(pendingRefresh.timeoutId)
            this.pendingRefreshes.delete(subscriptionId)
            logger.info('grants.session.refresh_cancelled', {
              sessionId,
              subscriptionId,
              reason: 'last_socket_disconnected',
            })
            pendingRefresh.resolve(false)
          }
        }
      }
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
   * Get all socket IDs for a subscription
   * Used to find alternative sockets when the original socket disconnects
   */
  getSocketsForSubscription(subscriptionId: string): string[] {
    const sockets: string[] = []
    for (const [socketId, subId] of this.sessionToSubscription) {
      if (subId === subscriptionId) {
        sockets.push(socketId)
      }
    }
    return sockets
  }

  /**
   * Get subscription ID for a session
   */
  getSubscriptionIdForSession(sessionId: string): string | undefined {
    return this.sessionToSubscription.get(sessionId)
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
    this.requestRefreshCallback = null

    // Clean up pending refreshes
    for (const pending of this.pendingRefreshes.values()) {
      clearTimeout(pending.timeoutId)
      pending.resolve(false)
    }
    this.pendingRefreshes.clear()

    logger.debug('grants.session.reset', {
      message: 'Grant session manager reset (testing only)',
    })
  }
}

// Singleton instance
export const grantSessionManager = new GrantSessionManager()
