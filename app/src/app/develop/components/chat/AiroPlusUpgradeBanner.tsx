'use client'

import { useState } from 'react'
import { FormattedMessage } from 'react-intl'

import { usePaywallEligibility } from '@/hooks/usePaywallEligibility'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

const STORAGE_KEY = 'airoplus_upgrade_banner_dismissed'

function isDismissedToday(): boolean {
  // Return true during SSR to prevent hydration mismatch (don't render until client-side check)
  if (typeof window === 'undefined') return true
  const today = new Date().toISOString().split('T')[0]
  return localStorage.getItem(STORAGE_KEY) === today
}

function markDismissedToday(): void {
  if (typeof window === 'undefined') return
  const today = new Date().toISOString().split('T')[0]
  localStorage.setItem(STORAGE_KEY, today)
}

interface AiroPlusUpgradeBannerProps {
  appId: string | null
}

export default function AiroPlusUpgradeBanner({ appId }: AiroPlusUpgradeBannerProps) {
  const t = useTranslations()
  const [isDismissed, setIsDismissed] = useState(isDismissedToday)
  const { data: featureEnabled, isLoading: isFeatureLoading } = useSwitchboard('appbuilder-airoplus-upgrade-banner')
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const { showPaywall } = usePaywallEligibility(appId || undefined)

  // Don't render while feature flag is loading to prevent flash
  if (isFeatureLoading) return null

  // Only show if feature flag is enabled and user doesn't have Airo Plus
  // Note: Priority/exclusion with other banners is handled by ChatBanners parent component
  if (!featureEnabled || isDismissed || !showPaywall) return null

  const handleClose = () => {
    markDismissedToday()
    setIsDismissed(true)
  }

  const handleUpgradeClick = (e: React.MouseEvent) => {
    e.preventDefault()
    openUpgradeModal('airoplus_upgrade_banner.upgrade')
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
