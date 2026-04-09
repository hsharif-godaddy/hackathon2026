import { useCallback, useEffect, useRef } from 'react'
import type { QueryObserverResult } from '@tanstack/react-query'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { logger } from '@/lib/request-context'
import { useIsActivelyStreaming } from '@/stores/useStreamingConversationStore'
import type { CreditGrant } from '@/types/credits'

// Interval to retry fetching grants when empty (new account provisioning)
const EMPTY_GRANTS_RETRY_INTERVAL_MS = 5000
// Maximum duration to keep retrying for empty grants (5 minutes)
const EMPTY_GRANTS_MAX_RETRY_DURATION_MS = 5 * 60 * 1000

/**
 * Grant context controller interface
 * Abstracts the underlying transport for grant synchronization
 */
export interface GrantContextController {
  emitGrantContext(payload: { grants: unknown[]; timestamp: number }): boolean
  onGrantRefreshRequested(callback: () => void): () => void
}

interface UseGrantContextOptions {
  controller: GrantContextController | null
  subscriptionId: string | undefined
  isConnected: boolean
  enabled?: boolean
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
 * Refetch handlers call send(force=true, result.data): the agent must receive grant_context after
 * refetch even when the hash matches the prior snapshot (React Query + effect deps may not re-run).
 * result.data comes from the refetch promise, not the previous render's `grants`, and avoids waiting on isGrantsLoading.
 *
 * Does NOT send grants with every message - agent caches per session.
 */
export function useGrantContext({
  controller,
  subscriptionId,
  isConnected,
  enabled = true,
}: UseGrantContextOptions): void {
  const lastSentHashRef = useRef<string | null>(null)
  const isInitialSendRef = useRef(true)

  const {
    data: grants,
    refetch: refetchGrants,
    isLoading: isGrantsLoading,
  } = useCreditGrants({
    subscriptionId: enabled ? subscriptionId : undefined,
    syncSpend: true,
  })

  const refetchGrantsRef = useRef(refetchGrants)
  refetchGrantsRef.current = refetchGrants

  const sendGrantContext = useCallback(
    function send(force = false, grantsOverride?: CreditGrant[]) {
      if (!controller || !isConnected) return

      // Without grantsOverride, wait for query idle; refetch paths pass result.data so we are not blocked here.
      if (grantsOverride === undefined && isGrantsLoading) return

      const payloadGrants = grantsOverride ?? grants
      const grantHash = computeGrantHash(payloadGrants)

      // force=true skips dedup (needed after refetch when payload hashes the same as last send)
      if (!force && grantHash === lastSentHashRef.current) {
        return
      }

      const isInitial = isInitialSendRef.current
      isInitialSendRef.current = false

      logger.info('websocket.grant_context.send', {
        grantCount: payloadGrants?.length ?? 0,
        isInitial,
        forced: force,
      })

      controller.emitGrantContext({
        grants: payloadGrants ?? [],
        timestamp: Date.now(),
      })

      lastSentHashRef.current = grantHash
    },
    [controller, isConnected, grants, isGrantsLoading]
  )

  // Refetch .then / setTimeout run later; keep a ref so they invoke the latest send, not a stale closure.
  const sendGrantContextRef = useRef(sendGrantContext)
  sendGrantContextRef.current = sendGrantContext

  const emitAfterRefetch = useCallback(
    function emitAfterRefetch(
      result: QueryObserverResult<CreditGrant[], Error>,
      source: 'agent_refresh' | 'stream_complete' | 'visibility',
    ): void {
      if (result.data === undefined) {
        logger.warn('websocket.grant_context.refresh_no_data', {
          message: 'Refetch settled without data; skipping grant_context send to avoid stale hook grants',
          source,
        })
        return
      }
      sendGrantContextRef.current(true, result.data)
    },
    []
  )

  // Send on connection and data changes
  useEffect(
    function syncOnChange() {
      if (!enabled) return
      sendGrantContext()
    },
    [enabled, sendGrantContext]
  )

  // Handle reconnection - reset state (will re-send via isConnected change)
  useEffect(
    function resetOnReconnect() {
      if (!enabled) return
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
    [enabled, isConnected]
  )

  // Handle agent refresh requests via controller
  useEffect(
    function handleRefreshRequest() {
      if (!controller || !enabled) return

      return controller.onGrantRefreshRequested(function onRefresh() {
        logger.info('websocket.grant_context.refresh_requested')
        refetchGrants()
          .then(function afterAgentRefreshRefetch(result: QueryObserverResult<CreditGrant[], Error>) {
            if (result.isError && result.error) {
              logger.warn('websocket.grant_context.refresh_failed', {
                error: result.error instanceof Error ? result.error.message : String(result.error),
              })
              return
            }
            emitAfterRefetch(result, 'agent_refresh')
          })
          .catch((error) => {
            logger.warn('websocket.grant_context.refresh_failed', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
      })
    },
    [controller, enabled, emitAfterRefetch, refetchGrants]
  )

  // Re-send on visibility change (user returns to tab)
  useEffect(
    function handleVisibilityChange() {
      if (!controller || !isConnected || !enabled) return

      function onVisibilityChange() {
        if (document.visibilityState === 'visible') {
          logger.debug('websocket.grant_context.visibility_refresh')
          // Refetch and force send
          refetchGrants()
            .then(function afterVisibilityRefetch(result: QueryObserverResult<CreditGrant[], Error>) {
              if (result.isError && result.error) {
                logger.warn('websocket.grant_context.visibility_refresh_failed', {
                  error: result.error instanceof Error ? result.error.message : String(result.error),
                })
                return
              }
              emitAfterRefetch(result, 'visibility')
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
    [controller, enabled, emitAfterRefetch, isConnected, refetchGrants]
  )

  // Refetch grants when stream completes (credits have been consumed)
  // Uses same pattern as ThinkingIndicator - watching isActivelyStreaming
  const isStreaming = useIsActivelyStreaming()
  const prevIsStreamingRef = useRef<boolean | null>(null)
  const streamCompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    function handleStreamComplete() {
      const prevIsStreaming = prevIsStreamingRef.current
      prevIsStreamingRef.current = isStreaming

      if (!enabled) return

      // Detect transition from streaming to not streaming (completion)
      if (prevIsStreaming === true && isStreaming === false) {
        logger.debug('websocket.grant_context.stream_complete_refresh')

        let cancelled = false

        if (streamCompleteTimeoutRef.current) {
          clearTimeout(streamCompleteTimeoutRef.current)
        }

        // Delay refetch to allow spend data to propagate (2s balances freshness vs API load)
        streamCompleteTimeoutRef.current = setTimeout(() => {
          streamCompleteTimeoutRef.current = null
          refetchGrantsRef
            .current()
            .then(function afterStreamCompleteRefetch(result: QueryObserverResult<CreditGrant[], Error>) {
              if (cancelled) return
              if (result.isError && result.error) {
                logger.warn('websocket.grant_context.stream_complete_refresh_failed', {
                  error: result.error instanceof Error ? result.error.message : String(result.error),
                })
                return
              }
              emitAfterRefetch(result, 'stream_complete')
            })
            .catch((error) => {
              if (cancelled) return
              logger.warn('websocket.grant_context.stream_complete_refresh_failed', {
                error: error instanceof Error ? error.message : String(error),
              })
            })
        }, 2_000)

        return function cleanupStreamCompleteDelay() {
          cancelled = true
          if (streamCompleteTimeoutRef.current) {
            clearTimeout(streamCompleteTimeoutRef.current)
            streamCompleteTimeoutRef.current = null
          }
        }
      }
    },
    [emitAfterRefetch, enabled, isStreaming]
  )

  // Reset on disconnect
  useEffect(
    function resetOnDisconnect() {
      if (!enabled) return
      if (!isConnected) {
        lastSentHashRef.current = null
        isInitialSendRef.current = true
      }
    },
    [enabled, isConnected]
  )

  // Retry fetching grants when list is empty (new account provisioning)
  // This handles the case where subscription is active but grants aren't provisioned yet
  const emptyGrantsRetryStartRef = useRef<number | null>(null)
  const emptyGrantsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    function retryOnEmptyGrants() {
      // Helper to clear interval
      const clearRetryInterval = () => {
        if (emptyGrantsIntervalRef.current) {
          clearInterval(emptyGrantsIntervalRef.current)
          emptyGrantsIntervalRef.current = null
        }
      }

      if (!enabled) {
        clearRetryInterval()
        emptyGrantsRetryStartRef.current = null
        return
      }

      if (!subscriptionId) {
        clearRetryInterval()
        emptyGrantsRetryStartRef.current = null
        return
      }

      // Skip if we're still loading
      if (isGrantsLoading) return

      // If we have grants, stop retrying and reset timer
      if (grants && grants.length > 0) {
        clearRetryInterval()
        emptyGrantsRetryStartRef.current = null
        return
      }

      // No grants available - start or continue retry timer
      const now = Date.now()
      if (emptyGrantsRetryStartRef.current === null) {
        emptyGrantsRetryStartRef.current = now
        logger.info('websocket.grant_context.empty_grants_retry_start', {
          subscriptionId,
          message: 'Starting retry loop for empty grants (new account provisioning)',
        })
      }

      // Check if we've exceeded the max retry duration
      const elapsed = now - emptyGrantsRetryStartRef.current
      if (elapsed >= EMPTY_GRANTS_MAX_RETRY_DURATION_MS) {
        clearRetryInterval()
        logger.warn('websocket.grant_context.empty_grants_retry_timeout', {
          subscriptionId,
          elapsedMs: elapsed,
          message: 'Exceeded max retry duration for empty grants',
        })
        return
      }

      // Only create interval if one isn't already running
      if (emptyGrantsIntervalRef.current) return

      // Set up interval to refetch
      emptyGrantsIntervalRef.current = setInterval(() => {
        const startTime = emptyGrantsRetryStartRef.current
        if (!startTime) {
          // Retry was cancelled - stop interval
          clearRetryInterval()
          return
        }

        const currentElapsed = Date.now() - startTime
        if (currentElapsed >= EMPTY_GRANTS_MAX_RETRY_DURATION_MS) {
          clearRetryInterval()
          logger.warn('websocket.grant_context.empty_grants_retry_timeout', {
            subscriptionId,
            elapsedMs: currentElapsed,
            message: 'Exceeded max retry duration for empty grants',
          })
          return
        }

        logger.debug('websocket.grant_context.empty_grants_retry', {
          subscriptionId,
          elapsedMs: currentElapsed,
        })
        refetchGrantsRef.current().catch((error) => {
          logger.warn('websocket.grant_context.empty_grants_retry_failed', {
            subscriptionId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }, EMPTY_GRANTS_RETRY_INTERVAL_MS)

      return clearRetryInterval
    },
    [enabled, subscriptionId, grants, isGrantsLoading]
  )
}
