'use client'

import { useMemo } from 'react'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { TOAST_THRESHOLD, useDailyUsage } from '@/hooks/useDailyUsage'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { WarningLevel } from '@/types/usage'
import { getEffectiveCreditsSpent } from '@/utils/credits'

/** Warning level thresholds (percentage) */
const CAUTION_THRESHOLD = 50
const WARNING_THRESHOLD = 75
const EXCEEDED_THRESHOLD = 100

export interface UseUsageOptions {
  appId: string | null
  enabled?: boolean
}

export interface UseUsageResult {
  percentage: number
  warningLevel: WarningLevel
  isWarningBannerActive: boolean
  isLoading: boolean
  isGrantsEnabled: boolean
}

export function useUsage({ appId, enabled = true }: UseUsageOptions): UseUsageResult {
  const { data: isGrantsEnabled, isLoading: isGrantsLoading } = useSwitchboard('app-builder-grants')

  // Legacy daily usage (non-grants mode)
  const {
    data: legacyData,
    isLoading: isLegacyLoading,
    warningLevel: legacyWarningLevel,
    isWarningBannerActive: legacyWarningActive,
  } = useDailyUsage({
    appId,
    enabled: enabled && isGrantsEnabled === false
  })

  // Grants-based usage
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription()
  const { data: grants, isLoading: isGrantsDataLoading } = useCreditGrants({
    subscriptionId: (enabled && isGrantsEnabled === true) ? subscription?.id : undefined,
  })

  const isSubscriptionMissing = isGrantsEnabled === true && !isSubscriptionLoading && !subscription

  const grantsResult = useMemo(() => {
    const totalCreditsSpent = grants?.reduce(
      (sum, g) => sum + getEffectiveCreditsSpent(g.creditsSpent, g.creditsMax),
      0
    ) ?? 0
    const totalCreditsMax = grants?.reduce((sum, g) => sum + g.creditsMax, 0) ?? 0
    const percentage = totalCreditsMax > 0 ? (totalCreditsSpent / totalCreditsMax) * 100 : 0

    let warningLevel: WarningLevel = WarningLevel.NONE
    if (percentage >= EXCEEDED_THRESHOLD) {warningLevel = WarningLevel.EXCEEDED}
    else if (percentage >= WARNING_THRESHOLD) {warningLevel = WarningLevel.WARNING}
    else if (percentage >= CAUTION_THRESHOLD) {warningLevel = WarningLevel.CAUTION}

    const isWarningBannerActive = percentage >= TOAST_THRESHOLD && percentage < EXCEEDED_THRESHOLD

    return { percentage, warningLevel, isWarningBannerActive }
  }, [grants])

  const isLoading = isGrantsLoading || (isGrantsEnabled === true
    ? (isSubscriptionLoading || isGrantsDataLoading || isSubscriptionMissing)
    : isLegacyLoading)

  if (isGrantsEnabled === true) {
    return {
      percentage: grantsResult.percentage,
      warningLevel: grantsResult.warningLevel,
      isWarningBannerActive: grantsResult.isWarningBannerActive,
      isLoading,
      isGrantsEnabled: true,
    }
  }

  return {
    percentage: legacyData?.percentage ?? 0,
    warningLevel: legacyWarningLevel,
    isWarningBannerActive: legacyWarningActive,
    isLoading,
    isGrantsEnabled: false,
  }
}
