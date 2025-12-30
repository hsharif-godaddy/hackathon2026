/* eslint-disable @next/next/no-img-element */
'use client'

import { memo } from 'react'
import Box from '@ux/box'
import text from '@ux/text'

interface SocialConnectionInfoProps {
  name: string
  pictureUrl?: string
  details?: string
  size?: 'sm' | 'md'
  className?: string
}

export const SocialConnectionInfo = memo(function SocialConnectionInfo({
  name,
  pictureUrl,
  details,
  size = 'md',
  className
}: SocialConnectionInfoProps) {
  const imageSize = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6'
  const nameSize = size === 'sm' ? -1 : 0
  const detailsSize = size === 'sm' ? -2 : -1

  return (
    <Box orientation="horizontal" gap="sm" inlineAlignChildren="center" className={className}>
      {pictureUrl && (
        <img
          src={pictureUrl}
          alt={name}
          className={`${imageSize} rounded-full object-cover flex-shrink-0`}
        />
      )}
      <Box orientation="vertical" gap="sm">
        <text.span as="paragraph" size={nameSize} text={name} className="truncate" />
        {details && (
          <text.span as="paragraph" size={detailsSize} text={details} className="truncate" emphasis={ "passive" } />
        )}
      </Box>
    </Box>
  )
})
