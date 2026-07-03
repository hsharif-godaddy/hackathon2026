'use client'

import { useMemo } from 'react'

import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { isProfessionalOrAbove } from '@/lib/paywall/shared'
import { SubscriptionPlan } from '@/types/credits'
import { getPlanFromSubscription } from '@/utils/credits'

interface UseCanTransferOwnershipResult {
  /** Show Transfer in project/app action menus (Professional / Ultimate only). */
  showTransfer: boolean
  /** User can initiate transfer without upgrading. */
  canInitiateTransfer: boolean
  /** True while the feature flag or subscription plan is still loading. */
  isLoading: boolean
}

/**
 * Transfer ownership is available on Professional / Ultimate only. Other plans
 * (including Starter) do not see Transfer.
 *
 * `showTransfer` and `canInitiateTransfer` are always equal today — both plans
 * that can see Transfer can also initiate it. They're kept as separate fields
 * because a future plan tier may need to show the menu item while gating the
 * actual transfer behind an upgrade prompt.
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

    return { showTransfer: canInitiate, canInitiateTransfer: canInitiate }
  }, [isTransferEnabled, isSubscriptionLoading, subscription])

  return { showTransfer, canInitiateTransfer, isLoading }
}
