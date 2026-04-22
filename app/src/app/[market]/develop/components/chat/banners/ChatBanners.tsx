'use client'

import { useCallback, useEffect, useState } from 'react'

import SessionExpirationBanner from '@/components/auth/SessionExpirationBanner'
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useUsage } from '@/hooks/useUsage'
import {
  isPublishBlockedByComplianceRules,
  isSubscriptionSuspendedForNonPayment
} from '@/lib/subscription'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import FeedbackBanner from './FeedbackBanner'
import SuspendedComplianceBanner from './SuspendedComplianceBanner'
import SuspendedNonPaymentBanner from './SuspendedNonPaymentBanner'
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
 * 2. SuspendedComplianceBanner (site suspended or account subscription non-compliant; Switchboard-gated)
 * 3. SuspendedNonPaymentBanner (subscription suspended for non-payment)
 * 4. UsageWarningBanner (usage >= 90%)
 * 5. UpgradeBanner (no Airo Plus subscription)
 * 6. FeedbackBanner (prompt for user feedback)
 */
export default function ChatBanners({ appId }: ChatBannersProps) {
  const { isWarningBannerActive } = useUsage({ appId, enabled: !!appId })
  const { data: upgradeBannerEnabled, isLoading: isUpgradeFeatureLoading } = useSwitchboard('appbuilder-airoplus-upgrade-banner')
  const { data: feedbackBannerEnabled, isLoading: isFeedbackFeatureLoading } = useSwitchboard('appbuilder-feedback-banner')
  const { data: suspendedComplianceBannerEnabled, isLoading: isSuspendedComplianceFeatureLoading } = useSwitchboard('appbuilder-suspended-compliance-banner')
  const { data: suspendedNonPaymentBannerEnabled, isLoading: isSuspendedNonPaymentFeatureLoading } = useSwitchboard('appbuilder-suspended-nonpayment-banner')
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility()
  const { data: subscription } = useSubscription()
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

  const currentSite = useSiteStore((state) => appId ? state.getSite(appId) : null)

  const isSuspendedForCompliance =
    !isSuspendedComplianceFeatureLoading &&
    suspendedComplianceBannerEnabled &&
    isPublishBlockedByComplianceRules(
      currentSite,
      subscription,
      true
    )

  const isSuspendedForNonPayment =
    !isSuspendedNonPaymentFeatureLoading &&
    suspendedNonPaymentBannerEnabled &&
    isSubscriptionSuspendedForNonPayment(subscription)

  // Determine if upgrade banner should be shown
  const isUpgradeBannerActive = mounted && !isUpgradeFeatureLoading && !isPaywallLoading && upgradeBannerEnabled && !isUpgradeBannerDismissed && showPaywall

  // Determine if feedback banner should be shown (feature flag AND store state)
  const showFeedbackBanner = mounted && !isFeedbackFeatureLoading && feedbackBannerEnabled && showFeedbackBannerFromStore

  // Priority 1: Session expiration (critical - user will be logged out)
  // This component manages its own visibility state
  const sessionBanner = <SessionExpirationBanner />

  // Priority 2: Suspended compliance (critical - user needs to contact support)
  if (isSuspendedForCompliance) {
    return (
      <>
        {sessionBanner}
        <SuspendedComplianceBanner />
      </>
    )
  }

  // Priority 3: Suspended non-payment (critical - user needs to renew)
  if (isSuspendedForNonPayment) {
    return (
      <>
        {sessionBanner}
        <SuspendedNonPaymentBanner
          builderEntitlementId={subscription?.builderEntitlementId}
          renewsAt={subscription?.renewsAt}
        />
      </>
    )
  }

  // Priority 4: Usage warning takes precedence over upgrade prompt
  if (isWarningBannerActive) {
    return (
      <>
        {sessionBanner}
        <UsageWarningBanner appId={appId} />
      </>
    )
  }

  // Priority 5: Upgrade banner
  if (isUpgradeBannerActive) {
    return (
      <>
        {sessionBanner}
        <UpgradeBanner onDismiss={handleUpgradeBannerDismiss} />
      </>
    )
  }

  // Priority 6: Feedback banner (only if feature flag is enabled)
  return (
    <>
      {sessionBanner}
      {showFeedbackBanner && <FeedbackBanner />}
    </>
  )
}
