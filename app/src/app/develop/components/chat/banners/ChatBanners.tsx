'use client'

import { useCallback, useEffect, useState } from 'react'

import SessionExpirationBanner from '@/components/auth/SessionExpirationBanner'
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useUsage } from '@/hooks/useUsage'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import FeedbackBanner from './FeedbackBanner'
import UpgradeBanner from './UpgradeBanner'
import UsageWarningBanner from './UsageWarningBanner'

interface ChatBannersProps {
  appId: string | null
}

const UPGRADE_BANNER_STORAGE_KEY = 'airoplus_upgrade_banner_dismissed'

function getLocalDateString(): string {
  return new Date().toLocaleDateString('en-CA')
}

function isUpgradeBannerDismissedToday(): boolean {
  return localStorage.getItem(UPGRADE_BANNER_STORAGE_KEY) === getLocalDateString()
}

/**
 * Container component that manages which chat banner to display.
 * Only one banner shows at a time, with priority order:
 * 1. SessionExpirationBanner (session expiring within 5 minutes)
 * 2. UsageWarningBanner (usage >= 90%)
 * 3. UpgradeBanner (no Airo Plus subscription)
 * 4. FeedbackBanner (prompt for user feedback)
 */
export default function ChatBanners({ appId }: ChatBannersProps) {
  const { isWarningBannerActive } = useUsage({ appId, enabled: !!appId })
  const { data: upgradeBannerEnabled, isLoading: isUpgradeFeatureLoading } = useSwitchboard('appbuilder-airoplus-upgrade-banner')
  const { data: feedbackBannerEnabled, isLoading: isFeedbackFeatureLoading } = useSwitchboard('appbuilder-feedback-banner')
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(appId || undefined)
  const showFeedbackBannerFromStore = useDevelopPageStore((state) => state.showFeedbackBanner)
  const [isUpgradeBannerDismissed, setIsUpgradeBannerDismissed] = useState(true)
  const [mounted, setMounted] = useState(false)

  // Check localStorage only after client-side mount to prevent hydration mismatch
  useEffect(() => {
    setIsUpgradeBannerDismissed(isUpgradeBannerDismissedToday())
    setMounted(true)
  }, [])

  // Handle upgrade banner dismissal and update local state
  const handleUpgradeBannerDismiss = useCallback(() => {
    setIsUpgradeBannerDismissed(true)
  }, [])

  // Determine if upgrade banner should be shown
  const isUpgradeBannerActive = mounted && !isUpgradeFeatureLoading && !isPaywallLoading && upgradeBannerEnabled && !isUpgradeBannerDismissed && showPaywall

  // Determine if feedback banner should be shown (feature flag AND store state)
  const showFeedbackBanner = mounted && !isFeedbackFeatureLoading && feedbackBannerEnabled && showFeedbackBannerFromStore

  // Priority 1: Session expiration (critical - user will be logged out)
  // This component manages its own visibility state
  const sessionBanner = <SessionExpirationBanner />

  // Priority 2: Usage warning takes precedence over upgrade prompt
  if (isWarningBannerActive) {
    return (
      <>
        {sessionBanner}
        <UsageWarningBanner appId={appId} />
      </>
    )
  }

  // Priority 3: Upgrade banner
  if (isUpgradeBannerActive) {
    return (
      <>
        {sessionBanner}
        <UpgradeBanner appId={appId} onDismiss={handleUpgradeBannerDismiss} />
      </>
    )
  }

  // Priority 4: Feedback banner (only if feature flag is enabled)
  return (
    <>
      {sessionBanner}
      {showFeedbackBanner && <FeedbackBanner />}
    </>
  )
}
