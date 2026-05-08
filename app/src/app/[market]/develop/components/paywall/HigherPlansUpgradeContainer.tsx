'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useGasketData } from '@/hooks/useGasketData'
import { useSubscription } from '@/hooks/useSubscription'
import { useUpgradePurchase } from '@/hooks/useUpgradePurchase'
import { getItcOverride } from '@/lib/itc'
import { shipAnalyticsLog } from '@/lib/logging'
import { AiroSubscription } from '@/lib/mgmt-airo/types';
import { isPlanUpgrade } from '@/lib/paywall/shared'
import { invalidatePlanQueries } from '@/lib/query-utils'
import type { CreditGrant } from '@/types/credits';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import { resetFocusOnModalClose } from '@/utils/focus'
import { logImpressionEvent } from '@/utils/instrumentation'
import { ComponentLoader } from './cdsLoader'
import { UPGRADE_DEPS, UPGRADE_PRODUCT_IDS } from './constants'
import { PaywallErrorFallback } from './PaywallErrorFallback'
import { PaywallLoadingModal, PaywallLoadingModalVariant } from './PaywallLoadingModal'

const COMPONENT_NAME = 'HigherPlansUpgradeContainer'

interface HigherPlansUpgradeContainerProps {
  onClose: () => void
  onSuccessClick?: () => void
  onErrorClick?: () => void
  onError?: (error: Error) => void
  source?: string
  itc?: string
  /** Hivemind-driven recommended plan tier (e.g. 'professional' or 'ultimate') */
  recommendedPlan?: SubscriptionPlan.Professional | SubscriptionPlan.Ultimate;
}

