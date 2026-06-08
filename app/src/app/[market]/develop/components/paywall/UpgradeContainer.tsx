'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useIsInCohort } from '@/hooks/useHivemind'
import { useSubscription } from '@/hooks/useSubscription'
import { shipAnalyticsLog } from '@/lib/logging'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { SubscriptionPlan } from '@/types/credits'
import { resetFocusOnModalClose } from '@/utils/focus'
import { logImpressionEvent } from '@/utils/instrumentation'
import DirectToPaidContainer from './DirectToPaidContainer'
import HigherPlansUpgradeContainer from './HigherPlansUpgradeContainer'
import { PaywallErrorModal } from './PaywallErrorModal'
import { PaywallLoadingModal, PaywallLoadingModalVariant } from './PaywallLoadingModal'

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
