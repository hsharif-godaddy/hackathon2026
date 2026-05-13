'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useGasketData } from '@/hooks/useGasketData'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useUpgradePurchase } from '@/hooks/useUpgradePurchase'
import esmDeps from '@/lib/cdsEsmDeps'
import { getItcOverride } from '@/lib/itc'
import { shipAnalyticsLog } from '@/lib/logging'
import { AiroSubscription } from '@/lib/mgmt-airo/types';
import { isPlanUpgrade } from '@/lib/paywall/shared'
import { invalidatePlanQueries } from '@/lib/query-utils'
import type { CreditGrant } from '@/types/credits';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import { resetFocusOnModalClose } from '@/utils/focus'
import { logImpressionEvent } from '@/utils/instrumentation'
import { CDS_TYPE_ESM, CDS_TYPE_UMD, PAYWALL_UMD_FALLBACK } from './cdsConfig'
import { ComponentLoader } from './cdsLoader'
import { UPGRADE_PRODUCT_IDS } from './constants'
import { PaywallErrorFallback } from './PaywallErrorFallback'

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
  const umdFallback = useSwitchboard(PAYWALL_UMD_FALLBACK) ?? false

  const { data: subscription } = useSubscription()
  const productId = UPGRADE_PRODUCT_IDS.AIRO_BUILDER

  const entitlementId = subscription?.builderEntitlementId
  const subscriptionId = subscription?.id
  const hasLoggedImpressionRef = useRef(false)

  // Capture currentPlan at mount time to prevent UPP remount when subscription
  // data updates during purchase polling (currentPlan is only meant to bust
  // UPP cache between separate paywall sessions, not mid-purchase).
  const initialCurrentPlanRef = useRef(subscription?.downgradedPlan ?? subscription?.plan)

  // Defensive: if mounted before subscription loads (bypassing UpgradeContainer's
  // loading gate), self-heal once subscription becomes available.
  if (!initialCurrentPlanRef.current && subscription) {
    initialCurrentPlanRef.current = subscription.downgradedPlan ?? subscription.plan
  }

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
        subType='UniversalUpgrade'
        productNamespace='airobuildr' // spelling of airobuildr is correct
        allowPaidToPaidModal
        cds={gasketData?.cds}
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
        // used for breaking cache between conversions
        currentPlan={initialCurrentPlanRef.current}
      />
    </ErrorBoundary>
  )
}

export default HigherPlansUpgradeContainer
