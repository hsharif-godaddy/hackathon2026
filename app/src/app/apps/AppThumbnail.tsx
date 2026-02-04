import clsx from 'clsx'
import { useEffect, useState } from 'react'
import Box from '@ux/box'
import CodeIcon from '@ux/icon/code'
import Skeleton from '@ux/skeleton'

import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'

interface AppThumbnailProps {
  siteId: string
  siteName: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
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

export default function AppThumbnail({ siteId, siteName, size }: AppThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let isMounted = true
    let objectUrl: string | null = null

    const loadThumbnail = async () => {
      try {
        const apiUrl = await buildDynamicApiUrl('screenshot', siteId)

        const response = await agentFetch(apiUrl, {
          method: 'GET',
          siteId
        })

        if (!isMounted) return

        if (response.ok) {
          const blob = await response.blob()
          objectUrl = URL.createObjectURL(blob)
          setThumbnailUrl(objectUrl)
          setError(false)
        } else if (response.status === 404) {
          setError(true)
        } else {
          setError(true)
        }
      } catch (err) {
        if (!isMounted) return
        setError(true)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadThumbnail()

    return () => {
      isMounted = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [siteId])

  const containerSize = size ? clsx(SIZE_CLASS_MAP[size], 'shrink-0') : 'w-full h-full'
  const iconSize = size ? ICON_SIZE_MAP[size] : ICON_SIZE_MAP.md
  const rounding = size ? 'rounded-md' : 'rounded-lg'
  const containerClasses = clsx(containerSize, rounding)
  const borderClasses = 'border-1 border-intents-ux-borderColor'

  if (loading) {
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

  if (error || !thumbnailUrl) {
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
