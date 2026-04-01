'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useGasketData } from '@/hooks/useGasketData'
import { useSubscription } from '@/hooks/useSubscription'
import { getItcOverride } from '@/lib/itc'
import { shipAnalyticsLog } from '@/lib/logging'
import { waitForQueryUpdate } from '@/lib/query-utils'
import { resetFocusOnModalClose } from '@/utils/focus'
import { logImpressionEvent } from '@/utils/instrumentation'
import { ComponentLoader } from './cdsLoader'
import { UPGRADE_DEPS, UPGRADE_PRODUCT_IDS } from './constants'
import { PaywallErrorFallback } from './PaywallErrorFallback'
import { PaywallLoadingModal } from './PaywallLoadingModal'

interface SinglePlanUpgradeContainerProps {
  onClose: () => void
  onSuccessClick?: () => void
  onErrorClick?: () => void
  /** Callback when CDS fails to load */
  onError?: (error: Error) => void
  source?: string
  /** Internal Tracking Code for purchase attribution */
  itc?: string
}

const SinglePlanUpgradeContainer = ({
  onClose,
  onSuccessClick,
  onErrorClick,
  onError,
  source,
  itc,
}: SinglePlanUpgradeContainerProps) => {
  const gasketData = useGasketData()
  const { getUserInfo } = useAuth()
  const queryClient = useQueryClient()
  const shopperId = getUserInfo()?.shopperId

  const { data: subscription } = useSubscription()
  const productId = UPGRADE_PRODUCT_IDS.AIRO_BUILDER

  const entitlementId = subscription?.builderEntitlementId

  const handleSuccess = useCallback(async () => {
    // Capture current plan from cache at purchase time (before polling updates it)
    // This is the "from" plan for conversion tracking
    const cachedData = queryClient.getQueryData<{ active?: { plan: string } }>(['subscriptions'])
    const planBeforePurchase = cachedData?.active?.plan

    // Log impression event for purchase success tracking. Do not remove - required for https://godaddy-corp.atlassian.net/browse/NEX-5186
    logImpressionEvent('plan.purchase.success')()

    // Ship unified analytics log to Elastic for all purchase paths
    shipAnalyticsLog('airoplus.purchase.in-app', { source, productId, fromPlan: planBeforePurchase })

    // Poll until plan changes (up to 30 seconds)
    // External subscription service may take time to reflect the purchase
    const updated = await waitForQueryUpdate<{ active?: { plan: string } }>(
      queryClient,
      ['subscriptions'],
      (data) => data?.active?.plan !== planBeforePurchase,
      { maxAttempts: 15, intervalMs: 2000 }
    )

    // Get the new plan after polling to log the upgrade success with plan details
    const updatedData = queryClient.getQueryData<{ active?: { plan: string } }>(['subscriptions'])
    const planAfterPurchase = updatedData?.active?.plan

    if (updated && planAfterPurchase) {
      // Log plan-specific upgrade success impression for grant tracking
      logImpressionEvent(`plan.upgrade_${planAfterPurchase}.success`)()
      shipAnalyticsLog('airoplus.upgrade.success', {
        source,
        productId,
        fromPlan: planBeforePurchase,
        toPlan: planAfterPurchase,
      })
    }

    if (!updated) {
      shipAnalyticsLog('airoplus.purchase.polling-timeout', {
        source,
        productId,
        planBeforePurchase,
      })
    }

    // Invalidate other related queries
    queryClient.invalidateQueries({ queryKey: ['active-subscription'] })
    queryClient.invalidateQueries({ queryKey: ['paywall-feature-flags'] })
    queryClient.invalidateQueries({ queryKey: ['entitlements'] })
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }, [source, productId, queryClient])

  const handleError = useCallback((error: Error) => {
    shipAnalyticsLog('paywall.cds.load.error', {
      source,
      productId,
      error: error.message,
      component: 'SinglePlanUpgradeContainer',
    })
    onError?.(error)
  }, [source, productId, onError])

  // Wrap callbacks to include focus reset - prevents focus jumping to random elements
  // when modal closes and original trigger (e.g., popover button) no longer exists
  const handleClose = useCallback(() => {
    onClose()
    resetFocusOnModalClose()
  }, [onClose])

  const handleSuccessClick = useCallback(() => {
    onSuccessClick?.()
    resetFocusOnModalClose()
  }, [onSuccessClick])

  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <PaywallErrorFallback
          error={error}
          reset={reset}
          onClose={handleClose}
          onError={handleError}
        />
      )}
    >
      <ComponentLoader
        type='godaddyUnifiedPlansAndPricingLibrary'
        cds={gasketData?.cds}
        subType='SinglePlanUpgrade'
        deps={UPGRADE_DEPS}
        shopperId={shopperId}
        productId={productId}
        entitlementId={entitlementId}
        locale={gasketData?.intl?.locale || 'en-US'}
        returnApp="airo-builder"
        source="app-builder"
        itc={getItcOverride() ?? itc}
        onClose={handleClose}
        onPurchaseSuccess={handleSuccess}
        onSuccessClick={handleSuccessClick}
        onErrorClick={onErrorClick}
        secondaryCTA={{
          skipDefaultBehavior: true,
          onClick: handleClose
        }}
        LoadingComponent={<PaywallLoadingModal onClose={handleClose} />}
      />
    </ErrorBoundary>
  )
}

export default SinglePlanUpgradeContainer
