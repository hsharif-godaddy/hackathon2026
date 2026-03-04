'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FormattedMessage } from 'react-intl'

import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useUsage } from '@/hooks/useUsage'
import ChatBanner from '@/lib/ChatBanner'

interface UsageWarningBannerProps {
  appId: string | null
}

export default function UsageWarningBanner({ appId }: UsageWarningBannerProps) {
  const t = useTranslations()
  const [isDismissed, setIsDismissed] = useState(false)
  const { data: purchaseEnabled } = useSwitchboard('appbuilder-usage-purchase')
  const { isWarningBannerActive } = useUsage({ appId, enabled: !!appId })

  if (isDismissed || !isWarningBannerActive) return null

  const handleClose = () => {
    setIsDismissed(true)
  }

  const rawLinkText = purchaseEnabled
    ? t('builder_usage_warning_upgrade_link')
    : t('builder_usage_warning_view_usage_link')

  const linkText = rawLinkText.charAt(0).toUpperCase() + rawLinkText.slice(1)

  const link = (
    <Link href="/manage-plan" className="underline !cursor-pointer !normal-case">
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
