'use client'

import { useEffect, useState } from 'react'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { COHORT_ON, EXPERIMENT_IDS } from '@/config/experiments'
import { useEnterpriseManaged } from '@/hooks/useEnterpriseManaged'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useHivemind } from '@/hooks/useHivemind'
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { logImpressionEvent } from '@/utils/instrumentation'

const STORAGE_KEY = 'airoplus_upgrade_banner_dismissed'

let triggerFired: boolean = false

function getLocalDateString(): string {
  return new Date().toLocaleDateString('en-CA')
}

function isDismissedToday(): boolean {
  return localStorage.getItem(STORAGE_KEY) === getLocalDateString()
}

export function markDismissedToday(): void {
  localStorage.setItem(STORAGE_KEY, getLocalDateString())
}

interface UpgradeBannerExperimentResult {
  /** Whether the upgrade banner should show in the chat panel (control cohort) */
  showChatBanner: boolean
  /** Whether the upgrade bar should show in the preview header (treatment cohort) */
  showPreviewBar: boolean
  /** Call to mark banner as dismissed for today */
  dismiss: () => void
}

/**
 * Centralized hook for upgrade banner eligibility and experiment cohort assignment.
 * Fires the trigger impression for eligible users so they get bucketed.
 *
 * Conditions (all must be true for either position to show):
 * - Feature flag `appbuilder-airoplus-upgrade-banner` is ON
 * - User is free (`showPaywall`)
 * - User is not an invited collaborator
 * - App is not enterprise-managed (no self-serve upgrade path)
 * - App has been built (2+ commits or initialBuildComplete)
 * - Banner not dismissed today
 *
 * Experiment determines position:
 * - Cohort ON → preview bar (treatment)
 * - Cohort OFF / ineligible / undefined → chat banner (control)
 */
export function useUpgradeBannerExperiment(appId?: string | null): UpgradeBannerExperimentResult {
  const appIdFromParams = useAppIdFromParams()
  const resolvedAppId: string | null = appId ?? appIdFromParams
  const featureEnabled = useSwitchboard('appbuilder-airoplus-upgrade-banner')
  const { cohort } = useHivemind(EXPERIMENT_IDS.upgradeBannerPlacement)
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(resolvedAppId ?? undefined)
  const { isEnterpriseManaged } = useEnterpriseManaged()
  const isSharedWithMe = useSiteStore((state) => (resolvedAppId ? state.getSite(resolvedAppId)?.sharedWithMe : false))
  const agentUrl = useSiteStore((state) => (resolvedAppId ? state.getSite(resolvedAppId)?.agent_url : undefined))
  // Show after initial build: either 2+ commits in git history OR initialBuildComplete flag set.
  // Both signals indicate the app has been built — whichever fires first unblocks the banner.
  const { data: gitHistory } = useGitHistoryQuery({
    appId: resolvedAppId ?? '',
    enabled: !!resolvedAppId && !!agentUrl,
  })
  const initialBuildComplete: boolean = useDevelopPageStore((state) =>
    state.app?.id === resolvedAppId ? state.app?.initialBuildComplete === true : false
  )
  const hasBuilt: boolean = initialBuildComplete || (gitHistory?.commits?.length ?? 0) >= 3
  const [isDismissed, setIsDismissed] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setIsDismissed(isDismissedToday())
    setMounted(true)
  }, [])

  // Eligible: flag on, not loading, not dismissed, not shared, not enterprise-managed,
  // app has been built, and user is free (showPaywall).
  // Enterprise-managed apps suppress the banner entirely — the customer cannot
  // self-serve a plan upgrade, so a CTA to "Upgrade now" would dead-end.
  const isEligible: boolean = mounted && featureEnabled === true && !isPaywallLoading &&
    !isDismissed && !isSharedWithMe && !isEnterpriseManaged && hasBuilt && showPaywall

  useEffect(() => {
    if (isEligible && cohort !== undefined && !triggerFired) {
      triggerFired = true
      logImpressionEvent('upgradeBanner.placement.trigger', { cohort })()
    }
  }, [isEligible, cohort])

  const isTreatment: boolean = cohort === COHORT_ON

  const dismiss = (): void => {
    markDismissedToday()
    setIsDismissed(true)
  }

  return {
    showChatBanner: isEligible && !isTreatment,
    showPreviewBar: isEligible && isTreatment,
    dismiss,
  }
}
