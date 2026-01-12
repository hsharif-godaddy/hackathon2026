'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import Skeleton from '@ux/skeleton'
import text from '@ux/text'

import { useAppIdFromParams } from '@/app/develop/components/utils'
import BigCard from '@/components/layout/BigCard'
import { useDailyUsage } from '@/hooks/useDailyUsage'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { WarningLevel, type WarningLevel as WarningLevelType } from '@/types/usage'

function getProgressBarClass(level: WarningLevelType): string {
  switch (level) {
    case WarningLevel.EXCEEDED:
    case WarningLevel.WARNING:
      return 'bg-intents-ux-feedbackCritical-feedbackColor'
    case WarningLevel.CAUTION:
      return 'bg-intents-ux-feedbackWarning-feedbackColor'
    default:
      return 'bg-intents-ux-feedbackSuccess-feedbackColor'
  }
}

export default function ProjectPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const { data: purchaseEnabled } = useSwitchboard('appbuilder-usage-purchase')
  const { data, isLoading, warningLevel, formattedResetTime: resetTimeData } = useDailyUsage({
    appId,
    enabled: !!appId
  })

  const percentage = data ? Math.min(data.percentage, 100) : 0

  // Translate the day key with time parameter (e.g., "today at {time}")
  const translatedResetTime = resetTimeData
    ? t(`builder_usage_limit_reset_${resetTimeData.dayKey}`, { time: resetTimeData.timeString })
    : null

  const purchaseButtons = purchaseEnabled ? (
    <div className='flex gap-2'>
      <Button
        design='primary'
        size='sm'
        onClick={() => openUpgradeModal('project_panel.upgrade')}
        text={t('builder_usage_gauge_upgrade')}
      />
      <Button
        design='secondary'
        size='sm'
        onClick={() => openUpgradeModal('project_panel.buy_tokens')}
        text={t('builder_usage_gauge_buy_tokens')}
      />
    </div>
  ) : undefined

  return (
    <Box gap='lg' className='@container'>
      <BigCard
        title={t('builder_settings_project_usage_title', void 0, 'Daily Usage')}
        description={t('builder_settings_project_usage_desc', void 0, 'Track your daily AI usage allowance')}
        button={purchaseButtons}
      >
        {isLoading ? (
          <Box orientation='vertical' gap='sm'>
            <Skeleton rounding='full' size='sm' width='100%' height='24px' />
            <Box orientation='horizontal' blockAlignChildren='spaceBetween'>
              <Skeleton size='sm' width='96px' height='16px' />
              <Skeleton size='sm' width='128px' height='16px' />
            </Box>
          </Box>
        ) : data ? (
          <div className='space-y-3'>
            <div className='h-3 bg-intents-ux-box-backgroundColor rounded-full overflow-hidden'>
              <div
                className={`h-full transition-all duration-300 ${getProgressBarClass(warningLevel)}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className='flex justify-between items-center'>
              <text.span
                text={t('builder_usage_percent_used', { percentage: String(Math.round(percentage)) })}
                as='caption'
              />
              {translatedResetTime && (
                <text.strong
                  text={t('builder_usage_resets', { time: translatedResetTime }, `Resets ${translatedResetTime}`)}
                  as='caption'
                  emphasis='info'
                />
              )}
            </div>
          </div>
        ) : (
          <text.span text={t('builder_usage_unavailable', void 0, 'Usage data unavailable')} as='caption' />
        )}
      </BigCard>
    </Box>
  )
}