const HigherPlansUpgradeContainer = ({
  onClose,
  onSuccessClick,
  onErrorClick,
  onError,
  source,
  itc,
  recommendedPlan,
}: HigherPlansUpgradeContainerProps) => {
  const gasketData = useGasketData()
  const { getUserInfo } = useAuth()
  const queryClient = useQueryClient()
  const shopperId = getUserInfo()?.shopperId
  const { handlePurchaseSuccess } = useUpgradePurchase()

  const { data: subscription } = useSubscription()
  const productId = UPGRADE_PRODUCT_IDS.AIRO_BUILDER

  const entitlementId = subscription?.builderEntitlementId
  const subscriptionId = subscription?.id
  const hasLoggedImpressionRef = useRef(false)

  useEffect(() => {
    if (!hasLoggedImpressionRef.current) {
      hasLoggedImpressionRef.current = true
      shipAnalyticsLog('paywall.higherPlans.modal.shown', {
        source,
        productId,
        entitlementId,
        component: COMPONENT_NAME,
      })
    }
  }, [source, productId, entitlementId])

  const handleSuccess = useCallback(({ planType }: { planType?: SubscriptionPlan }) => {
    const cachedData = queryClient.getQueryData<{ active?: AiroSubscription }>(['subscriptions'])
    const planBeforePurchase = cachedData?.active?.plan
    const downgradedPlan = cachedData?.active?.downgradedPlan;
    const planAfterPurchase = planType

    logImpressionEvent('plan.purchase.success')()
    shipAnalyticsLog('airoplus.purchase.in-app', { source, productId, fromPlan: planBeforePurchase, toPlan: planAfterPurchase })

    if (planType) {
      logImpressionEvent(`plan.purchase_${planType}.success`)()
      shipAnalyticsLog(`plan.purchase_${planType}.in-app`, { source, productId, fromPlan: planBeforePurchase, toPlan: planAfterPurchase })
    }

    // Renewal: same plan before and after - no polling needed since plan won't change
    if (planBeforePurchase && planAfterPurchase && planBeforePurchase === planAfterPurchase) {
      shipAnalyticsLog('paid_plan.renewal.success', { source, productId, plan: planAfterPurchase })
      invalidatePlanQueries(queryClient)
      onSuccessClick?.()
      resetFocusOnModalClose()
      return
    }

    // Renewal of the scheduled downgrade plan - no polling needed since plan won't change
    if (planBeforePurchase && downgradedPlan && planAfterPurchase && downgradedPlan === planAfterPurchase) {
      shipAnalyticsLog('paid_plan.renewal_downgrade.success', { source, productId, plan: planAfterPurchase })
      invalidatePlanQueries(queryClient)
      onSuccessClick?.()
      resetFocusOnModalClose()
      return
    }

    // Determine if this is an upgrade or downgrade
    // - Upgrade: plan changes immediately, poll until subscription.plan changes
    // - Downgrade: scheduled for term end, poll until downgradedAt/downgradedPlan are set
    const isUpgrade = isPlanUpgrade(planBeforePurchase, planAfterPurchase)

    // Capture the current plan-monthly grant ID at the moment of purchase
    let initialPlanMonthlyGrantId: string | undefined
    if (isUpgrade && subscriptionId) {
      const cachedGrants = queryClient.getQueryData<CreditGrant[]>(['credit-grants', subscriptionId, true])
      const planMonthlyGrant = cachedGrants?.find(
        (g) => g.type === GrantType.PlanMonthly && g.isAvailable
      )
      initialPlanMonthlyGrantId = planMonthlyGrant?.id
    }

    // Fire and forget - don't await. The polling modal will show via useIsUpgradePolling()
    // and the mutation's onSettled will handle query invalidation.
    handlePurchaseSuccess(
      planBeforePurchase,
      planAfterPurchase,
      downgradedPlan,
      isUpgrade,
      source,
      productId,
      isUpgrade ? subscriptionId : undefined,
      initialPlanMonthlyGrantId
    ).then(({ planAfterPurchase: polledPlan, updated, grantUpdated }) => {
      const changeType = isUpgrade ? 'upgrade' : 'downgrade'

      if (updated && polledPlan) {
        logImpressionEvent(`plan.${changeType}_${polledPlan}.success`)()
        shipAnalyticsLog(`airoplus.${changeType}.success`, {
          source,
          productId,
          fromPlan: planBeforePurchase,
          toPlan: polledPlan,
          grantUpdated,
        })
      }

      if (!updated) {
        shipAnalyticsLog(`airoplus.${changeType}.polling-timeout`, {
          source,
          productId,
          planBeforePurchase,
          planAfterPurchase,
        })
      }
    })
  }, [source, productId, queryClient, handlePurchaseSuccess, subscriptionId, onSuccessClick])

  const handleError = useCallback((error: Error) => {
    shipAnalyticsLog('paywall.cds.load.error', {
      source,
      productId,
      error: error.message,
      errorType: 'load',
      component: COMPONENT_NAME,
    })
    onError?.(error)
  }, [source, productId, onError])

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
        type='godaddyUnifiedPlansAndPricingLibrary'
        subType='UniversalUpgrade'
        // spelling of airobuildr is correct
        productNamespace='airobuildr'
        allowPaidToPaidModal
        cds={gasketData?.cds}
        deps={UPGRADE_DEPS}
        shopperId={shopperId}
        overrideItc={getItcOverride() ?? itc}
        accountId={entitlementId}
        requestedPlanType={recommendedPlan}
        locale={gasketData?.intl?.locale || 'en-US'}
        app="airo-builder"
        source="app-builder-NES"
        onClose={handleClose}
        upgradeCallback={handleSuccess}
        upgradeDowngradeCallback={handleSuccess}
        onPostUpgradeSuccessClick={handleSuccessClick}
        errorCallback={onErrorClick}
        onLoadError={handleError}
        LoadingComponent={
          <PaywallLoadingModal
            onClose={handleClose}
            variant={PaywallLoadingModalVariant.HigherPlans}
            source={source}
            component={COMPONENT_NAME}
          />
        }
        renderErrorFallback={(error) => (
          <PaywallErrorFallback
            error={error}
            onClose={handleClose}
            source={source}
            productId={productId}
            component={COMPONENT_NAME}
          />
        )}
        // used for breaking cache between conversions
        currentPlan={subscription?.downgradedPlan ?? subscription?.plan}
      />
    </ErrorBoundary>
  )
}

export default HigherPlansUpgradeContainer
