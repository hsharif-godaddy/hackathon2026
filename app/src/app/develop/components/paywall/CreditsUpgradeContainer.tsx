'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useGasketData } from '@/hooks/useGasketData'
import { shipAnalyticsLog } from '@/lib/logging'
import { logImpressionEvent } from '@/utils/instrumentation'
import { ComponentLoader } from './cdsLoader'
import { UPGRADE_DEPS, UPGRADE_PRODUCT_IDS } from './constants'
import { PaywallErrorFallback } from './PaywallErrorFallback'
import { PaywallLoadingModal } from './PaywallLoadingModal'

interface CreditsUpgradeContainerProps {
  onClose: () => void
  onSuccess?: (basketId: string, details: { unitsAdded: number; newTotalBalance: number }) => void
  onErrorClick?: () => void
  /** Callback when CDS fails to load - use for analytics logging */
  onError?: (error: Error) => void
  source?: string
  /** Builder entitlement ID from the subscription (required for credits purchase) */
  entitlementId?: string
  /** Internal Tracking Code for purchase attribution */
  itc?: string
}

/**
 * Container component for purchasing Airo Builder credits
 *
 * Uses the unified plans and pricing library with the StandaloneAddon subtype
 * to allow users to purchase credit packs for their existing subscription.
 */
const CreditsUpgradeContainer = ({
  onClose,
  onSuccess,
  onErrorClick,
  onError,
  source = 'airo-builder',
  entitlementId,
  itc,
}: CreditsUpgradeContainerProps) => {
  const gasketData = useGasketData()
  const { getUserInfo } = useAuth()
  const queryClient = useQueryClient()
  const shopperId = getUserInfo()?.shopperId

  const handleSuccess = useCallback((basketId: string, details: { unitsAdded: number; newTotalBalance: number }) => {
    // Log impression event for credits purchase success tracking
    logImpressionEvent('credits.purchase.success')()

    // Ship unified analytics log to Elastic for credits purchase
    shipAnalyticsLog('airobuilder.credits.purchase.in-app', {
      source,
      productId: UPGRADE_PRODUCT_IDS.AIRO_BUILDER_CREDITS,
      basketId,
      unitsAdded: details.unitsAdded,
      newTotalBalance: details.newTotalBalance,
    })

    // Invalidate queries so UI updates with new credits balance
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
    queryClient.invalidateQueries({ queryKey: ['entitlements'] })

    // Call the success callback if provided
    if (onSuccess) {
      onSuccess(basketId, details)
    }
  }, [source, queryClient, onSuccess])

  const handleError = useCallback((error: Error) => {
    shipAnalyticsLog('paywall.cds.load.error', {
      source,
      productId: UPGRADE_PRODUCT_IDS.AIRO_BUILDER_CREDITS,
      error: error.message,
      component: 'CreditsUpgradeContainer',
    })
    onError?.(error)
  }, [source, onError])

  // Early return if entitlementId is missing - cannot purchase credits without it
  if (!entitlementId) {
    return null
  }

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
        locale={gasketData?.intl?.locale || 'en-US'}
        cds={gasketData?.cds}
        subType='StandaloneAddon'
        deps={UPGRADE_DEPS}
        shopperId={shopperId}
        productId={UPGRADE_PRODUCT_IDS.AIRO_BUILDER_CREDITS}
        entitlementId={entitlementId}
        source={source}
        itc={itc}
        onSuccess={handleSuccess}
        onClose={onClose}
        onErrorClick={onErrorClick}
        LoadingComponent={<PaywallLoadingModal onClose={onClose} />}
      />
    </ErrorBoundary>
  )
}

export default CreditsUpgradeContainer
