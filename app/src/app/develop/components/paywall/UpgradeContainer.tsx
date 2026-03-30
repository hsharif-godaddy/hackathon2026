'use client'

import { useCallback, useEffect } from 'react'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useIsInCohort } from '@/hooks/useHivemind'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { shipAnalyticsLog } from '@/lib/logging'
import { SubscriptionPlan } from '@/types/credits'
import { logImpressionEvent } from '@/utils/instrumentation'
import HigherPlansUpgradeContainer from './HigherPlansUpgradeContainer'
import SinglePlanUpgradeContainer from './SinglePlanUpgradeContainer'

interface UpgradeContainerProps {
  onClose: () => void
  onSuccessClick?: () => void
  onErrorClick?: () => void
  onError?: (error: Error) => void
  source?: string
  itc?: string
}

export default function UpgradeContainer(props: UpgradeContainerProps) {
  const { onSuccessClick } = props
  const { data: isHigherPlansEnabled } = useSwitchboard('appbuilder-higher-plans')

  const isInTreatment = useIsInCohort(EXPERIMENT_IDS.recommendedPlan, 'treatment')
  const recommendedPlan = isInTreatment ? SubscriptionPlan.Ultimate : SubscriptionPlan.Professional;

  useEffect(() => {
    logImpressionEvent('paywall.upgrade.view')()
    shipAnalyticsLog('paywall.upgrade.view', {})
  }, [])
  
  const handleSuccessClick = useCallback(() => {
    onSuccessClick?.()
  }, [onSuccessClick])

  if (isHigherPlansEnabled) {
    return (
      <HigherPlansUpgradeContainer
        {...props}
        onSuccessClick={handleSuccessClick}
        recommendedPlan={recommendedPlan}
      />
    )
  }

  return (
    <SinglePlanUpgradeContainer
      {...props}
      onSuccessClick={handleSuccessClick}
    />
  )
}
