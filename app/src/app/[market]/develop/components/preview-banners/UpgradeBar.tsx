'use client';

import { usePathname } from 'next/navigation';
import React, { useCallback, useEffect, useRef } from 'react';

import { ESM_MONETIZATION_BANNER } from '@/app/[market]/develop/components/paywall/cdsConfig';
import { ComponentLoader } from '@/app/[market]/develop/components/paywall/cdsLoader';
import { UPGRADE_PRODUCT_IDS } from '@/app/[market]/develop/components/paywall/constants';
import UpgradeBarFallback from '@/app/[market]/develop/components/preview-banners/UpgradeBarFallback';
import { useAuth } from '@/hooks/useAuth';
import { useGasketData } from '@/hooks/useGasketData';
import { useSubscription } from '@/hooks/useSubscription';
import { useUpgradeBannerExperiment } from '@/hooks/useUpgradeBannerExperiment';
import { getItcOverride } from '@/lib/itc';
import { shipAnalyticsLog } from '@/lib/logging';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { SubscriptionPlan } from '@/types/credits';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

const BANNER_SOURCE = 'AiroAppBuilder';

export default function UpgradeBar(): React.ReactElement | null {
  const gasketData = useGasketData();
  const pathname = usePathname();
  const { getUserInfo } = useAuth();
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal);
  const { showPreviewBar, dismiss } = useUpgradeBannerExperiment();
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription();
  const hasLoggedCdsImpressionRef = useRef(false);
  const hasLoggedFallbackImpressionRef = useRef(false);

  const shopperId = getUserInfo()?.shopperId;
  const entitlementId = subscription?.builderEntitlementId;
  const subscriptionId = subscription?.id;
  const productId = UPGRADE_PRODUCT_IDS.AIRO_BUILDER;
  const currentPlan = subscription?.downgradedPlan ?? subscription?.plan;
  const showCdsBanner = !isSubscriptionLoading && !!shopperId && !!entitlementId && !!subscriptionId;
  const showFallback = !showCdsBanner;

  useEffect(() => {
    if (!showPreviewBar) return;

    if (showCdsBanner && !hasLoggedCdsImpressionRef.current) {
      logImpressionEvent('preview.upgradeBanner.view')();
      hasLoggedCdsImpressionRef.current = true;
      return;
    }

    if (showFallback && !hasLoggedFallbackImpressionRef.current) {
      logImpressionEvent('preview.upgradeBanner.fallback.view')();
      hasLoggedFallbackImpressionRef.current = true;
    }
  }, [showPreviewBar, showCdsBanner, showFallback]);

  const handleClose = useCallback((): void => {
    logClickEvent('preview.upgradeBanner.close')();
    dismiss();
  }, [dismiss]);

  const handleViewPlansClick = useCallback((): void => {
    logClickEvent('preview.upgradeBanner.upgrade')();
    openUpgradeModal('preview.upgradeBanner.upgrade', PAYWALL_ITC.UPGRADE);
  }, [openUpgradeModal]);

  const handleError = useCallback(
    (error: Error) => {
      shipAnalyticsLog('paywall.cds.load.error', {
        source: BANNER_SOURCE,
        productId,
        error: error.message,
        errorType: 'banner_upgrade',
        component: 'UpgradeBar',
      });
    },
    [productId]
  );

  if (!showPreviewBar) return null;

  if (showFallback) {
    return <UpgradeBarFallback onClose={handleClose} />;
  }

  return (
    <ComponentLoader
      dismissable
      isDarkTheme
      accountId={entitlementId}
      allowPaidToPaidModal
      appName='airo-builder'
      cds={gasketData?.cds}
      containerClassName='cds-monetization-banner'
      currentPlan={currentPlan}
      errorCallback={handleError}
      loaderMode='esm'
      locale={gasketData?.intl?.locale || 'en-US'}
      onClose={handleClose}
      onLoadError={handleError}
      onViewPlansClick={handleViewPlansClick}
      overrideItc={getItcOverride()}
      portal={false}
      productNamespace='airobuildr'
      requestedPlanType={SubscriptionPlan.Professional}
      returnApp='airo-builder'
      returnPath={pathname}
      shopperId={shopperId}
      source={BANNER_SOURCE}
      subscriptionId={subscriptionId}
      type={ESM_MONETIZATION_BANNER}
    />
  );
}
