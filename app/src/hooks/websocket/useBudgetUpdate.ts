import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { logger } from '@/lib/request-context'

// Minimal payload shape — broadened to `unknown` so SSE and WS callers share
// the hook even though they type the incoming event slightly differently.
interface BudgetUpdatePayload {
  refreshRequired?: boolean
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
 * Invalidates the `credit-grants` query whenever the agent signals a budget
 * change (spend booked, refresh required). Consumers of useCreditGrants pick
 * up the new values on their next render without the hook needing to poll.
 */
export function useBudgetUpdate({ controller, subscriptionId, enabled = true }: UseBudgetUpdateOptions): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!controller || !enabled) return

    const unsubscribe = controller.onBudgetUpdate((data) => {
      logger.info('budget.update.received', {
        subscriptionId,
        refreshRequired: data?.refreshRequired,
      })
      void queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
    })

    return unsubscribe
  }, [controller, enabled, queryClient, subscriptionId])
}
