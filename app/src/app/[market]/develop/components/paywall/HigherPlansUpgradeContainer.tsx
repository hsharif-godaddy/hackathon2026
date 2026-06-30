'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import ErrorBoundary from '@/components/ErrorBoundary';
import { useAuth } from '@/hooks/useAuth';
import { useCreditGrants } from '@/hooks/useCreditGrants';
import { useGasketData } from '@/hooks/useGasketData';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useUpgradePurchase } from '@/hooks/useUpgradePurchase';
import { getItcOverride } from '@/lib/itc';
import { shipAnalyticsLog } from '@/lib/logging';
import { AiroSubscription } from '@/lib/mgmt-airo/types';
import { isPlanUpgrade } from '@/lib/paywall/shared';
import { invalidatePlanQueries } from '@/lib/query-utils';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import { resetFocusOnModalClose } from '@/utils/focus';
import { logImpressionEvent } from '@/utils/instrumentation';
import { CDS_TYPE_ESM, CDS_TYPE_UMD, PAYWALL_UMD_FALLBACK } from './cdsConfig';
import { ComponentLoader } from './cdsLoader';
import { UPGRADE_PRODUCT_IDS } from './constants';
import { PaywallErrorFallback } from './PaywallErrorFallback';

const COMPONENT_NAME = 'HigherPlansUpgradeContainer';
const NullLoadingComponent = () => null;

type RenewalType = 'same_plan' | 'downgrade_plan' | null;

function detectRenewal(
  planBefore: SubscriptionPlan | undefined,
  planAfter: SubscriptionPlan | undefined,
  downgradedPlan: SubscriptionPlan | undefined
): RenewalType {
  if (planBefore && planAfter && planBefore === planAfter) return 'same_plan';
  if (planBefore && downgradedPlan && planAfter && downgradedPlan === planAfter)
    return 'downgrade_plan';
  return null;
}

interface HigherPlansUpgradeContainerProps {
  onClose: () => void;
  onSuccessClick?: () => void;
  onErrorClick?: () => void;
  onError?: (error: Error) => void;
  source?: string;
  itc?: string;
}

