import { useState } from 'react'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'

interface UseDownloadAppResult {
  download: (appId: string) => Promise<void>
  isDownloading: boolean
  error: string | null
}

/**
 * Hook for downloading app files as a zip archive
 *
 * @example
 * ```tsx
 * const { download, isDownloading, error } = useDownloadApp()
 *
 * const handleDownload = async () => {
 *   await download('app-123')
 * }
 * ```
 */
export function useDownloadApp(): UseDownloadAppResult {
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async (appId: string) => {
    setIsDownloading(true)
    setError(null)

    try {
      logger.info('app.download.start', { appId })

      // Step 1: Regenerate JWT with fresh permissions
      logger.info('app.download.regenerate_token', { appId })
      const tokenResult = await regenerateToken({ siteId: appId, force: true })

      // Step 2: Get agent URL for this site
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available for this site')
      }

      // Step 3: Call agent service directly with fresh token
      const downloadUrl = `${apiConfig.agentUrl}/apps/${appId}/zip`
      logger.info('app.download.fetching', { appId, url: downloadUrl })

      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokenResult.token}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to download app files' }))
        logger.error('app.download.response_error', {
          appId,
          status: response.status,
          statusText: response.statusText,
          errorData,
        })

        // Use detailed error message if available
        const errorMessage = errorData.details || errorData.error || `Download failed: ${response.status}`
        throw new Error(errorMessage)
      }

      // Get the blob from the response
      const blob = await response.blob()

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `app-${appId}.zip`

      if (contentDisposition) {
        const matches = /filename="?([^"]+)"?/.exec(contentDisposition)
        if (matches && matches[1]) {
          filename = matches[1]
        }
      }

      // Create a download link and trigger it
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)

      try {
        link.click()
        logger.info('app.download.success', { appId, filename })
      } finally {
        // Always cleanup DOM and URL, even if click fails
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      logger.error('app.download.error', {
        appId,
        error: errorMessage,
      })
      setError(errorMessage)
      throw err
    } finally {
      setIsDownloading(false)
    }
  }

  return {
    download,
    isDownloading,
    error,
  }
}
