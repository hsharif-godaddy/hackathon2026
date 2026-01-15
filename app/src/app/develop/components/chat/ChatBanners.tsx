'use client'

import { useDailyUsage } from '@/hooks/useDailyUsage'
import UpgradeBanner from './UpgradeBanner'
import UsageWarningBanner from './UsageWarningBanner'

interface ChatBannersProps {
  appId: string | null
}

/**
 * Container component that manages which chat banner to display.
 * Only one banner shows at a time, with priority order:
 * 1. UsageWarningBanner (usage >= 90%)
 * 2. UpgradeBanner (no Airo Plus subscription)
 */
export default function ChatBanners({ appId }: ChatBannersProps) {
  const { isWarningBannerActive } = useDailyUsage({ appId, enabled: !!appId })

  // Priority: Usage warning takes precedence over upgrade prompt
  if (isWarningBannerActive) {
    return <UsageWarningBanner appId={appId} />
  }

  return <UpgradeBanner appId={appId} />
}
