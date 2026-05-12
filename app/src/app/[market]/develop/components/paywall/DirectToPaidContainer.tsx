'use client'

import { useCallback, useEffect, useRef } from 'react'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useGasketData } from '@/hooks/useGasketData'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useUpgradePurchase } from '@/hooks/useUpgradePurchase'
import esmDeps from '@/lib/cdsEsmDeps'
import { getItcOverride } from '@/lib/itc'
import { shipAnalyticsLog } from '@/lib/logging'
import { SubscriptionPlan } from '@/types/credits'
import { resetFocusOnModalClose } from '@/utils/focus'
import { logImpressionEvent } from '@/utils/instrumentation'
import { CDS_TYPE_ESM, CDS_TYPE_UMD, PAYWALL_UMD_FALLBACK } from './cdsConfig'
import { ComponentLoader } from './cdsLoader'
import { D2P_OFFER_GROUP_IDS, UPGRADE_PRODUCT_IDS } from './constants'
import { PaywallErrorFallback } from './PaywallErrorFallback'

const COMPONENT_NAME = 'DirectToPaidContainer'

interface DirectToPaidContainerProps {
  onClose: () => void
  onError?: (error: Error) => void
  source?: string
  itc?: string
}

/** D2P purchase success result structure */
interface D2PPurchaseResult {
  purchaseData?: {
    items?: Array<{
      subscriptionId?: number
      productPackageId?: string
      label?: string
    }>
  }
}

const isValidSubscriptionPlan = (value: string | undefined): value is SubscriptionPlan =>
  !!value && Object.values(SubscriptionPlan).includes(value as SubscriptionPlan)

/**
 * Container component for Direct-to-Paid purchase flow
 *
 * Used when a user does not have an existing subscription or builderEntitlementId.
 * This allows users to purchase a new Airo Builder subscription directly.
 */
