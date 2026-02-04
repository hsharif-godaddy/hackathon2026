'use client'

import dynamic from 'next/dynamic';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import uxAlert from '@ux/alert';
import uxButton from '@ux/button';
import uxIcon from '@ux/icon';
import uxModal from '@ux/modal';
import uxRadio from '@ux/radio';
import uxSpinner from '@ux/spinner';
import uxTag from '@ux/tag';
import uxText from '@ux/text';
import uxTooltip from '@ux/tooltip';
import uxTooltipLegacy from '@ux/tooltip-legacy';

import ErrorBoundary from '@/components/ErrorBoundary';
import { useAuth } from '@/hooks/useAuth';
import { useGasketData } from '@/hooks/useGasketData';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { shipAnalyticsLog } from '@/lib/logging';
import { logImpressionEvent } from '@/utils/instrumentation';
import { ensurePropTypes } from '@/utils/propTypes';

/**
 * Product IDs for unified plans and pricing library
 */
export const UPGRADE_PRODUCT_IDS = {
  /** Legacy Airo Plus product */
  AIRO_PLUS: 'AiroPlusAppBuilderProduct',
  /** New Airo Builder subscription product */
  AIRO_BUILDER: 'AiroBuilderProduct',
  /** Airo Builder credits add-on product */
  AIRO_BUILDER_CREDITS: 'AiroBuilderCreditsProduct',
} as const;

export type UpgradeProductId = typeof UPGRADE_PRODUCT_IDS[keyof typeof UPGRADE_PRODUCT_IDS];

const ComponentLoader = dynamic(
  async () => {
    await ensurePropTypes()
    const cdsLoaderModule = await import('@venture/cds-loader')
    return cdsLoaderModule.default
  },
  { ssr: false }
) as any

/**
 * Shared UX dependencies for unified plans and pricing library components
 */
export const UPGRADE_DEPS = {
  uxAlert: { module: uxAlert, version: '2500.7.2' },
  uxButton: { module: uxButton, version: '2500.7.2' },
  uxIcon: { module: uxIcon, version: '2500.7.2' },
  uxModal: { module: uxModal, version: '2500.7.2' },
  uxRadio: { module: uxRadio, version: '2500.7.1' },
  uxSpinner: { module: uxSpinner, version: '2500.7.1' },
  uxTag: { module: uxTag, version: '2500.7.2' },
  uxText: { module: uxText, version: '2500.7.1' },
  uxTooltip: { module: uxTooltip, version: '2500.7.2' },
  uxTooltipLegacy: { module: uxTooltipLegacy, version: '2400.15.1' }
};

interface SinglePlanUpgradeContainerProps {
  onClose: () => void
  onSuccessClick?: () => void
  onErrorClick?: () => void
  source?: string
}

const SinglePlanUpgradeContainer = ({
  onClose,
  onSuccessClick,
  onErrorClick,
  source,
}: SinglePlanUpgradeContainerProps) => {
  const gasketData = useGasketData();
  const { getUserInfo } = useAuth();
  const queryClient = useQueryClient();
  const shopperId = getUserInfo()?.shopperId;

  // Determine product ID based on feature flag
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants');
  const productId = isGrantsEnabled
    ? UPGRADE_PRODUCT_IDS.AIRO_BUILDER
    : UPGRADE_PRODUCT_IDS.AIRO_PLUS;

  const handleSuccess = useCallback(() => {
    // Log impression event for purchase success tracking. Do not remove - required for https://godaddy-corp.atlassian.net/browse/NEX-5186
    logImpressionEvent('plan.purchase.success')()

    // Ship unified analytics log to Elastic for all purchase paths
    shipAnalyticsLog('airoplus.purchase.in-app', { source, productId })

    // Invalidate paywall-related queries so UI updates with new subscription status
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['active-subscription'] })
    queryClient.invalidateQueries({ queryKey: ['paywall-feature-flags'] })
    queryClient.invalidateQueries({ queryKey: ['entitlements'] })
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }, [source, productId, queryClient])

  return (
    <ErrorBoundary>
      <ComponentLoader
        type='godaddyUnifiedPlansAndPricingLibrary'
        cds={ gasketData?.cds }
        subType='SinglePlanUpgrade'
        deps={UPGRADE_DEPS}
        shopperId={ shopperId }
        productId={productId}
        locale={gasketData?.intl?.locale || 'en-US'}
        returnApp="airo-builder"
        source="app-builder"
        onClose={onClose}
        onPurchaseSuccess={handleSuccess}
        onSuccessClick={onSuccessClick}
        onErrorClick={onErrorClick}
        secondaryCTA={{
          skipDefaultBehavior: true,
          onClick: onClose
        }}
      />
    </ErrorBoundary>
  )
};
export default SinglePlanUpgradeContainer;
