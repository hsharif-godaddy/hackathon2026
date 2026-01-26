import { useCallback } from 'react';
import ComponentLoader from '@venture/cds-loader';

import ErrorBoundary from '@/components/ErrorBoundary';
import { useAuth } from '@/hooks/useAuth';
import { useGasketData } from '@/hooks/useGasketData'
import { shipAnalyticsLog } from '@/lib/logging'
import { logImpressionEvent } from '@/utils/instrumentation'

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
  const shopperId = getUserInfo()?.shopperId;

  const handleSuccess = useCallback(() => {
    // Log impression event for purchase success tracking. Do not remove - required for https://godaddy-corp.atlassian.net/browse/NEX-5186
    logImpressionEvent('plan.purchase.success')()

    // Ship unified analytics log to Elastic for all purchase paths
    shipAnalyticsLog('airoplus.purchase.in-app', { source })
  }, [source])

  return (
    <ErrorBoundary>
      <ComponentLoader
        type='godaddyUnifiedPlansAndPricingLibrary'
        cds={ gasketData?.cds }
        subType='SinglePlanUpgrade'
        deps={{}}
        shopperId={ shopperId }
        productId='AiroPlusAppBuilderProduct'
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
