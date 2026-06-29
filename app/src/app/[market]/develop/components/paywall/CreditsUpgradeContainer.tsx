'use client'

import { useCallback, useEffect, useRef } from 'react'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useCreditPurchase } from '@/hooks/useCreditPurchase'
import { useGasketData } from '@/hooks/useGasketData'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { getErrorMessage } from '@/lib/errors'
import { getItcOverride } from '@/lib/itc'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { resetFocusOnModalClose } from '@/utils/focus'
import { logImpressionEvent } from '@/utils/instrumentation'
import { CDS_TYPE_ESM, CDS_TYPE_UMD, PAYWALL_UMD_FALLBACK, STANDALONE_CREDIT_PACKS } from './cdsConfig'
import { ComponentLoader } from './cdsLoader'
import { UPGRADE_PRODUCT_IDS } from './constants'
import { PaywallErrorFallback } from './PaywallErrorFallback'
import { PaywallLoadingModal, PaywallLoadingModalVariant } from './PaywallLoadingModal'

const COMPONENT_NAME = 'CreditsUpgradeContainer'

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
  /**
   * Product ID to use. When omitted, the {@link STANDALONE_CREDIT_PACKS}
   * Switchboard flag determines whether to use AiroReserveCreditsProduct
   * or the legacy addon AiroBuilderCreditsProduct.
   */
  productId?: string
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
  productId,
}: CreditsUpgradeContainerProps) => {
  const gasketData = useGasketData()
  const { getUserInfo } = useAuth()
  const shopperId = getUserInfo()?.shopperId
  const { handlePurchaseSuccess, invalidateQueries } = useCreditPurchase()
  const umdFallback = useSwitchboard(PAYWALL_UMD_FALLBACK) ?? false
  const standaloneFlag = useSwitchboard(STANDALONE_CREDIT_PACKS) ?? false
  const setPaywallLoading = usePaywallStore((state) => state.setPaywallLoading)
  const effectiveProductId = productId ?? (
    standaloneFlag
      ? UPGRADE_PRODUCT_IDS.AIRO_STANDALONE_CREDIT_PACK
      : UPGRADE_PRODUCT_IDS.AIRO_BUILDER_CREDITS
  )
  const hasLoggedImpressionRef = useRef(false)

  useEffect(() => {
    if (!hasLoggedImpressionRef.current) {
      hasLoggedImpressionRef.current = true
      shipAnalyticsLog('paywall.credits.modal.shown', {
        source,
        productId: effectiveProductId,
        entitlementId,
        component: COMPONENT_NAME,
      })
    }
  }, [source, entitlementId, effectiveProductId])

  const handleSuccess = useCallback(async (basketId: string, details: { unitsAdded: number; newTotalBalance: number }) => {
    logImpressionEvent('credits.purchase.success')()

    shipAnalyticsLog('airobuilder.credits.purchase.in-app', {
      source,
      productId: effectiveProductId,
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
  }, [source, effectiveProductId, subscriptionId, initialGrantCount, handlePurchaseSuccess, invalidateQueries, onSuccess])

  const handleError = useCallback((error: Error) => {
    setPaywallLoading(false)
    shipAnalyticsLog('paywall.cds.load.error', {
      source,
      productId: effectiveProductId,
      error: error.message,
      errorType: 'load',
      component: COMPONENT_NAME,
    })
    onError?.(error)
  }, [source, effectiveProductId, onError, setPaywallLoading])

  const handleLoadSuccess = useCallback(() => {
    setPaywallLoading(false)
    shipAnalyticsLog('paywall.credits.load.success', {
      source,
      component: COMPONENT_NAME,
    })
  }, [source, setPaywallLoading])

  const handleClose = useCallback(() => {
    onClose()
    resetFocusOnModalClose()
  }, [onClose])

  const LoadingComponent = useCallback(() => (
    <PaywallLoadingModal
      onClose={handleClose}
      variant={PaywallLoadingModalVariant.Credits}
      source={source}
      component={COMPONENT_NAME}
    />
  ), [handleClose, source])

  const renderErrorFallback = useCallback((error: Error) => (
    <PaywallErrorFallback
      error={error}
      onClose={handleClose}
      source={source}
      productId={effectiveProductId}
      component={COMPONENT_NAME}
    />
  ), [handleClose, source, effectiveProductId])

  // Early return if entitlementId is missing - cannot purchase credits without it
  if (!entitlementId) {
    return null
  }

  return (
    <ErrorBoundary
      fallback={(error) => (
        <PaywallErrorFallback
          error={error}
          onClose={handleClose}
          onError={handleError}
          source={source}
          productId={effectiveProductId}
          component={COMPONENT_NAME}
        />
      )}
    >
      <ComponentLoader
        type={umdFallback ? CDS_TYPE_UMD : CDS_TYPE_ESM}
        {...(!umdFallback && { loaderMode: 'esm'})}
        locale={gasketData?.intl?.locale || 'en-US'}
        cds={gasketData?.cds}
        subType='StandaloneAddon'
        shopperId={shopperId}
        productId={effectiveProductId}
        entitlementId={entitlementId}
        source={source}
        itc={getItcOverride() ?? itc}
        onSuccess={handleSuccess}
        onClose={handleClose}
        onErrorClick={onErrorClick}
        onLoadSuccess={handleLoadSuccess}
        onLoadError={handleError}
        LoadingComponent={LoadingComponent}
        renderErrorFallback={renderErrorFallback}
      />
    </ErrorBoundary>
  )
}

export default CreditsUpgradeContainer
