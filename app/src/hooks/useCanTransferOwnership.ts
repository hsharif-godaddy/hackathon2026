'use client'

import { useMemo } from 'react'

import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { isProfessionalOrAbove, isStarterOrAbove } from '@/lib/paywall/shared'
import { SubscriptionPlan } from '@/types/credits'
import { getPlanFromSubscription } from '@/utils/credits'

interface UseCanTransferOwnershipResult {
  /** Show Transfer in project/app action menus (Starter / Professional / Ultimate). */
  showTransfer: boolean
  /** User can initiate transfer without upgrading (Professional / Ultimate only). */
  canInitiateTransfer: boolean
  /** True while the feature flag or subscription plan is still loading. */
  isLoading: boolean
}

/**
 * Transfer ownership menu item is visible to Starter / Professional / Ultimate.
 * Starter users see a Diamond icon upgrade indicator and are redirected to the
 * upgrade modal on click — they cannot initiate a transfer directly.
 * Only Professional / Ultimate can initiate a transfer.
 */
export function useCanTransferOwnership(): UseCanTransferOwnershipResult {
  const isTransferEnabled = useSwitchboard('appbuilder-transfer-ownership')
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription()

  const isLoading = isTransferEnabled === undefined || isSubscriptionLoading

  const { showTransfer, canInitiateTransfer } = useMemo(() => {
    if (isTransferEnabled !== true || isSubscriptionLoading) {
      return { showTransfer: false, canInitiateTransfer: false }
    }

    const plan = subscription
      ? getPlanFromSubscription(subscription)
      : SubscriptionPlan.None

    const canInitiate = isProfessionalOrAbove(plan)

    return { showTransfer: isStarterOrAbove(plan), canInitiateTransfer: canInitiate }
  }, [isTransferEnabled, isSubscriptionLoading, subscription])

  return { showTransfer, canInitiateTransfer, isLoading }
}
