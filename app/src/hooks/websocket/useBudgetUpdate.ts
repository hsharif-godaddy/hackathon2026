import { useCallback, useEffect, useRef } from 'react'
import type { BudgetUpdatePayload } from '@airo/shared/budget'
import { useQueryClient } from '@tanstack/react-query'

import { logger } from '@/lib/request-context'
import { BUDGET_STATUS_QUERY_KEY, type CreditStatusResponse } from '@/types/budget'

/**
 * Controller interface for budget update events
 */
export interface BudgetUpdateController {
  onBudgetUpdate(callback: (data: BudgetUpdatePayload) => void): () => void
  on(event: 'reconnect:success', callback: () => void): void
  off(event: 'reconnect:success', callback: () => void): void
}

interface UseBudgetUpdateOptions {
  controller: BudgetUpdateController | null
  subscriptionId: string | undefined
  enabled: boolean
}

/**
 * Listens for budget_update WebSocket events and updates the
 * useBudgetService query cache in real-time.
 *
 * - refreshRequired: false -> optimistic cache update + background invalidation
 * - refreshRequired: true -> invalidation only (triggers BFF refetch)
 * - reconnect -> invalidation (stale data after disconnect)
 */
export function useBudgetUpdate({
  controller,
  subscriptionId,
  enabled,
}: UseBudgetUpdateOptions): void {
  const queryClient = useQueryClient()
  const subscriptionIdRef = useRef(subscriptionId)
  subscriptionIdRef.current = subscriptionId

  const handleBudgetUpdate = useCallback(
    function onBudgetUpdate(data: BudgetUpdatePayload) {
      const subId = subscriptionIdRef.current
      if (!subId) return

      const queryKey = [BUDGET_STATUS_QUERY_KEY, subId]

      if (data.refreshRequired === true) {
        logger.info('websocket.budget.refresh_required')
        queryClient.invalidateQueries({ queryKey })
        return
      }

      // Optimistic update: patch cached data if it exists
      const cached = queryClient.getQueryData<CreditStatusResponse>(queryKey)
      if (cached) {
        const creditsUsedNumeric = Math.max(0, Math.min(cached.creditsTotalNumeric - data.customerRemaining, cached.creditsTotalNumeric))
        queryClient.setQueryData<CreditStatusResponse>(queryKey, {
          ...cached,
          creditsUsedNumeric,
          creditsUsed: String(creditsUsedNumeric),
        })
        logger.info('websocket.budget.optimistic_update', {
          customerRemaining: data.customerRemaining,
          creditsUsedNumeric,
        })
      }

      // Background refetch for authoritative data
      queryClient.invalidateQueries({ queryKey })
    },
    [queryClient],
  )

  const handleReconnect = useCallback(
    function onReconnect() {
      const subId = subscriptionIdRef.current
      if (!subId) return

      logger.info('websocket.budget.reconnect_invalidate')
      queryClient.invalidateQueries({ queryKey: [BUDGET_STATUS_QUERY_KEY, subId] })
    },
    [queryClient],
  )

  // Register budget update listener
  useEffect(
    function registerBudgetUpdateListener() {
      if (!controller || !enabled) return

      const cleanup = controller.onBudgetUpdate(handleBudgetUpdate)
      return cleanup
    },
    [controller, enabled, handleBudgetUpdate],
  )

  // Register reconnect listener
  useEffect(
    function registerReconnectListener() {
      if (!controller || !enabled) return

      controller.on('reconnect:success', handleReconnect)
      return () => {
        controller.off('reconnect:success', handleReconnect)
      }
    },
    [controller, enabled, handleReconnect],
  )
}
