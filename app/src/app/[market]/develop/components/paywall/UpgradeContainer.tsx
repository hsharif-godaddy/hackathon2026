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

  // D2P (no subscription) vs F2P/P2P upgrade (has subscription + entitlement)
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
