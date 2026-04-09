'use client'

import { useMemo } from 'react'

import { useBudgetService } from '@/hooks/useBudgetService'
import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { WarningLevel } from '@/types/usage'
import { getEffectiveCreditsSpent } from '@/utils/credits'

/** Warning level thresholds (percentage) */
const CAUTION_THRESHOLD = 50
const WARNING_THRESHOLD = 75
const TOAST_THRESHOLD = 90
const EXCEEDED_THRESHOLD = 100

export interface UseUsageOptions {
  appId: string | null
  enabled?: boolean
  isBudgetServiceEnabled?: boolean
  subscriptionId?: string | undefined
}

export interface UseUsageResult {
  percentage: number
  warningLevel: WarningLevel
  isWarningBannerActive: boolean
  isLoading: boolean
}

function computeWarningLevel(percentage: number): {
  warningLevel: WarningLevel
  isWarningBannerActive: boolean
} {
  let warningLevel: WarningLevel = WarningLevel.NONE
  if (percentage >= EXCEEDED_THRESHOLD) warningLevel = WarningLevel.EXCEEDED
  else if (percentage >= WARNING_THRESHOLD) warningLevel = WarningLevel.WARNING
  else if (percentage >= CAUTION_THRESHOLD) warningLevel = WarningLevel.CAUTION

  const isWarningBannerActive = percentage >= TOAST_THRESHOLD && percentage < EXCEEDED_THRESHOLD
  return { warningLevel, isWarningBannerActive }
}

export function useUsage({
  appId: _appId,
  enabled = true,
  isBudgetServiceEnabled = false,
  subscriptionId: externalSubscriptionId,
}: UseUsageOptions): UseUsageResult {
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription()
  const resolvedSubscriptionId = externalSubscriptionId ?? subscription?.id

  // Gate grants fetch: disabled when budget path active
  const { data: grants, isLoading: isGrantsDataLoading } = useCreditGrants({
    subscriptionId: enabled && !isBudgetServiceEnabled ? resolvedSubscriptionId : undefined,
  })

  // Budget path: React Query deduplicates with other callers
  const { data: budgetData, isLoading: isBudgetDataLoading } = useBudgetService({
    subscriptionId: resolvedSubscriptionId,
    enabled: enabled && isBudgetServiceEnabled,
  })

  const budgetResult = useMemo(() => {
    if (!budgetData) return { percentage: 0, warningLevel: WarningLevel.NONE, isWarningBannerActive: false }

    const used = Math.min(budgetData.creditsUsedNumeric, budgetData.creditsTotalNumeric)
    const percentage = budgetData.creditsTotalNumeric > 0
      ? (used / budgetData.creditsTotalNumeric) * 100
      : 0

    return { percentage, ...computeWarningLevel(percentage) }
  }, [budgetData])

  const isSubscriptionMissing = enabled && !isBudgetServiceEnabled && !isSubscriptionLoading && !subscription

  const grantsResult = useMemo(() => {
    const totalCreditsSpent = grants?.reduce(
      (sum, g) => sum + getEffectiveCreditsSpent(g.creditsSpent, g.creditsMax),
      0
    ) ?? 0
    const totalCreditsMax = grants?.reduce((sum, g) => sum + g.creditsMax, 0) ?? 0
    const percentage = totalCreditsMax > 0 ? (totalCreditsSpent / totalCreditsMax) * 100 : 0

    return { percentage, ...computeWarningLevel(percentage) }
  }, [grants])

  const isLoading = isBudgetServiceEnabled
    ? (enabled && (isSubscriptionLoading || isBudgetDataLoading))
    : (isSubscriptionLoading || isGrantsDataLoading || isSubscriptionMissing)

  const result = isBudgetServiceEnabled ? budgetResult : grantsResult

  return {
    percentage: result.percentage,
    warningLevel: result.warningLevel,
    isWarningBannerActive: result.isWarningBannerActive,
    isLoading,
  }
}
