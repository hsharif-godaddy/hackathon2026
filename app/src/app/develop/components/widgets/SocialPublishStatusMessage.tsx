'use client'

import { clsx } from 'clsx'
import { memo } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import text, { type Emphasis } from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

export enum SocialPublishStatus {
  Success = 'success',
  Error = 'error',
  Incomplete = 'incomplete'
}

interface SocialPublishStatusMessageProps {
  status: SocialPublishStatus
  platformName: string
  platformUrl?: string
  errorMessage?: string
}

const statusConfig = {
  [SocialPublishStatus.Success]: {
    borderColor: 'border-intents-ux-success-borderColor',
    bgColor: 'bg-intents-ux-success-backgroundColor',
    emphasis: 'passive' as Emphasis
  },
  [SocialPublishStatus.Error]: {
    borderColor: 'border-intents-ux-error-borderColor',
    bgColor: 'bg-intents-ux-error-backgroundColor',
    emphasis: 'warning' as Emphasis
  },
  [SocialPublishStatus.Incomplete]: {
    borderColor: 'border-intents-ux-info-borderColor',
    bgColor: 'bg-intents-ux-info-backgroundColor',
    emphasis: 'info' as Emphasis
  }
}

export const SocialPublishStatusMessage = memo(function SocialPublishStatusMessage({
  status,
  platformName,
  platformUrl,
  errorMessage
}: SocialPublishStatusMessageProps) {
  const t = useTranslations()
  const config = statusConfig[status]

  const message =
    status === SocialPublishStatus.Success
      ? t('builder_widgets_socialpublish_success')
      : status === SocialPublishStatus.Incomplete
      ? t('builder_widgets_socialpublish_incomplete')
      : t('builder_widgets_socialpublish_failed')

  const subtext =
    status === SocialPublishStatus.Success
      ? t('builder_widgets_socialpublish_live_on', { platformName })
      : status === SocialPublishStatus.Incomplete
      ? t('builder_widgets_socialpublish_incomplete_subtext', { platformName })
      : null

  return (
    <div className={clsx('rounded-md border p-2 mt-2', config.borderColor, config.bgColor)}>
      <Box orientation="vertical" gap="sm">
        <text.span size={-1} text={message} emphasis={config.emphasis} />
        {subtext && (
          <text.span size={-1} text={subtext} />
        )}
        {status === SocialPublishStatus.Success && platformUrl && (
          <div className="mt-1">
            <Button
              design="secondary"
              as="external"
              size="sm"
              text={t('builder_widgets_socialpublish_view_post')}
              href={platformUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-eid={generateClickEID('social.publish.view_post.history')}
            />
          </div>
        )}
        {status === SocialPublishStatus.Error && errorMessage && (
          <text.span size={-2} text={errorMessage} emphasis="warning" />
        )}
      </Box>
    </div>
  )
})
