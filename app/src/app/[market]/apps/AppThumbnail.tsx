import clsx from 'clsx'
import Box from '@ux/box'
import CodeIcon from '@ux/icon/code'
import Skeleton from '@ux/skeleton'

import { useAppThumbnail } from '@/hooks/useAppThumbnail'

interface AppThumbnailProps {
  siteId: string
  siteName: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** When set (e.g. from GET /api/sites), resolves screenshot URL without GET /api/sites/:id */
  agentUrl?: string
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

export default function AppThumbnail({ siteId, siteName, size, agentUrl }: AppThumbnailProps) {
  const { data: thumbnailUrl, isLoading, isError } = useAppThumbnail(siteId, true, agentUrl)

  const containerSize = size ? clsx(SIZE_CLASS_MAP[size], 'shrink-0') : 'w-full h-full'
  const iconSize = size ? ICON_SIZE_MAP[size] : ICON_SIZE_MAP.md
  const rounding = size ? 'rounded-md' : 'rounded-lg'
  const containerClasses = clsx(containerSize, rounding)
  const borderClasses = 'border-1 border-intents-ux-borderColor'

  if (isLoading) {
    return (
      <Box
        data-testid="app-thumbnail-loading"
        blockAlignChildren="center"
        inlineAlignChildren="center"
        className={clsx(containerClasses)}
      >
        <Skeleton height="100%" width="100%" />
      </Box>
    )
  }

  if (isError || !thumbnailUrl) {
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
      className={clsx(containerClasses, borderClasses, 'overflow-hidden')}
    >
      <img /* eslint-disable-line @next/next/no-img-element */
        src={thumbnailUrl}
        alt={`Screenshot of ${siteName}`}
        className="w-full h-full object-cover object-top"
      />
    </Box>
  )
}
