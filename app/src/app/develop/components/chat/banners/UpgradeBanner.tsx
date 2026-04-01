'use client'

import { useEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'

import { usePaywallEligibility } from '@/hooks/usePaywallEligibility'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'
import { canUpgradePlan, PAYWALL_ITC } from '@/lib/paywall/shared'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { getPlanFromSubscription } from '@/utils/credits'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

const STORAGE_KEY = 'airoplus_upgrade_banner_dismissed'

// Use local date (not UTC) so "today" matches user's timezone
// 'en-CA' locale reliably returns YYYY-MM-DD format which is sortable and unambiguous
function getLocalDateString(): string {
  return new Date().toLocaleDateString('en-CA')
}

function isDismissedToday(): boolean {
  return localStorage.getItem(STORAGE_KEY) === getLocalDateString()
}

function markDismissedToday(): void {
  localStorage.setItem(STORAGE_KEY, getLocalDateString())
}

interface UpgradeBannerProps {
  onDismiss?: () => void
}

export default function UpgradeBanner({ onDismiss }: UpgradeBannerProps) {
  const t = useTranslations()
  const [isDismissed, setIsDismissed] = useState(true)
  const [mounted, setMounted] = useState(false)
  const { data: featureEnabled, isLoading: isFeatureLoading } = useSwitchboard('appbuilder-airoplus-upgrade-banner')
  const { data: isHigherPlansEnabled } = useSwitchboard('appbuilder-higher-plans')
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility()
  const { data: subscription } = useSubscription()
  const currentPlan = subscription ? getPlanFromSubscription(subscription) : undefined

  const hasLoggedImpressionRef = useRef(false)

  // Check localStorage only after client-side mount to prevent hydration mismatch
  useEffect(() => {
    setIsDismissed(isDismissedToday())
    setMounted(true)
  }, [])

  const shouldShowBanner = mounted && !isFeatureLoading && !isPaywallLoading && featureEnabled && !isDismissed &&
    (showPaywall || canUpgradePlan(currentPlan, !!isHigherPlansEnabled))
  useEffect(() => {
    if (shouldShowBanner && !hasLoggedImpressionRef.current) {
      logImpressionEvent('chat.upgradeBanner.view')()
      hasLoggedImpressionRef.current = true
    }
  }, [shouldShowBanner])

  // Wait for loading, then show only if feature enabled and user doesn't have paid plan
  // With higher plans enabled, also show for non-Ultimate paid users
  if (!mounted || isFeatureLoading || isPaywallLoading || !featureEnabled || isDismissed ||
      (!showPaywall && !canUpgradePlan(currentPlan, !!isHigherPlansEnabled))) return null

  const handleClose = () => {
    logClickEvent('chat.upgradeBanner.close')()
    markDismissedToday()
    setIsDismissed(true)
    onDismiss?.()
  }

  const handleUpgradeClick = (e: React.MouseEvent) => {
    e.preventDefault()
    logClickEvent('chat.upgradeBanner.upgrade')()
    openUpgradeModal('airoplus_upgrade_banner.upgrade', PAYWALL_ITC.UPGRADE)
  }

  const link = (
    <a href="#" className="underline !cursor-pointer !normal-case" onClick={handleUpgradeClick}>
      {t('builder_airoplus_upgrade_link', {}, 'Upgrade now')}
    </a>
  )

  return (
    <ChatBanner variant="info" onClose={handleClose}>
      <FormattedMessage
        id="builder_airoplus_upgrade_message"
        values={{ link }}
      />
    </ChatBanner>
  )
}
