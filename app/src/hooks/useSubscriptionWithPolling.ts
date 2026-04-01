import { useEffect, useRef, useState } from 'react'

import { logger } from '@/lib/request-context'
import { useSubscription } from './useSubscription'

/** Maximum time to poll for builderEntitlementId (2 minutes) */
const MAX_ENTITLEMENT_POLLING_DURATION_MS = 2 * 60 * 1000
const ENTITLEMENT_POLL_INTERVAL_MS = 5000

interface UseSubscriptionWithPollingResult {
  subscription: ReturnType<typeof useSubscription>['data']
  subscriptions: ReturnType<typeof useSubscription>['subscriptions']
  isLoading: boolean
  isError: boolean
  builderEntitlementId: string | undefined
  /** Whether purchase buttons should be disabled (no entitlement yet) */
  isPurchaseDisabled: boolean
  /** Whether entitlement polling has timed out */
  entitlementPollingTimedOut: boolean
}

/**
 * Hook that wraps useSubscription with automatic polling when
 * builderEntitlementId not yet available (handles async subscription creation)
 */
export function useSubscriptionWithPolling(): UseSubscriptionWithPollingResult {
  const [needsPolling, setNeedsPolling] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const pollingStartTime = useRef<number | null>(null)

  const {
    data: subscription,
    subscriptions,
    isLoading,
    isError,
  } = useSubscription({
    refetchInterval: needsPolling ? ENTITLEMENT_POLL_INTERVAL_MS : false,
  })

  const builderEntitlementId = subscription?.builderEntitlementId

  // Enable/disable polling based on entitlement availability
  useEffect(function updatePollingState() {
    if (!builderEntitlementId && !isLoading && !timedOut) {
      if (!needsPolling) {
        // Start polling
        pollingStartTime.current = Date.now()
        setNeedsPolling(true)
        logger.info('subscription.entitlement-polling.start', {
          subscriptionId: subscription?.id,
        })
      } else if (pollingStartTime.current) {
        // Check if we've exceeded the timeout
        const elapsed = Date.now() - pollingStartTime.current
        if (elapsed >= MAX_ENTITLEMENT_POLLING_DURATION_MS) {
          setNeedsPolling(false)
          setTimedOut(true)
          logger.warn('subscription.entitlement-polling.timeout', {
            subscriptionId: subscription?.id,
            elapsedMs: elapsed,
          })
        }
      }
    } else if (builderEntitlementId && needsPolling) {
      // Success - entitlement found
      const elapsed = pollingStartTime.current ? Date.now() - pollingStartTime.current : 0
      logger.info('subscription.entitlement-polling.success', {
        subscriptionId: subscription?.id,
        builderEntitlementId,
        elapsedMs: elapsed,
      })
      setNeedsPolling(false)
      pollingStartTime.current = null
    }
  }, [builderEntitlementId, isLoading, needsPolling, timedOut, subscription?.id])

  return {
    subscription,
    subscriptions,
    isLoading,
    isError,
    builderEntitlementId,
    isPurchaseDisabled: !builderEntitlementId,
    entitlementPollingTimedOut: timedOut,
  }
}
