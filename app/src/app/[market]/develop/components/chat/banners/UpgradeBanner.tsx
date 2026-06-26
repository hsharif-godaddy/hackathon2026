'use client'

import { useEffect, useRef } from 'react'
import { FormattedMessage } from 'react-intl'

import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

interface UpgradeBannerProps {
  onDismiss?: () => void
}

export default function UpgradeBanner({ onDismiss }: UpgradeBannerProps) {
  const t = useTranslations()
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal)
  const hasLoggedImpressionRef = useRef(false)

  useEffect(() => {
    if (!hasLoggedImpressionRef.current) {
      logImpressionEvent('chat.upgradeBanner.view')()
      hasLoggedImpressionRef.current = true
    }
  }, [])

  const handleClose = (): void => {
    logClickEvent('chat.upgradeBanner.close')()
    onDismiss?.()
  }

  const handleUpgradeClick = (e: React.MouseEvent): void => {
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
