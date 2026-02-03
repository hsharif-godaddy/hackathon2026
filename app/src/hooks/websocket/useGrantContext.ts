import { useCallback, useEffect, useRef } from 'react'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { logger } from '@/lib/request-context'
import { useIsActivelyStreaming } from '@/stores/useStreamingConversationStore'
import type { CreditGrant } from '@/types/credits'

/**
 * Grant context controller interface
 * Abstracts the underlying transport for grant synchronization
 */
export interface GrantContextController {
  emitGrantContext(payload: { grants: unknown[]; featureEnabled: boolean; timestamp: number }): boolean
  onGrantRefreshRequested(callback: () => void): () => void
}

interface UseGrantContextOptions {
  controller: GrantContextController | null
  subscriptionId: string | undefined
  isConnected: boolean
}

/**
 * Compute hash of grants for change detection
 * Only includes fields that affect grant usability
 * Sorted by id to ensure consistent hash regardless of array order
 */
function computeGrantHash(grants: CreditGrant[] | undefined): string {
  if (!grants?.length) return 'empty'
  return [...grants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((g) => `${g.id}:${g.creditsSpent}:${g.finalState}:${g.isAvailable}`)
    .join('|')
}

/**
 * Manages grant context synchronization with the agent
 *
 * Sends grants to agent via grant_context event:
 * - On initial connection
 * - When grants data changes (purchase, consumption)
 * - On tab visibility change (handles stale data)
 * - When agent requests refresh
 *
 * Does NOT send grants with every message - agent caches per session.
 *
 * IMPORTANT: When the feature flag is OFF, this hook is a no-op:
 * - No API calls to fetch grants
 * - No WebSocket events emitted
 * - No visibility change handlers registered
 */
export function useGrantContext({
  controller,
  subscriptionId,
  isConnected,
}: UseGrantContextOptions): void {
  const lastSentHashRef = useRef<string | null>(null)
  const isInitialSendRef = useRef(true)

  // Feature flag check - determines if grants feature is enabled
  const { data: grantsEnabled = false, isLoading: isFlagLoading } = useSwitchboard('app-builder-grants')

  // Only fetch grants when feature is enabled to avoid unnecessary API calls
  // When flag is OFF, subscriptionId is undefined which disables the query
  const {
    data: grants,
    refetch: refetchGrants,
    isLoading: isGrantsLoading,
  } = useCreditGrants({
    subscriptionId: grantsEnabled ? subscriptionId : undefined,
    syncSpend: true,
  })

  // Send grants to agent
  const sendGrantContext = useCallback(
    function send(force = false) {
      if (!controller || !isConnected) return

      // Wait for both flag and grants to finish loading before proceeding
      if (isFlagLoading || isGrantsLoading) return

      // Skip emission entirely when feature is disabled to avoid unnecessary traffic
      if (!grantsEnabled) {
        logger.debug('websocket.grant_context.skipped', {
          reason: 'feature_disabled',
        })
        return
      }

      const grantHash = computeGrantHash(grants)

      // Skip if unchanged (unless forced)
      if (!force && grantHash === lastSentHashRef.current) {
        return
      }

      const isInitial = isInitialSendRef.current
      isInitialSendRef.current = false

      logger.info('websocket.grant_context.send', {
        grantCount: grants?.length ?? 0,
        featureEnabled: grantsEnabled,
        isInitial,
        forced: force,
      })

      controller.emitGrantContext({
        grants: grants ?? [],
        featureEnabled: grantsEnabled,
        timestamp: Date.now(),
      })

      lastSentHashRef.current = grantHash
    },
    [controller, isConnected, grants, grantsEnabled, isFlagLoading, isGrantsLoading]
  )

  // Send on connection and data changes
  useEffect(
    function syncOnChange() {
      sendGrantContext()
    },
    [sendGrantContext]
  )

  // Handle reconnection - reset state (will re-send via isConnected change)
  useEffect(
    function resetOnReconnect() {
      if (isConnected) {
        // Connection just established, reset for initial send
        if (isInitialSendRef.current === false && lastSentHashRef.current !== null) {
          // This is a reconnection, not initial connection
          logger.info('websocket.grant_context.reconnect')
          lastSentHashRef.current = null
          isInitialSendRef.current = true
        }
      }
    },
    [isConnected]
  )

  // Handle agent refresh requests via controller
  // Only active when feature flag is enabled
  useEffect(
    function handleRefreshRequest() {
      // Skip when feature is disabled - no grants to refresh
      if (!grantsEnabled || !controller) return

      return controller.onGrantRefreshRequested(function onRefresh() {
        logger.info('websocket.grant_context.refresh_requested')
        refetchGrants()
          .then(() => {
            // Force send after refetch completes
            lastSentHashRef.current = null
          })
          .catch((error) => {
            logger.warn('websocket.grant_context.refresh_failed', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
      })
    },
    [controller, refetchGrants, grantsEnabled]
  )

  // Re-send on visibility change (user returns to tab)
  // Only active when feature flag is enabled
  useEffect(
    function handleVisibilityChange() {
      // Skip when feature is disabled - no grants to sync
      if (!grantsEnabled || !controller || !isConnected) return

      function onVisibilityChange() {
        if (document.visibilityState === 'visible') {
          logger.debug('websocket.grant_context.visibility_refresh')
          // Refetch and force send
          refetchGrants()
            .then(() => {
              lastSentHashRef.current = null
            })
            .catch((error) => {
              logger.warn('websocket.grant_context.visibility_refresh_failed', {
                error: error instanceof Error ? error.message : String(error),
              })
            })
        }
      }

      document.addEventListener('visibilitychange', onVisibilityChange)
      return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    },
    [controller, isConnected, refetchGrants, grantsEnabled]
  )

  // Refetch grants when stream completes (credits have been consumed)
  // Uses same pattern as ThinkingIndicator - watching isActivelyStreaming
  const isStreaming = useIsActivelyStreaming()
  const prevIsStreamingRef = useRef<boolean | null>(null)

  useEffect(
    function handleStreamComplete() {
      const prevIsStreaming = prevIsStreamingRef.current
      prevIsStreamingRef.current = isStreaming

      // Skip when feature is disabled - no grants to refresh
      if (!grantsEnabled) return

      // Detect transition from streaming to not streaming (completion)
      if (prevIsStreaming === true && isStreaming === false) {
        logger.debug('websocket.grant_context.stream_complete_refresh')

        // Delay refetch to allow spend data to propagate (2s balances freshness vs API load)
        setTimeout(() => {
          refetchGrants()
            .then(() => {
              lastSentHashRef.current = null
            })
            .catch((error) => {
              logger.warn('websocket.grant_context.stream_complete_refresh_failed', {
                error: error instanceof Error ? error.message : String(error),
              })
            })
        }, 2_000)
      }
    },
    [isStreaming, refetchGrants, grantsEnabled]
  )

  // Reset on disconnect
  useEffect(
    function resetOnDisconnect() {
      if (!isConnected) {
        lastSentHashRef.current = null
        isInitialSendRef.current = true
      }
    },
    [isConnected]
  )
}
