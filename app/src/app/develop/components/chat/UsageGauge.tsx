'use client'

import { memo, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import Button from '@ux/button'
import text from '@ux/text'

import { useDailyUsage } from '@/hooks/useDailyUsage'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import CircularGauge from '@/lib/CircularGauge'
import { shipAnalyticsLog } from '@/lib/logging'
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface UsageGaugeProps {
  appId: string | null
}

export default memo(function UsageGauge({ appId }: UsageGaugeProps) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const openCreditsModal = useDevelopPageStore((state) => state.openCreditsModal)
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants')

  const { data, isLoading, formattedResetTime: resetTimeData } = useDailyUsage({
    appId,
    enabled: !!appId
  })

  // Translate the day key with time parameter (e.g., "today at {time}")
  const translatedResetTime = resetTimeData
    ? t(`builder_usage_limit_reset_${resetTimeData.dayKey}`, { time: resetTimeData.timeString })
    : null

  const { data: purchaseEnabled } = useSwitchboard('appbuilder-usage-purchase')

  const percentage = data ? Math.min(data.percentage, 100) : 0

  const handleUpgradeClick = () => {
    openUpgradeModal('usage_gauge.upgrade')
    setOpen(false)
    shipAnalyticsLog('usage_gauge.upgrade.clicked', { appId, percentage })
  }

  const handleBuyTokensClick = () => {
    // When grants feature is on, open credits modal; otherwise fall back to upgrade modal
    if (isGrantsEnabled) {
      openCreditsModal('usage_gauge.buy_tokens')
    } else {
      openUpgradeModal('usage_gauge.buy_tokens')
    }
    setOpen(false)
    shipAnalyticsLog('usage_gauge.buy_tokens.clicked', { appId, percentage })
  }

  if (isLoading || !data) {
    return (
      <div className="w-5 h-5 flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-intents-ux-boxLowContrast-backgroundColor animate-pulse" />
      </div>
    )
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="relative w-5 h-5 flex items-center justify-center cursor-pointer focus:outline-none rounded-full group"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              setOpen(true)
            }}
            aria-label={t('builder_usage_gauge_aria_label', { percentage: String(Math.round(percentage)) })}
          >
            <div className="transition-transform group-hover:scale-110">
              <CircularGauge
                value={percentage}
                size={20}
                strokeWidth={3}
              />
            </div>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-40 p-3"
        >
          <div className="flex flex-col gap-1">
            <text.strong
              as="title"
              size={-1}
              text={t('builder_usage_daily_title')}
            />
            <span className="text-xs">
              <FormattedMessage
                id="builder_usage_summary"
                values={{
                  percentage: String(Math.round(percentage)),
                  resetTime: translatedResetTime || t('builder_usage_soon'),
                  strong: (chunks) => <strong>{chunks}</strong>
                }}
              />
            </span>

            {purchaseEnabled && (
              <div className="flex gap-2 pt-1">
                <Button
                  design="primary"
                  size="sm"
                  onClick={handleUpgradeClick}
                  text={t('builder_usage_gauge_upgrade')}
                />
                <Button
                  design="secondary"
                  size="sm"
                  onClick={handleBuyTokensClick}
                  text={t('builder_usage_gauge_buy_tokens')}
                />
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
})
