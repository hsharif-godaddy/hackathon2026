'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useGasketData } from '@/hooks/useGasketData'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useUpgradePurchase } from '@/hooks/useUpgradePurchase'
import { shipAnalyticsLog } from '@/lib/logging'
import { AiroSubscription } from '@/lib/mgmt-airo/types';
import { isPlanUpgrade } from '@/lib/paywall/shared'
import { SubscriptionPlan } from '@/types/credits';
import { logImpressionEvent } from '@/utils/instrumentation'
import { ComponentLoader } from './cdsLoader'
import { UPGRADE_DEPS, UPGRADE_PRODUCT_IDS } from './constants'
import { PaywallErrorFallback } from './PaywallErrorFallback'
import { PaywallLoadingModal, PaywallLoadingModalVariant } from './PaywallLoadingModal'

interface HigherPlansUpgradeContainerProps {
  onClose: () => void
  onSuccessClick?: () => void
  onErrorClick?: () => void
  onError?: (error: Error) => void
  source?: string
  itc?: string
}

const HigherPlansUpgradeContainer = ({
  onClose,
  onSuccessClick,
  onErrorClick,
  onError,
  source,
  itc,
}: HigherPlansUpgradeContainerProps) => {
  const gasketData = useGasketData()
  const { getUserInfo } = useAuth()
  const queryClient = useQueryClient()
  const shopperId = getUserInfo()?.shopperId
  const { handlePurchaseSuccess } = useUpgradePurchase()

  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants')
  const { data: subscription } = useSubscription()
  const productId = isGrantsEnabled
    ? UPGRADE_PRODUCT_IDS.AIRO_BUILDER
    : UPGRADE_PRODUCT_IDS.AIRO_PLUS

  const entitlementId = isGrantsEnabled ? subscription?.builderEntitlementId : undefined

  const handleSuccess = useCallback(({ planType }: { planType?: SubscriptionPlan }) => {
    const cachedData = queryClient.getQueryData<{ active?: AiroSubscription }>(['subscriptions'])
    const planBeforePurchase = cachedData?.active?.plan
    const downgradedPlan = cachedData?.active?.downgradedPlan;
    const planAfterPurchase = planType

    logImpressionEvent('plan.purchase.success')()
    shipAnalyticsLog('airoplus.purchase.in-app', { source, productId, fromPlan: planBeforePurchase, toPlan: planAfterPurchase })

    // Determine if this is an upgrade or downgrade
    // - Upgrade: plan changes immediately, poll until subscription.plan changes
    // - Downgrade: scheduled for term end, poll until downgradedAt/downgradedPlan are set
    const isUpgrade = isPlanUpgrade(planBeforePurchase, planAfterPurchase)

    // Fire and forget - don't await. The polling modal will show via useIsUpgradePolling()
    // and the mutation's onSettled will handle query invalidation.
    handlePurchaseSuccess(planBeforePurchase, planAfterPurchase, downgradedPlan, isUpgrade, source, productId).then(({ planAfterPurchase: polledPlan, updated }) => {
      const changeType = isUpgrade ? 'upgrade' : 'downgrade'

      if (updated && polledPlan) {
        logImpressionEvent(`plan.${changeType}_${polledPlan}.success`)()
        shipAnalyticsLog(`airoplus.${changeType}.success`, {
          source,
          productId,
          fromPlan: planBeforePurchase,
          toPlan: polledPlan,
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
  }, [source, productId, queryClient, handlePurchaseSuccess])

  const handleError = useCallback((error: Error) => {
    shipAnalyticsLog('paywall.cds.load.error', {
      source,
      productId,
      error: error.message,
      component: 'HigherPlansUpgradeContainer',
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
        subType='UniversalUpgrade'
        // spelling of airobuildr is correct
        productNamespace='airobuildr'
        allowPaidToPaidModal
        cds={gasketData?.cds}
        deps={UPGRADE_DEPS}
        shopperId={shopperId}
        overrideItc={itc}
        accountId={entitlementId}
        locale={gasketData?.intl?.locale || 'en-US'}
        app="airo-builder"
        source="app-builder-NES"
        onClose={onClose}
        upgradeCallback={handleSuccess}
        upgradeDowngradeCallback={handleSuccess}
        onPostUpgradeSuccessClick={onSuccessClick}
        errorCallback={onErrorClick}
        onError={handleError}
        LoadingComponent={<PaywallLoadingModal onClose={onClose} variant={PaywallLoadingModalVariant.HigherPlans} />}
        // used for breaking cache between conversions
        currentPlan={subscription?.downgradedPlan ?? subscription?.plan}
      />
    </ErrorBoundary>
  )
}

export default HigherPlansUpgradeContainer
