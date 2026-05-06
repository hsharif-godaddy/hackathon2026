import { useEffect } from 'react'
import type { BudgetUpdatePayload, BudgetUpdateSuccess } from '@airo/shared/budget'
import { useQueryClient } from '@tanstack/react-query'

import { useSwitchboard } from '@/hooks/useSwitchboard'
import { adaptBudgetItemsToGrants } from '@/lib/credit-adapter/adapt-budget-to-grants'
import { logger } from '@/lib/request-context'
import type { CreditGrant } from '@/types/credits'

function isBudgetUpdateSuccess(data: BudgetUpdatePayload): data is BudgetUpdateSuccess {
  return data.refreshRequired === false
}

export interface BudgetUpdateController {
  onBudgetUpdate(callback: (data: BudgetUpdatePayload) => void): () => void
}

interface UseBudgetUpdateOptions {
  controller: BudgetUpdateController | null
  subscriptionId: string | undefined
  enabled?: boolean
}

/**
 * Handles budget_update events from the agent.
 *
 * When refreshRequired is false and full budget items are included, updates
 * the credit-grants query cache directly (no BFF round-trip needed).
 *
 * When refreshRequired is true (error paths), invalidates the query to trigger
 * a BFF refetch.
 *
 * Only active when BMS is enabled (inverted from useGrantContext which disables in BMS mode).
 */
export function useBudgetUpdate({ controller, subscriptionId, enabled = true }: UseBudgetUpdateOptions): void {
  const queryClient = useQueryClient()
  // BMS mode: this hook is only active when BMS is enabled
  const budgetServiceEnabled = useSwitchboard('app-builder-budget-service') ?? false
  const effectiveEnabled = enabled && budgetServiceEnabled

  useEffect(() => {
    if (!controller || !effectiveEnabled) return

    const unsubscribe = controller.onBudgetUpdate((data) => {
      logger.info('budget.update.received', {
        subscriptionId,
        refreshRequired: data.refreshRequired,
      })

      if (!isBudgetUpdateSuccess(data)) {
        // Error path: agent couldn't build full payload, need to refetch from BFF
        logger.info('budget.update.invalidating', { subscriptionId })
        void queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
        return
      }

      // Happy path: full budget items included, update cache directly
      if (!subscriptionId) {
        logger.error('budget.update.no_subscription_id', {
          message: 'Cannot update cache without subscriptionId - hook mounted in unexpected state',
        })
        void queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
        return
      }

      // Adapt BudgetItem[] to CreditGrant[] format
      const grants = adaptBudgetItemsToGrants(data.items, data.budgetId, subscriptionId)

      logger.info('budget.update.cache_updated', {
        subscriptionId,
        grantCount: grants.length,
      })

      // Update cache for both syncSpend variants
      queryClient.setQueryData<CreditGrant[]>(['credit-grants', subscriptionId, true], grants)
      queryClient.setQueryData<CreditGrant[]>(['credit-grants', subscriptionId, false], grants)
    })

    return unsubscribe
  }, [controller, effectiveEnabled, queryClient, subscriptionId])
}
