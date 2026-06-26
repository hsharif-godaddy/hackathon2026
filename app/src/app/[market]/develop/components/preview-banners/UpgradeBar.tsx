'use client'

import React, { useEffect, useRef } from 'react'
import { FormattedMessage } from 'react-intl'
import Button from '@ux/button'
import text from '@ux/text'

import PreviewBar from '@/app/[market]/develop/components/preview-banners/PreviewBar'
import { useTranslations } from '@/hooks/useTranslations'
import { useUpgradeBannerExperiment } from '@/hooks/useUpgradeBannerExperiment'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { generateClickEID, logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

/**
 * Preview header upgrade bar (treatment variant). Eligibility is determined by
 * useUpgradeBannerExperiment — this component only renders when showPreviewBar is true.
 */
export default function UpgradeBar(): React.ReactElement | null {
  const t = useTranslations()
  const { showPreviewBar, dismiss } = useUpgradeBannerExperiment()
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal)
  const hasLoggedImpressionRef = useRef(false)

  useEffect(() => {
    if (showPreviewBar && !hasLoggedImpressionRef.current) {
      logImpressionEvent('preview.upgradeBanner.view')()
      hasLoggedImpressionRef.current = true
    }
  }, [showPreviewBar])

  if (!showPreviewBar) return null

  const handleClose = (): void => {
    logClickEvent('preview.upgradeBanner.close')()
    dismiss()
  }

  const handleUpgradeClick = (e: React.MouseEvent): void => {
    e.preventDefault()
    logClickEvent('preview.upgradeBanner.upgrade')()
    openUpgradeModal('airobuilder_upgrade_banner.upgrade', PAYWALL_ITC.UPGRADE)
  }

  const link = (
    <Button
      design="inline"
      size="sm"
      text={t('builder_airoplus_upgrade_link', {}, 'Upgrade now')}
      onClick={handleUpgradeClick}
      data-eid={generateClickEID('preview.upgradeBanner.upgrade')}
      className="!text-intents-ux-boxHighContrast-foregroundColor underline"
    />
  )

  return (
    <PreviewBar onClose={handleClose} closeEid={generateClickEID('preview.upgradeBanner.close')}>
      <text.div size={-1} className="truncate grow text-center">
        <FormattedMessage
          id="builder_airoplus_upgrade_message"
          values={{ link }}
        />
      </text.div>
    </PreviewBar>
  )
}
