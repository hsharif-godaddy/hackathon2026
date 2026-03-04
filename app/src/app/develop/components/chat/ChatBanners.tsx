'use client'

import SessionExpirationBanner from '@/components/auth/SessionExpirationBanner'
import { useUsage } from '@/hooks/useUsage'
import UpgradeBanner from './UpgradeBanner'
import UsageWarningBanner from './UsageWarningBanner'

interface ChatBannersProps {
  appId: string | null
}

/**
 * Container component that manages which chat banner to display.
 * Only one banner shows at a time, with priority order:
 * 1. SessionExpirationBanner (session expiring within 5 minutes)
 * 2. UsageWarningBanner (usage >= 90%)
 * 3. UpgradeBanner (no Airo Plus subscription)
 */
export default function ChatBanners({ appId }: ChatBannersProps) {
  const { isWarningBannerActive } = useUsage({ appId, enabled: !!appId })

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
  return (
    <>
      {sessionBanner}
      <UpgradeBanner appId={appId} />
    </>
  )
}