const HigherPlansUpgradeContainer = ({
  onClose,
  onSuccessClick,
  onErrorClick,
  onError,
  source,
  itc,
}: HigherPlansUpgradeContainerProps) => {
  const gasketData = useGasketData();
  const { getUserInfo } = useAuth();
  const queryClient = useQueryClient();
  const shopperId = getUserInfo()?.shopperId;
  const { handlePurchaseSuccess } = useUpgradePurchase();
  const umdFallback = useSwitchboard(PAYWALL_UMD_FALLBACK) ?? false;
  const setPaywallLoading = usePaywallStore((state) => state.setPaywallLoading);

  const { data: subscription } = useSubscription();
  const productId = UPGRADE_PRODUCT_IDS.AIRO_BUILDER;

  const entitlementId = subscription?.builderEntitlementId;
  const subscriptionId = subscription?.id;

  const { data: grants } = useCreditGrants({ subscriptionId });

  const hasLoggedImpressionRef = useRef(false);

  // Capture currentPlan at mount time to prevent UPP remount when subscription
  // data updates during purchase polling (currentPlan is only meant to bust
  // UPP cache between separate paywall sessions, not mid-purchase).
  const initialCurrentPlanRef = useRef(subscription?.downgradedPlan ?? subscription?.plan);

  const initialCreditsMaxRef = useRef(
    grants?.find((g) => g.type === GrantType.PlanMonthly && g.isAvailable)?.creditsMax
  );

  // Defensive: if mounted before subscription loads (bypassing UpgradeContainer's
  // loading gate), self-heal once subscription becomes available.
  if (!initialCurrentPlanRef.current && subscription) {
    initialCurrentPlanRef.current = subscription.downgradedPlan ?? subscription.plan;
  }

  if (typeof initialCreditsMaxRef.current !== 'number' && grants) {
    const planMonthlyGrant = grants.find((g) => g.type === GrantType.PlanMonthly && g.isAvailable);
    if (planMonthlyGrant && typeof planMonthlyGrant.creditsMax === 'number') {
      initialCreditsMaxRef.current = planMonthlyGrant.creditsMax;
    }
  }

  useEffect(() => {
    if (!hasLoggedImpressionRef.current) {
      hasLoggedImpressionRef.current = true;
      shipAnalyticsLog('paywall.higherPlans.modal.shown', {
        source,
        productId,
        entitlementId,
        component: COMPONENT_NAME,
      });
    }
  }, [source, productId, entitlementId]);

  const handleSuccess = useCallback(
    ({ planType }: { planType?: SubscriptionPlan }) => {
      const cachedData = queryClient.getQueryData<{ active?: AiroSubscription }>(['subscriptions']);
      const planBeforePurchase = cachedData?.active?.plan;
      const downgradedPlan = cachedData?.active?.downgradedPlan;
      const planAfterPurchase = planType;

      logImpressionEvent('plan.purchase.success')();
      shipAnalyticsLog('airoplus.purchase.in-app', {
        source,
        productId,
        fromPlan: planBeforePurchase,
        toPlan: planAfterPurchase,
      });

      if (planType) {
        logImpressionEvent(`plan.purchase_${planType}.success`)();
        shipAnalyticsLog(`plan.purchase_${planType}.in-app`, {
          source,
          productId,
          fromPlan: planBeforePurchase,
          toPlan: planAfterPurchase,
        });
      }

      const renewal = detectRenewal(planBeforePurchase, planAfterPurchase, downgradedPlan);
      if (renewal) {
        const event =
          renewal === 'same_plan'
            ? 'paid_plan.renewal.success'
            : 'paid_plan.renewal_downgrade.success';
        shipAnalyticsLog(event, { source, productId, plan: planAfterPurchase });
        invalidatePlanQueries(queryClient);
        onSuccessClick?.();
        resetFocusOnModalClose();
        return;
      }

      const isUpgrade = isPlanUpgrade(planBeforePurchase, planAfterPurchase);

      handlePurchaseSuccess(
        planBeforePurchase,
        planAfterPurchase,
        downgradedPlan,
        isUpgrade,
        source,
        productId,
        isUpgrade ? subscriptionId : undefined,
        isUpgrade ? initialCreditsMaxRef.current : undefined
      ).then(({ planAfterPurchase: polledPlan, updated, grantUpdated }) => {
        const changeType = isUpgrade ? 'upgrade' : 'downgrade';

        if (updated && polledPlan) {
          logImpressionEvent(`plan.${changeType}_${polledPlan}.success`)();
          shipAnalyticsLog(`airoplus.${changeType}.success`, {
            source,
            productId,
            fromPlan: planBeforePurchase,
            toPlan: polledPlan,
            grantUpdated,
          });
        }

        if (!updated) {
          shipAnalyticsLog(`airoplus.${changeType}.polling-timeout`, {
            source,
            productId,
            planBeforePurchase,
            planAfterPurchase,
          });
        }
      });
    },
    [source, productId, queryClient, handlePurchaseSuccess, subscriptionId, onSuccessClick]
  );

  const handleLoadSuccess = useCallback(() => {
    document.body.removeAttribute('data-paywall-loading');
    setPaywallLoading(false);
    shipAnalyticsLog('paywall.higherPlans.load.success', {
      source,
      productId,
      component: COMPONENT_NAME,
    });
  }, [source, productId, setPaywallLoading]);

  const handleError = useCallback(
    (error: Error) => {
      setPaywallLoading(false);
      shipAnalyticsLog('paywall.cds.load.error', {
        source,
        productId,
        error: error.message,
        errorType: 'load',
        component: COMPONENT_NAME,
      });
      onError?.(error);
    },
    [source, productId, onError, setPaywallLoading]
  );

  const handleClose = useCallback(() => {
    onClose();
    resetFocusOnModalClose();
  }, [onClose]);

  const handleSuccessClick = useCallback(() => {
    onSuccessClick?.();
    resetFocusOnModalClose();
  }, [onSuccessClick]);

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
        {...(!umdFallback && { loaderMode: 'esm' })}
        subType="UniversalUpgrade"
        LoadingComponent={NullLoadingComponent}
        productNamespace="airobuildr" // spelling of airobuildr is correct
        allowPaidToPaidModal
        cds={gasketData?.cds}
        shopperId={shopperId}
        overrideItc={getItcOverride() ?? itc}
        accountId={entitlementId}
        requestedPlanType={SubscriptionPlan.Professional}
        locale={gasketData?.intl?.locale || 'en-US'}
        app="airo-builder"
        source="app-builder-NES"
        onClose={handleClose}
        upgradeCallback={handleSuccess}
        upgradeDowngradeCallback={handleSuccess}
        onPostUpgradeSuccessClick={handleSuccessClick}
        errorCallback={onErrorClick}
        onLoadSuccess={handleLoadSuccess}
        onLoadError={handleError}
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
  );
};

export default HigherPlansUpgradeContainer;
