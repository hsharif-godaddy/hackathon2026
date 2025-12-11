import { useMemo } from 'react'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useServerPollingStore } from '@/stores/useServerPollingStore'

/**
 * Hook to convert relative image URLs to absolute URLs using the app's preview URL
 *
 * Images stored in the user's app (e.g., /images/foo.png) need to be accessed
 * via the app's preview URL (e.g., http://localhost:5001/images/foo.png),
 * not the main app's URL (http://localhost:3000).
 *
 * @param relativeOrAbsoluteUrl - Image URL that may be relative or absolute
 * @returns Absolute URL pointing to the user's app, or null if input is null
 *
 * @example
 * const imageUrl = useAppImageUrl('/images/photo.png')
 * // Returns: 'http://localhost:5001/images/photo.png'
 */
export function useAppImageUrl(relativeOrAbsoluteUrl: string | null | undefined): string | null {
  const appId = useAppIdFromParams()
  const getServerState = useServerPollingStore((state) => state.getServerState)
  const serverState = getServerState(appId)
  const previewUrl = serverState?.url

  return useMemo(() => {
    if (!relativeOrAbsoluteUrl) return null

    // If URL is already absolute, return as-is
    if (!relativeOrAbsoluteUrl.startsWith('/')) {
      return relativeOrAbsoluteUrl
    }

    // If URL is relative, construct full URL using app's preview URL
    if (previewUrl) {
      return `${previewUrl}${relativeOrAbsoluteUrl}`
    }

    // Fallback: return relative URL if preview URL not available yet
    return relativeOrAbsoluteUrl
  }, [relativeOrAbsoluteUrl, previewUrl])
}
