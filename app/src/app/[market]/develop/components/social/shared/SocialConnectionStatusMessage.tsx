'use client'

import { clsx } from 'clsx'
import { memo } from 'react'
import Box from '@ux/box'
import text, { type Emphasis } from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

export enum SocialConnectionStatus {
  Success = 'success',
  Error = 'error',
  Incomplete = 'incomplete'
}

interface SocialConnectionStatusMessageProps {
  status: SocialConnectionStatus
  platformName: string
  errorMessage?: string
}

const statusConfig = {
  [SocialConnectionStatus.Success]: {
    borderColor: 'border-intents-ux-success-borderColor',
    bgColor: 'bg-intents-ux-success-backgroundColor',
    emphasis: 'success' as Emphasis
  },
  [SocialConnectionStatus.Error]: {
    borderColor: 'border-intents-ux-error-borderColor',
    bgColor: 'bg-intents-ux-error-backgroundColor',
    emphasis: 'warning' as Emphasis
  },
  [SocialConnectionStatus.Incomplete]: {
    borderColor: 'border-intents-ux-info-borderColor',
    bgColor: 'bg-intents-ux-info-backgroundColor',
    emphasis: 'info' as Emphasis
  }
}

export const SocialConnectionStatusMessage = memo(function SocialConnectionStatusMessage({
  status,
  platformName,
  errorMessage
}: SocialConnectionStatusMessageProps) {
  const t = useTranslations()
  const config = statusConfig[status]

  const message =
    status === SocialConnectionStatus.Success
      ? t('builder_social_connected_to_platform', { platformName })
      : status === SocialConnectionStatus.Error
        ? t('builder_social_failed_to_connect_platform', { platformName })
        : t('builder_social_connection_incomplete_platform', { platformName })

  return (
    <Box className={clsx('rounded-md border p-2 mt-2', config.borderColor, config.bgColor)}>
      <Box orientation="vertical" gap="sm">
        <text.span size={-1} text={message} emphasis={config.emphasis as Emphasis} />
        {status === SocialConnectionStatus.Error && errorMessage && (
          <text.span size={-2} text={errorMessage} />
        )}
      </Box>
    </Box>
  )
})
