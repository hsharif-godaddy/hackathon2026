import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'

import { appFetch, AuthDismissedError } from '@/lib/gasket-config'
import { waitForQueryUpdate } from '@/lib/query-utils'
import { logger } from '@/lib/request-context'
import { SubscriptionStatus } from '@/types/credits'

const RENEWAL_MUTATION_KEY = ['subscription-renewal-polling'] as const

interface RenewalParams {
  subscriptionId: string
}

interface SubscriptionData {
  active?: {
    status: string
  }
}

interface RenewalResult {
  success: boolean
  subscriptionActive: boolean
}

/**
 * Hook to check if a renewal is currently polling
 */
export function useIsRenewalPolling(): boolean {
  return useIsMutating({ mutationKey: RENEWAL_MUTATION_KEY }) > 0
}

interface UseSubscriptionRenewalResult {
  renewSubscription: (subscriptionId: string) => Promise<RenewalResult>
  isRenewing: boolean
  error: Error | null
  resetError: () => void
}

/**
 * Hook for renewing a suspended subscription
 *
 * Handles the renewal API call and polls for the subscription status
 * to change from 'suspended' to 'active'.
 */
export function useSubscriptionRenewal(): UseSubscriptionRenewalResult {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationKey: RENEWAL_MUTATION_KEY,
    mutationFn: async ({ subscriptionId }: RenewalParams): Promise<RenewalResult> => {
      logger.info('subscription.renewal.start', {
        subscriptionId,
      })

      // Call the renewal API
      const response = await appFetch('/api/subscriptions/renew', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ subscriptionId }),
      }, { authLevel: 3 })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Renewal failed: ${response.status}`)
      }

      logger.info('subscription.renewal.api-success', {
        subscriptionId,
      })

      // Poll for subscription status to change from 'suspended' to 'active'
      logger.info('subscription.renewal.polling-start', {
        subscriptionId,
      })

      const subscriptionActive = await waitForQueryUpdate<SubscriptionData>(
        queryClient,
        ['subscriptions'],
        (data) => {
          return data?.active?.status === SubscriptionStatus.Active
        },
        { maxAttempts: 30, intervalMs: 2000 }
      )

      if (subscriptionActive) {
        logger.info('subscription.renewal.polling-complete', {
          subscriptionId,
        })
      } else {
        logger.warn('subscription.renewal.polling-timeout', {
          subscriptionId,
        })
      }

      return { success: true, subscriptionActive }
    },
    onSuccess: () => {
      // Invalidate relevant queries after successful renewal
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      queryClient.invalidateQueries({ queryKey: ['active-subscription'] })
      queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
      queryClient.invalidateQueries({ queryKey: ['ecomm-subscription-status'] })
    },
    onError: (error, { subscriptionId }) => {
      if (error instanceof AuthDismissedError) return;
      logger.error('subscription.renewal.error', {
        subscriptionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    },
  })

  const renewSubscription = async (
    subscriptionId: string
  ): Promise<RenewalResult> => {
    try {
      return await mutation.mutateAsync({ subscriptionId })
    } catch {
      return { success: false, subscriptionActive: false }
    }
  }

  return {
    renewSubscription,
    isRenewing: mutation.isPending,
    error: mutation.error,
    resetError: mutation.reset,
  }
}
