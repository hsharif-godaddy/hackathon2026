'use client'

import { useMemo } from 'react'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { WarningLevel } from '@/types/usage'
import { getTotalCreditsFromGrants } from '@/utils/credits'

/** Warning level thresholds (percentage) */
const CAUTION_THRESHOLD = 50
const WARNING_THRESHOLD = 75
const EXCEEDED_THRESHOLD = 100

/** Banner trigger: warn when remaining credits fall within this clamped window.
 * Uses 10% of total, with a floor of 10 (prevents near-instant warnings on tiny
 * 25-credit packs) and a cap of 100 (prevents false urgency for large/stacked accounts). */
const WARN_RATIO = 0.10
const WARN_FLOOR = 10
const WARN_CAP = 100

export interface UseUsageOptions {
  appId: string | null
  enabled?: boolean
  subscriptionId?: string | undefined
}

export interface UseUsageResult {
  percentage: number
  creditsRemaining: number
  warningLevel: WarningLevel
  isWarningBannerActive: boolean
  isLoading: boolean
}

function computeWarningLevel(percentage: number): { warningLevel: WarningLevel } {
  let warningLevel: WarningLevel = WarningLevel.NONE
  if (percentage >= EXCEEDED_THRESHOLD) warningLevel = WarningLevel.EXCEEDED
  else if (percentage >= WARNING_THRESHOLD) warningLevel = WarningLevel.WARNING
  else if (percentage >= CAUTION_THRESHOLD) warningLevel = WarningLevel.CAUTION
  return { warningLevel }
}

function computeWarningBannerActive(totalCreditsMax: number, totalCreditsRemaining: number): boolean {
  if (totalCreditsRemaining <= 0) return false
  const threshold = Math.min(WARN_CAP, Math.max(WARN_FLOOR, Math.floor(totalCreditsMax * WARN_RATIO)))
  return totalCreditsRemaining <= threshold
}

/**
 * Hook to compute credit usage percentage and warning levels.
 *
 * Data source (BMS vs legacy grants) is determined by the BFF based on
 * feature flag and subscription.bmsBudgetId. The client always receives
 * CreditGrant[] format for backwards compatibility.
 */
export function useUsage({
  appId: _appId,
  enabled = true,
  subscriptionId: externalSubscriptionId,
}: UseUsageOptions): UseUsageResult {
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription()
  const resolvedSubscriptionId = externalSubscriptionId ?? subscription?.id

  const { data: grants, isLoading: isGrantsLoading } = useCreditGrants({
    subscriptionId: enabled ? resolvedSubscriptionId : undefined,
  })

  // Only treat subscription as "missing" if we're relying on useSubscription() to provide it
  // (i.e., no external subscriptionId was passed)
  const isSubscriptionMissing =
    enabled && !isSubscriptionLoading && !resolvedSubscriptionId

  const result = useMemo(() => {
    // Must match UsageGauge/popover totals so banner thresholds agree with what
    // the user sees. Filtering to active-only grants here caused the banner to
    // fire at the wrong thresholds once a monthly plan grant was exhausted.
    // When totalCreditsMax is 0 (no grants at all), show 100% (exhausted).
    // Semantically: 0% = credits available but not used; 100% = no usable credits left.
    const { totalCreditsSpent, totalCreditsMax } = getTotalCreditsFromGrants(grants)
    const percentage = totalCreditsMax > 0 ? (totalCreditsSpent / totalCreditsMax) * 100 : 100
    const creditsRemaining = Math.max(0, Math.floor(totalCreditsMax - totalCreditsSpent))
    const isWarningBannerActive = computeWarningBannerActive(totalCreditsMax, creditsRemaining)

    return { percentage, creditsRemaining, isWarningBannerActive, ...computeWarningLevel(percentage) }
  }, [grants])

  const isLoading = isSubscriptionLoading || isGrantsLoading || isSubscriptionMissing

  return {
    percentage: result.percentage,
    creditsRemaining: result.creditsRemaining,
    warningLevel: result.warningLevel,
    isWarningBannerActive: result.isWarningBannerActive,
    isLoading,
  }
}
