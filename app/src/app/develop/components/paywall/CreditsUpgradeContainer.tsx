'use client'

import { useCallback, useMemo } from 'react'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useCreditPurchase } from '@/hooks/useCreditPurchase'
import { useGasketData } from '@/hooks/useGasketData'
import { getErrorMessage } from '@/lib/errors'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { resetFocusOnModalClose } from '@/utils/focus'
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
  /** Subscription ID for grant polling after purchase */
  subscriptionId?: string
  /** Current number of grants before purchase (for polling comparison) */
  initialGrantCount?: number
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
  subscriptionId,
  initialGrantCount,
}: CreditsUpgradeContainerProps) => {
  const gasketData = useGasketData()
  const { getUserInfo } = useAuth()
  const shopperId = getUserInfo()?.shopperId
  const { handlePurchaseSuccess, invalidateQueries } = useCreditPurchase()

  const handleSuccess = useCallback(async (basketId: string, details: { unitsAdded: number; newTotalBalance: number }) => {
    logImpressionEvent('credits.purchase.success')()

    shipAnalyticsLog('airobuilder.credits.purchase.in-app', {
      source,
      productId: UPGRADE_PRODUCT_IDS.AIRO_BUILDER_CREDITS,
      basketId,
      unitsAdded: details.unitsAdded,
      newTotalBalance: details.newTotalBalance,
    })

    const callOnSuccessWithFocusReset = () => {
      onSuccess?.(basketId, details)
      resetFocusOnModalClose()
    }

    try {
      if (subscriptionId && initialGrantCount !== undefined) {
        await handlePurchaseSuccess(subscriptionId, initialGrantCount, callOnSuccessWithFocusReset)
      } else {
        invalidateQueries()
        callOnSuccessWithFocusReset()
      }
    } catch (error) {
      logger.error('credits.purchase.handle-success-error', {
        source,
        basketId,
        error: getErrorMessage(error),
      })
      // Still call onSuccess to close the modal and not leave user stuck
      invalidateQueries()
      callOnSuccessWithFocusReset()
    }
  }, [source, subscriptionId, initialGrantCount, handlePurchaseSuccess, invalidateQueries, onSuccess])

  const handleError = useCallback((error: Error) => {
    shipAnalyticsLog('paywall.cds.load.error', {
      source,
      productId: UPGRADE_PRODUCT_IDS.AIRO_BUILDER_CREDITS,
      error: error.message,
      component: 'CreditsUpgradeContainer',
    })
    onError?.(error)
  }, [source, onError])

  const handleClose = useCallback(() => {
    onClose()
    resetFocusOnModalClose()
  }, [onClose])

  const loadingComponent = useMemo(() => (
    <PaywallLoadingModal onClose={handleClose} />
  ), [handleClose])

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
          onClose={handleClose}
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
        onClose={handleClose}
        onErrorClick={onErrorClick}
        LoadingComponent={loadingComponent}
      />
    </ErrorBoundary>
  )
}

export default CreditsUpgradeContainer
