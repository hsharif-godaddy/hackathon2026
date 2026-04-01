import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import { useQueryClient } from '@tanstack/react-query'

import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/request-context'
import { grantPollingService } from '@/services/GrantPollingService'

/** Global store for credit purchase polling state (survives component unmounts) */
interface CreditPurchaseStore {
  isPolling: boolean
  setIsPolling: (isPolling: boolean) => void
  abortController: AbortController | null
  setAbortController: (controller: AbortController | null) => void
}

const useCreditPurchaseStore = create<CreditPurchaseStore>((set) => ({
  isPolling: false,
  setIsPolling: (isPolling) => set({ isPolling }),
  abortController: null,
  setAbortController: (controller) => set({ abortController: controller }),
}))

/** Hook to check if credit purchase polling is in progress */
export function useIsCreditPolling(): boolean {
  return useCreditPurchaseStore((state) => state.isPolling)
}

interface UseCreditPurchaseResult {
  /** Poll for new grant and invalidate queries after credit purchase */
  handlePurchaseSuccess: (
    subscriptionId: string,
    initialGrantCount: number,
    onComplete?: () => void
  ) => Promise<void>
  /** Invalidate credit-related queries immediately (no polling) */
  invalidateQueries: () => void
  /** Whether currently polling for new grant */
  isPolling: boolean
}

/**
 * Hook for handling credit purchase success with grant polling and query invalidation
 */
export function useCreditPurchase(): UseCreditPurchaseResult {
  const queryClient = useQueryClient()
  const isPolling = useCreditPurchaseStore((state) => state.isPolling)
  const setIsPolling = useCreditPurchaseStore((state) => state.setIsPolling)
  const abortController = useCreditPurchaseStore((state) => state.abortController)
  const setAbortController = useCreditPurchaseStore((state) => state.setAbortController)

  // Abort polling on unmount
  useEffect(() => {
    return () => {
      abortController?.abort()
    }
  }, [abortController])

  const invalidateQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
  }, [queryClient])

  const handlePurchaseSuccess = useCallback(async (
    subscriptionId: string,
    initialGrantCount: number,
    onComplete?: () => void
  ) => {
    // Abort any existing polling
    abortController?.abort()

    const controller = new AbortController()
    setAbortController(controller)
    setIsPolling(true)

    logger.info('credits.purchase.polling-start', { subscriptionId, initialGrantCount })

    try {
      const result = await grantPollingService.pollForNewGrant(
        subscriptionId,
        initialGrantCount,
        undefined, // onStatusUpdate
        controller.signal,
        (error, attempt) => {
          logger.warn('credits.purchase.polling-error', {
            subscriptionId,
            attempt,
            error: error.message,
          })
        }
      )

      // Don't proceed if aborted
      if (result.aborted) {
        return
      }

      if (result.success) {
        logger.info('credits.purchase.polling-complete', {
          subscriptionId,
          newGrantCount: result.grantCount,
        })
      } else {
        logger.warn('credits.purchase.polling-timeout', {
          subscriptionId,
          error: result.error,
        })
      }

      invalidateQueries()
      setIsPolling(false)
      setAbortController(null)
      onComplete?.()
    } catch (error) {
      logger.error('credits.purchase.polling-error', {
        subscriptionId,
        error: getErrorMessage(error),
      })
      invalidateQueries()
      setIsPolling(false)
      setAbortController(null)
      onComplete?.()
    }
  }, [abortController, invalidateQueries, setIsPolling, setAbortController])

  return {
    handlePurchaseSuccess,
    invalidateQueries,
    isPolling,
  }
}
