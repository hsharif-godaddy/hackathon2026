import Box, { box } from '@ux/box'
import Button from '@ux/button'
import DiamondIcon from '@ux/icon/diamond'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

import { AnalyticsPictogram } from '@/components/icons/AnalyticsPictogram'
import { useTranslations } from '@/hooks/useTranslations'
import { cn } from '@/lib/utils'
import { logClickEvent } from '@/utils/instrumentation'

export interface AnalyticsUpgradeBannerProps {
  onUpgrade: () => void
  className?: string
}

export function AnalyticsUpgradeBanner({ onUpgrade, className }: AnalyticsUpgradeBannerProps) {
  const t = useTranslations()
  return (
    <div className={cn('@container', className)}>
      <div
        className={cn(
          "flex flex-col p-2 gap-2 w-full",
          "@md:flex-row @md:items-center",
          "border border-t-4 border-intents-ux-feedbackHighContrastPremium-feedbackColor",
          "text-intents-ux-box-foregroundColor bg-intents-ux-box-backgroundColor",
          "rounded-xl",
        )}
      >
        <AnalyticsPictogram size={80} className="!hidden @md:!block shrink-0" />
        <TextLockup className="grow" size="sm" title={t('builder_analytics_upgrade_banner_title')}>
          {t('builder_analytics_upgrade_banner_message')}
        </TextLockup>
        <Button
          design="secondary"
          size="sm"
          icon={<DiamondIcon />}
          text={t('builder_upgrade_button')}
          onClick={() => {
            logClickEvent('settings.analytics.upgrade_banner')()
            onUpgrade()
          }}
        />
      </div>
    </div>
  )
}

export interface AnalyticsUpgradeInnerBannerProps {
  onUpgrade: () => void
}

export function AnalyticsUpgradeInnerBanner({ onUpgrade }: AnalyticsUpgradeInnerBannerProps) {
  const t = useTranslations()
  return (
    <box.button
      orientation="horizontal"
      inlineAlignChildren="center"
      blockAlignChildren="center"
      inlinePadding="md"
      blockPadding="md"
      onClick={() => {
        logClickEvent('settings.analytics.upgrade_inner_banner')()
        onUpgrade()
      }}
      type="button"
      className="border border-dashed border-intents-ux-box-borderColor rounded-md hover:bg-intents-ux-boxLowContrast-backgroundColor hover:text-intents-ux-boxLowContrast-foregroundColor cursor-pointer text-start"
    >
      <Box
        orientation="horizontal"
        gap="sm"
      >
        <DiamondIcon className="size-2.5 text-intents-ux-feedbackHighContrastPremium-feedbackColor" />
        <text.span as="action" size={-1}>{t('builder_analytics_upgrade_inner_banner_message')}</text.span>
      </Box>
    </box.button>
  )
}
