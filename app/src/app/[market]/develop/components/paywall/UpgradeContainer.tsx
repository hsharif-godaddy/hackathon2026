'use client'

import { useCallback, useEffect } from 'react'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useIsInCohort } from '@/hooks/useHivemind'
import { useSubscription } from '@/hooks/useSubscription'
import { shipAnalyticsLog } from '@/lib/logging'
import { SubscriptionPlan } from '@/types/credits'
import { resetFocusOnModalClose } from '@/utils/focus'
import { logImpressionEvent } from '@/utils/instrumentation'
import DirectToPaidContainer from './DirectToPaidContainer'
import HigherPlansUpgradeContainer from './HigherPlansUpgradeContainer'
import { PaywallLoadingModal, PaywallLoadingModalVariant } from './PaywallLoadingModal'

interface UpgradeContainerProps {
  onClose: () => void
  onSuccessClick?: () => void
  onErrorClick?: () => void
  onError?: (error: Error) => void
  source?: string
  itc?: string
}

export default function UpgradeContainer(props: UpgradeContainerProps) {
  const { onClose, onSuccessClick, source } = props
  const { data: subscription, isLoading: subscriptionLoading } = useSubscription()

  const isInTreatment = useIsInCohort(EXPERIMENT_IDS.recommendedPlan, 'treatment')
  const recommendedPlan = isInTreatment ? SubscriptionPlan.Ultimate : SubscriptionPlan.Professional;

  // Check if user has subscription and builderEntitlementId for upgrade flow
  const hasSubscriptionWithEntitlement = subscription && subscription.builderEntitlementId

  useEffect(() => {
    logImpressionEvent('paywall.upgrade.view')()
    shipAnalyticsLog('paywall.upgrade.view', {})
  }, [])

  const handleSuccessClick = useCallback(() => {
    onSuccessClick?.()
  }, [onSuccessClick])

  const handleClose = useCallback(() => {
    onClose()
    resetFocusOnModalClose()
  }, [onClose])

  // Show loading modal while subscription data is being fetched
  // This prevents incorrect routing before we know the user's subscription state
  if (subscriptionLoading) {
    return (
      <PaywallLoadingModal
        onClose={handleClose}
        variant={PaywallLoadingModalVariant.HigherPlans}
        source={source}
        component="UpgradeContainer"
      />
    )
  }

  // If user does NOT have a subscription or builderEntitlementId, use Direct-to-Paid flow
  // This allows new users without existing subscriptions to purchase
  if (!hasSubscriptionWithEntitlement) {
    return (
      <DirectToPaidContainer
        {...props}
      />
    )
  }

  return (
    <HigherPlansUpgradeContainer
      {...props}
      onSuccessClick={handleSuccessClick}
      recommendedPlan={recommendedPlan}
    />
  )
}
