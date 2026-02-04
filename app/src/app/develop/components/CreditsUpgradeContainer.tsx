'use client'

import dynamic from 'next/dynamic';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import ErrorBoundary from '@/components/ErrorBoundary';
import { useAuth } from '@/hooks/useAuth';
import { useGasketData } from '@/hooks/useGasketData';
import { shipAnalyticsLog } from '@/lib/logging';
import { logImpressionEvent } from '@/utils/instrumentation';
import { ensurePropTypes } from '@/utils/propTypes';
import { UPGRADE_DEPS, UPGRADE_PRODUCT_IDS } from './SinglePlanUpgradeContainer';

const ComponentLoader = dynamic(
  async () => {
    await ensurePropTypes()
    const cdsLoaderModule = await import('@venture/cds-loader')
    return cdsLoaderModule.default
  },
  { ssr: false }
) as any

interface CreditsUpgradeContainerProps {
  onClose: () => void
  onSuccess?: (basketId: string, details: { unitsAdded: number; newTotalBalance: number }) => void
  onErrorClick?: () => void
  source?: string
  /** Builder entitlement ID from the subscription (required for credits purchase) */
  entitlementId?: string
}

/**
 * Container component for purchasing Airo Builder credits
 *
 * Uses the unified plans and pricing library with the AddOnPurchase subtype
 * to allow users to purchase credit packs for their existing subscription.
 */
const CreditsUpgradeContainer = ({
  onClose,
  onSuccess,
  onErrorClick,
  source = 'airo-builder',
  entitlementId,
}: CreditsUpgradeContainerProps) => {
  const gasketData = useGasketData();
  const { getUserInfo } = useAuth();
  const queryClient = useQueryClient();
  const shopperId = getUserInfo()?.shopperId;

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

  // Early return if entitlementId is missing - cannot purchase credits without it
  if (!entitlementId) {
    return null;
  }

  return (
    <ErrorBoundary>
      <ComponentLoader
        type='godaddyUnifiedPlansAndPricingLibrary'
        cds={gasketData?.cds}
        subType='AddOnPurchase'
        deps={UPGRADE_DEPS}
        shopperId={shopperId}
        productId={UPGRADE_PRODUCT_IDS.AIRO_BUILDER_CREDITS}
        entitlementId={entitlementId}
        source={source}
        onSuccess={handleSuccess}
        onClose={onClose}
        onErrorClick={onErrorClick}
      />
    </ErrorBoundary>
  )
};

export default CreditsUpgradeContainer;
