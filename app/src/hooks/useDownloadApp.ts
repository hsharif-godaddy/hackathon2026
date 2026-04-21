import { useState } from 'react'

import { appFetch, AuthDismissedError } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'

interface UseDownloadAppResult {
  download: () => Promise<void>
  isDownloading: boolean
  error: string | null
}

interface DownloadResponse {
  downloadUrl: string
  token: string
  filename: string
  tracked: boolean
  exportId?: string
}

/**
 * Hook for downloading app files as a zip archive
 *
 * Flow:
 * 1. Call /api/apps/[id]/download to track export and get download URL
 * 2. Fetch directly from agent using the provided token
 * 3. Trigger browser download
 *
 *
 * @param appId - The app/site ID to download (null disables the hook)
 */
export function useDownloadApp(appId: string | null): UseDownloadAppResult {
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    if (!appId) {
      throw new Error('App ID is required for download')
    }

    setIsDownloading(true)
    setError(null)

    try {
      logger.info('app.download.start', { appId })

      const response = await appFetch(`/api/apps/${appId}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, { authLevel: 3 })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to initiate download' }))
        logger.error('app.download.init_error', {
          appId,
          status: response.status,
          errorData,
        })
        throw new Error(errorData.details || errorData.error || `Download failed: ${response.status}`)
      }

      const data: DownloadResponse = await response.json()

      logger.info('app.download.fetching', {
        appId,
        tracked: data.tracked,
        exportId: data.exportId,
      })

      const agentResponse = await fetch(data.downloadUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${data.token}`,
        },
      })

      if (!agentResponse.ok) {
        logger.error('app.download.agent_error', {
          appId,
          status: agentResponse.status,
        })
        throw new Error(`Download failed: ${agentResponse.status}`)
      }

      // Step 3: Get blob and trigger download
      const blob = await agentResponse.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = data.filename
      document.body.appendChild(link)

      try {
        link.click()
      } finally {
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
      }
    } catch (err) {
      if (err instanceof AuthDismissedError) return
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      logger.error('app.download.error', { appId, error: errorMessage })
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
