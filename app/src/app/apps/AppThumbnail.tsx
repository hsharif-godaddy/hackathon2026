import { useState, useEffect } from 'react'
import { CodeBracketIcon } from '@heroicons/react/24/outline'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'

interface AppThumbnailProps {
  siteId: string
  siteName: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

export default function AppThumbnail({ siteId, siteName, size = 'md' }: AppThumbnailProps) {
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

  const sizeClasses =
    size === 'xs' ? 'w-6 h-6' :
    size === 'sm' ? 'w-12 h-12' :
    size === 'lg' ? 'w-16 h-16' :
    'w-10 h-10'
  const iconSize =
    size === 'xs' ? 'w-3 h-3' :
    size === 'lg' ? 'w-5 h-5' :
    'w-4 h-4'

  if (loading) {
    return (
      <div
        data-testid="app-thumbnail-loading"
        className={`${sizeClasses} shrink-0 rounded-md bg-intents-ux-boxHighContrast-backgroundColor transition-all duration-300 flex items-center justify-center`}
      >
        <div className="animate-pulse">
          <CodeBracketIcon className={`${iconSize} text-gray-400`} />
        </div>
      </div>
    )
  }

  if (error || !thumbnailUrl) {
    return (
      <div
        data-testid="app-thumbnail-fallback"
        className={`${sizeClasses} shrink-0 rounded-md bg-intents-ux-boxHighContrast-backgroundColor transition-all duration-300 flex items-center justify-center`}
      >
        <CodeBracketIcon className={`${iconSize} text-gray-400`} />
      </div>
    )
  }

  return (
    <div
      data-testid="app-thumbnail"
      className={`${sizeClasses} shrink-0 rounded-md overflow-hidden bg-intents-ux-boxHighContrast-backgroundColor transition-all duration-300`}
    >
      <img /* eslint-disable-line @next/next/no-img-element */
        src={thumbnailUrl}
        alt={`Screenshot of ${siteName}`}
        className="w-full h-full object-cover"
      />
    </div>
  )
}
