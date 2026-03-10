'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FormattedMessage } from 'react-intl'

import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useUsage } from '@/hooks/useUsage'
import ChatBanner from '@/lib/ChatBanner'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

interface UsageWarningBannerProps {
  appId: string | null
}

export default function UsageWarningBanner({ appId }: UsageWarningBannerProps) {
  const t = useTranslations()
  const [isDismissed, setIsDismissed] = useState(false)
  const { data: purchaseEnabled } = useSwitchboard('appbuilder-usage-purchase')
  const { isWarningBannerActive } = useUsage({ appId, enabled: !!appId })

  const shouldShowBanner = !isDismissed && isWarningBannerActive
  useEffect(() => {
    if (shouldShowBanner) {
      logImpressionEvent('chat.usageWarningBanner.view')()
    }
  }, [shouldShowBanner])

  if (!shouldShowBanner) return null

  const handleClose = () => {
    logClickEvent('chat.usageWarningBanner.close')()
    setIsDismissed(true)
  }

  const rawLinkText = purchaseEnabled
    ? t('builder_usage_warning_upgrade_link')
    : t('builder_usage_warning_view_usage_link')

  const linkText = rawLinkText.charAt(0).toUpperCase() + rawLinkText.slice(1)

  const handleLinkClick = () => {
    logClickEvent('chat.usageWarningBanner.link')()
  }

  const link = (
    <Link href="/manage-plan" className="underline !cursor-pointer !normal-case" onClick={handleLinkClick}>
      {linkText}
    </Link>
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
