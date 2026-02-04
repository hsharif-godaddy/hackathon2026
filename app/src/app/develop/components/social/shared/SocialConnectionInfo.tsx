/* eslint-disable @next/next/no-img-element */
'use client'

import { memo } from 'react'
import Box from '@ux/box'
import Skeleton from '@ux/skeleton'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

interface SocialConnectionInfoProps {
  name?: string
  pictureUrl?: string
  details?: string
  isLoading?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export const SocialConnectionInfo = memo(function SocialConnectionInfo({
  name,
  pictureUrl,
  details,
  isLoading = false,
  size = 'md',
  className
}: SocialConnectionInfoProps) {
  const t = useTranslations()
  const imageSize = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6'
  const nameSize = size === 'sm' ? -1 : 0
  const detailsSize = size === 'sm' ? -2 : -1

  if (isLoading) {
    return (
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center" className={className}>
        <Skeleton rounding="full" size="sm" width="24px" height="24px" />
        <Box orientation="vertical" gap="sm">
          <Skeleton size="sm" width="120px" height="20px" />
          <Skeleton size="sm" width="80px" height="16px" />
        </Box>
      </Box>
    )
  }

  return (
    <Box orientation="horizontal" gap="sm" inlineAlignChildren="center" className={className}>
      {pictureUrl && (
        <img
          src={pictureUrl}
          alt={name ?? t('builder_social_connect_info_img_alt')}
          className={`${imageSize} rounded-full object-cover flex-shrink-0`}
        />
      )}
      <Box orientation="vertical" gap="sm">
        {name && <text.span as="paragraph" size={nameSize} text={name} className="truncate" />}
        {details && (
          <text.span as="paragraph" size={detailsSize} text={details} className="truncate" emphasis={ "passive" } />
        )}
      </Box>
    </Box>
  )
})