const DirectToPaidContainer = ({
  onClose,
  onError,
  source,
  itc,
}: DirectToPaidContainerProps) => {
  const gasketData = useGasketData()
  const { handlePurchaseSuccess } = useUpgradePurchase()
  const umdFallback = useSwitchboard(PAYWALL_UMD_FALLBACK) ?? false

  const productId = UPGRADE_PRODUCT_IDS.AIRO_BUILDER

  const hasLoggedImpressionRef = useRef(false)

  const handleClose = useCallback(() => {
    onClose()
    resetFocusOnModalClose()
  }, [onClose])

  // Log modal shown impression
  useEffect(() => {
    if (!hasLoggedImpressionRef.current) {
      hasLoggedImpressionRef.current = true
      shipAnalyticsLog('paywall.d2p-modal.shown', {
        source,
        productId,
        offerGroupId: D2P_OFFER_GROUP_IDS.AIRO_BUILDER_LINEUP,
        component: COMPONENT_NAME,
      })
      logImpressionEvent('paywall.d2p-modal.shown')()
    }
  }, [source, productId])

  // Called when D2P component loads successfully
  const handleLoadSuccess = useCallback(() => {
    shipAnalyticsLog('paywall.d2p-load.success', {
      source,
      productId,
      component: COMPONENT_NAME,
    })
    logImpressionEvent('paywall.d2p-load.success')()
  }, [source, productId])

  // Called when user clicks a CTA button
  const handleCtaClick = useCallback((planId: string, ctaType: string) => {
    shipAnalyticsLog('paywall.d2p-cta.click', {
      source,
      productId,
      planId,
      ctaType,
      component: COMPONENT_NAME,
    })
    logImpressionEvent('paywall.d2p-cta.click')()
  }, [source, productId])

  // Called when checkout starts
  const handleCheckoutStart = useCallback((basketId: string) => {
    shipAnalyticsLog('paywall.d2p-checkout.start', {
      source,
      productId,
      basketId,
      component: COMPONENT_NAME,
    })
    logImpressionEvent('paywall.d2p-checkout.start')()
  }, [source, productId])

  // Called when checkout encounters an error
  const handleCheckoutError = useCallback((error: Error) => {
    shipAnalyticsLog('paywall.d2p-checkout.error', {
      source,
      productId,
      error: error.message,
      component: COMPONENT_NAME,
    })
    logImpressionEvent('paywall.d2p-checkout.error')()
    onError?.(error)
  }, [source, productId, onError])

  // Called on purchase success - D2P passes a single purchase result object
  const handlePurchaseSuccessCallback = useCallback((purchaseResult: D2PPurchaseResult) => {
    // Extract plan type from productPackageId (e.g., "uuid.professional" -> "professional")
    const item = purchaseResult?.purchaseData?.items?.[0]
    const productPackageId = item?.productPackageId
    const extracted = productPackageId?.split('.').pop()
    const planAfterPurchase = isValidSubscriptionPlan(extracted) ? extracted : undefined
    const subscriptionId = item?.subscriptionId?.toString()

    // Close the D2P modal so the polling modal can be shown
    handleClose()

    logImpressionEvent('plan.purchase.success')()
    shipAnalyticsLog('airobuilder.purchase.d2p', {
      source,
      productId,
      toPlan: planAfterPurchase,
      subscriptionId,
    })

    if (planAfterPurchase) {
      logImpressionEvent(`plan.purchase_${planAfterPurchase}.success`)()
      shipAnalyticsLog(`plan.purchase_${planAfterPurchase}.d2p`, {
        source,
        productId,
        toPlan: planAfterPurchase,
      })
    }

    // For D2P, we're going from no subscription to a new subscription
    // Poll for the subscription to be created
    if (!planAfterPurchase) {
      shipAnalyticsLog('airobuilder.d2p.polling-skipped', {
        source,
        productId,
        reason: 'plan_not_found_in_purchase_response',
      })
      return
    }

    handlePurchaseSuccess(
      undefined, // No plan before purchase
      planAfterPurchase,
      undefined, // No downgraded plan
      true, // This is an upgrade (new subscription)
      source,
      productId,
      subscriptionId,
      undefined // No initial grant ID
    ).then(({ planAfterPurchase: polledPlan, updated, grantUpdated }) => {
      if (updated && polledPlan) {
        logImpressionEvent(`plan.d2p_${polledPlan}.success`)()
        shipAnalyticsLog('airobuilder.d2p.success', {
          source,
          productId,
          toPlan: polledPlan,
          grantUpdated,
        })
      }

      if (!updated) {
        shipAnalyticsLog('airobuilder.d2p.polling-timeout', {
          source,
          productId,
          planAfterPurchase,
        })
      }
    }).catch((error) => {
      shipAnalyticsLog('airobuilder.d2p.polling-error', {
        source,
        productId,
        error: error instanceof Error ? error.message : String(error),
      })
      onError?.(error instanceof Error ? error : new Error(String(error)))
    })
  }, [source, productId, handlePurchaseSuccess, handleClose, onError])

  // Called on general errors (not checkout-specific)
  const handleError = useCallback((error: Error) => {
    shipAnalyticsLog('paywall.d2p.error', {
      source,
      productId,
      error: error.message,
      component: COMPONENT_NAME,
    })
    onError?.(error)
  }, [source, productId, onError])

  // Called when CDS fails to load
  const handleLoadError = useCallback((error: Error) => {
    shipAnalyticsLog('paywall.cds.load.error', {
      source,
      productId,
      error: error.message,
      errorType: 'load',
      component: COMPONENT_NAME,
    })
    onError?.(error)
  }, [source, productId, onError])

  const LoadingComponent = useCallback(() => null, [])

  return (
    <ErrorBoundary
      fallback={(error) => (
        <PaywallErrorFallback
          error={error}
          onClose={handleClose}
          onError={handleError}
          source={source}
          productId={productId}
          component={COMPONENT_NAME}
        />
      )}
    >
      <ComponentLoader
        type={umdFallback ? CDS_TYPE_UMD : CDS_TYPE_ESM}
        {...(!umdFallback && { loaderMode: 'esm', deps: esmDeps })}
        subType='DirectToPaid'
        offerGroupId={D2P_OFFER_GROUP_IDS.AIRO_BUILDER_LINEUP}
        productId={productId}
        cds={gasketData?.cds}
        locale={gasketData?.intl?.locale || 'en-US'}
        app="airo-builder"
        source={source || 'app-builder-D2P'}
        itc={getItcOverride() ?? itc}
        // D2P callbacks
        onLoadSuccess={handleLoadSuccess}
        onCtaClick={handleCtaClick}
        onCheckoutStart={handleCheckoutStart}
        onCheckoutError={handleCheckoutError}
        onPurchaseSuccess={handlePurchaseSuccessCallback}
        onError={handleError}
        onClose={handleClose}
        // CDS loader callbacks
        onLoadError={handleLoadError}
        LoadingComponent={LoadingComponent}
        renderErrorFallback={(error) => (
          <PaywallErrorFallback
            error={error}
            onClose={handleClose}
            source={source}
            productId={productId}
            component={COMPONENT_NAME}
          />
        )}
      />
    </ErrorBoundary>
  )
}

export default DirectToPaidContainer
