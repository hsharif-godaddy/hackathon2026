'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useGasketData } from '@/hooks/useGasketData'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { shipAnalyticsLog } from '@/lib/logging'
import { waitForQueryUpdate } from '@/lib/query-utils'
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

  // Determine product ID based on feature flag
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants')
  const { data: subscription } = useSubscription()
  const productId = isGrantsEnabled
    ? UPGRADE_PRODUCT_IDS.AIRO_BUILDER
    : UPGRADE_PRODUCT_IDS.AIRO_PLUS

  // Pass entitlementId when grants are enabled (for upgrade flow attribution)
  const entitlementId = isGrantsEnabled ? subscription?.builderEntitlementId : undefined

  const handleSuccess = useCallback(async () => {
    // Log impression event for purchase success tracking. Do not remove - required for https://godaddy-corp.atlassian.net/browse/NEX-5186
    logImpressionEvent('plan.purchase.success')()

    // Ship unified analytics log to Elastic for all purchase paths
    shipAnalyticsLog('airoplus.purchase.in-app', { source, productId })

    // Capture current plan from cache at purchase time (not from render-time state)
    // This prevents issues if component re-renders during polling
    const cachedData = queryClient.getQueryData<{ active?: { plan: string } }>(['subscriptions'])
    const planBeforePurchase = cachedData?.active?.plan

    // Poll until plan changes (up to 30 seconds)
    // External subscription service may take time to reflect the purchase
    const updated = await waitForQueryUpdate<{ active?: { plan: string } }>(
      queryClient,
      ['subscriptions'],
      (data) => data?.active?.plan !== planBeforePurchase,
      { maxAttempts: 15, intervalMs: 2000 }
    )

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

  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <PaywallErrorFallback
          error={error}
          reset={reset}
          onClose={onClose}
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
        itc={itc}
        onClose={onClose}
        onPurchaseSuccess={handleSuccess}
        onSuccessClick={onSuccessClick}
        onErrorClick={onErrorClick}
        secondaryCTA={{
          skipDefaultBehavior: true,
          onClick: onClose
        }}
        LoadingComponent={<PaywallLoadingModal onClose={onClose} />}
      />
    </ErrorBoundary>
  )
}

export default SinglePlanUpgradeContainer
