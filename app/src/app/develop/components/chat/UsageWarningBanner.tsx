'use client'

import { useState } from 'react'
import { FormattedMessage } from 'react-intl'

import { SettingsSection } from '@/app/develop/components/types'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useDailyUsage } from '@/hooks/useDailyUsage'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'

interface UsageWarningBannerProps {
  appId: string | null
}

export default function UsageWarningBanner({ appId }: UsageWarningBannerProps) {
  const t = useTranslations()
  const [isDismissed, setIsDismissed] = useState(false)
  const { data: purchaseEnabled } = useSwitchboard('appbuilder-usage-purchase')
  const { setActiveSettingsSection } = useChatTabs()

  const { isWarningBannerActive } = useDailyUsage({
    appId,
    enabled: !!appId
  })

  if (isDismissed || !isWarningBannerActive) return null

  const handleClose = () => {
    setIsDismissed(true)
  }

  const handleLinkClick = (e: React.MouseEvent) => {
    e.preventDefault()
    setActiveSettingsSection(SettingsSection.PROJECT)
  }

  const rawLinkText = purchaseEnabled
    ? t('builder_usage_warning_upgrade_link')
    : t('builder_usage_warning_view_usage_link')

  const linkText = rawLinkText.charAt(0).toUpperCase() + rawLinkText.slice(1)

  const link = (
    <a href="#" className="underline !cursor-pointer !normal-case" onClick={handleLinkClick}>
      {linkText}
    </a>
  )

  const messageId = purchaseEnabled
    ? 'builder_usage_warning_message'
    : 'builder_usage_warning_message_no_purchase'

  return (
    <ChatBanner variant="warning" onClose={handleClose}>
      <FormattedMessage id={messageId} values={{ link }} />
    </ChatBanner>
  )
}
