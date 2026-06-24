'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useIsInCohort } from '@/hooks/useHivemind'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { shipAnalyticsLog } from '@/lib/logging'
import { isSubscriptionSuspendedForNonPayment } from '@/lib/subscription'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { SubscriptionPlan } from '@/types/credits'
import { resetFocusOnModalClose } from '@/utils/focus'
import { logImpressionEvent } from '@/utils/instrumentation'
import DirectToPaidContainer from './DirectToPaidContainer'
import HigherPlansUpgradeContainer from './HigherPlansUpgradeContainer'
import { PaywallErrorModal } from './PaywallErrorModal'
import { PaywallLoadingModal, PaywallLoadingModalVariant } from './PaywallLoadingModal'
import { PaywallSuspendedModal } from './PaywallSuspendedModal'

interface UpgradeContainerProps {
  onClose: () => void
  onSuccessClick?: () => void
  onErrorClick?: () => void
  onError?: (error: Error) => void
  source?: string
  itc?: string
}

export default React.memo(function UpgradeContainer(props: UpgradeContainerProps) {
  const { onClose, onSuccessClick, source } = props
  const { data: subscription, isLoading: subscriptionLoading } = useSubscription()
  const paywallLoading = usePaywallStore((state) => state.paywallLoading)
  const setPaywallLoading = usePaywallStore((state) => state.setPaywallLoading)

  const suspendedNonPaymentEnabled = useSwitchboard('appbuilder-suspended-nonpayment-banner') ?? false
  const isInTreatment = useIsInCohort(EXPERIMENT_IDS.recommendedPlan, 'treatment')
  const recommendedPlan = isInTreatment ? SubscriptionPlan.Ultimate : SubscriptionPlan.Professional;

  const [paywallTimedOut, setPaywallTimedOut] = useState(false)

  const hasSubscriptionWithEntitlement = subscription && subscription.builderEntitlementId

  useEffect(() => {
    logImpressionEvent('paywall.upgrade.view')()
    shipAnalyticsLog('paywall.upgrade.view', {})
  }, [])

  useLayoutEffect(() => {
    if (!paywallLoading) return
    document.body.setAttribute('data-paywall-loading', 'true')
    return () => {
      document.body.removeAttribute('data-paywall-loading')
    }
  }, [paywallLoading])

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (paywallLoading) {
      timeoutRef.current = setTimeout(() => {
        if (!usePaywallStore.getState().paywallLoading) return
        document.body.removeAttribute('data-paywall-loading')
        setPaywallLoading(false)
        setPaywallTimedOut(true)
        shipAnalyticsLog('paywall.cds.loadTimeout', { source, component: 'UpgradeContainer' })
      }, 20000)
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [paywallLoading, setPaywallLoading, source])

  useEffect(() => {
    return () => { setPaywallLoading(false) }
  }, [setPaywallLoading])

  const handleSuccessClick = useCallback(() => {
    onSuccessClick?.()
  }, [onSuccessClick])

  const handleClose = useCallback(() => {
    onClose()
    resetFocusOnModalClose()
  }, [onClose])

  const skeletonVariant = !subscriptionLoading && !hasSubscriptionWithEntitlement
    ? PaywallLoadingModalVariant.Default
    : PaywallLoadingModalVariant.HigherPlans

  if (paywallTimedOut) {
    return <PaywallErrorModal onClose={handleClose} />
  }

  if (!subscriptionLoading && suspendedNonPaymentEnabled && isSubscriptionSuspendedForNonPayment(subscription)) {
    if (paywallLoading) setPaywallLoading(false)
    return <PaywallSuspendedModal onClose={handleClose} builderEntitlementId={subscription?.builderEntitlementId} />
  }

  return (
    <>
      {paywallLoading && (
        <PaywallLoadingModal
          onClose={handleClose}
          variant={skeletonVariant}
          source={source}
          component="UpgradeContainer"
          focusLock={false}
        />
      )}
      {!subscriptionLoading && !hasSubscriptionWithEntitlement && (
        <DirectToPaidContainer {...props} />
      )}
      {!subscriptionLoading && hasSubscriptionWithEntitlement && (
        <HigherPlansUpgradeContainer
          {...props}
          onSuccessClick={handleSuccessClick}
          recommendedPlan={recommendedPlan}
        />
      )}
    </>
  )
})
