import ComponentLoader from '@venture/cds-loader';

import { useAuth } from '@/hooks/useAuth';
import { useGasketData } from '@/hooks/useGasketData'

const SinglePlanUpgradeContainer = ({ onClose, onSuccessClick, onErrorClick }) => {
  const gasketData = useGasketData();
  const { getUserInfo } = useAuth();
  const shopperId = getUserInfo()?.shopperId;

  return (
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
      onSuccessClick={onSuccessClick}
      onErrorClick={onErrorClick}
      secondaryCTA={{
        skipDefaultBehavior: true,
        onClick: onClose
      }}
    />
  )
};
export default SinglePlanUpgradeContainer;