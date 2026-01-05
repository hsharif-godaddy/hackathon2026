'use client'

import Box from '@ux/box'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { useAppIdFromParams } from '@/app/develop/components/utils'
import BigCard from '@/components/layout/BigCard'
import { useDailyUsage, type WarningLevel } from '@/hooks/useDailyUsage'
import { useTranslations } from '@/hooks/useTranslations'

function getProgressBarClass(level: WarningLevel): string {
  switch (level) {
    case 'exceeded':
    case 'warning':
      return 'bg-intents-ux-feedbackCritical-feedbackColor'
    case 'caution':
      return 'bg-intents-ux-feedbackWarning-feedbackColor'
    default:
      return 'bg-intents-ux-feedbackSuccess-feedbackColor'
  }
}

export default function ProjectPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const { data, isLoading, warningLevel, formattedResetTime } = useDailyUsage({
    appId,
    enabled: !!appId
  })

  const percentage = data ? Math.min(data.percentage, 100) : 0

  return (
    <Box gap='lg' className='@container'>
      <BigCard
        title={t('builder_settings_project_usage_title', void 0, 'Daily Usage')}
        description={t('builder_settings_project_usage_desc', void 0, 'Track your daily AI usage allowance')}
      >
        {isLoading ? (
          <div className='flex justify-center py-4'>
            <Spinner />
          </div>
        ) : data ? (
          <div className='space-y-3'>
            <div className='h-3 bg-intents-ux-boxLowContrast-backgroundColor rounded-full overflow-hidden'>
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
              {formattedResetTime && (
                <text.strong
                  text={t('builder_usage_resets', { time: formattedResetTime }, `Resets ${formattedResetTime}`)}
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
