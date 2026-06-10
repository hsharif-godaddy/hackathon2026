'use client'

import clsx from 'clsx'
import { useState } from 'react'
import Box from '@ux/box'
import CodeIcon from '@ux/icon/code'

import { logger } from '@/lib/request-context'

interface AppThumbnailProps {
  siteName: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /**
   * Pre-rendered screenshot URL (resolve with getAppScreenshotUrl). When absent
   * — or when the image fails to load — a code-icon fallback tile is shown.
   * Pass key={screenshotUrl} at the call site so React remounts this component
   * when the URL changes, giving each URL a fresh error state automatically.
   */
  screenshotUrl?: string
}

const SIZE_CLASS_MAP = {
  xs: 'size-6',
  sm: 'size-12',
  md: 'size-10',
  lg: 'size-16'
} as const;

const ICON_SIZE_MAP = {
  xs: 'size-3',
  sm: 'size-4',
  md: 'size-4',
  lg: 'size-5'
} as const;

export default function AppThumbnail({ siteName, size, screenshotUrl }: AppThumbnailProps) {
  const [hasError, setHasError] = useState(false)

  const containerSize = size ? clsx(SIZE_CLASS_MAP[size], 'shrink-0') : 'w-full h-full'
  const iconSize = size ? ICON_SIZE_MAP[size] : ICON_SIZE_MAP.md
  const rounding = size ? 'rounded-md' : 'rounded-lg'
  const containerClasses = clsx(containerSize, rounding)
  const borderClasses = 'border-1 border-intents-ux-borderColor'

  if (!screenshotUrl || hasError) {
    return (
      <Box
        data-testid="app-thumbnail-fallback"
        blockAlignChildren="center"
        inlineAlignChildren="center"
        className={clsx(containerClasses, borderClasses, 'bg-intents-ux-boxLowContrast-backgroundColor')}
      >
        <CodeIcon className={iconSize} />
      </Box>
    )
  }

  return (
    <Box
      data-testid="app-thumbnail"
      blockAlignChildren="center"
      inlineAlignChildren="center"
      className={clsx(containerClasses, borderClasses, 'overflow-hidden', 'bg-intents-ux-boxLowContrast-backgroundColor')}
    >
      <img /* eslint-disable-line @next/next/no-img-element */
        src={screenshotUrl}
        alt={`Screenshot of ${siteName}`}
        className="w-full h-full object-cover object-top"
        onError={() => {
          logger.warn('app-thumbnail.image.load.failed', { siteName, screenshotUrl })
          setHasError(true)
        }}
      />
    </Box>
  )
}
