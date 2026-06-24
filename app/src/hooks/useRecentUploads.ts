import { useCallback, useEffect, useState } from 'react'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'

export interface UploadedMediaFile {
  id: string
  filename: string
  originalName: string
  mimeType: string | null
  size: number
  signedUrl?: string
  fullSignedUrl?: string
}

interface UseRecentUploadsOptions {
  appId: string | null
}

export function useRecentUploads({ appId }: UseRecentUploadsOptions) {
  const [uploads, setUploads] = useState<UploadedMediaFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUploads = useCallback(async () => {
    if (!appId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
      if (!apiConfig.agentUrl) throw new Error('Agent URL not available')
      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

      const response = await fetch(`${baseAgentUrl}/files/${appId}/list`, {
        headers: { Authorization: `Bearer ${tokenResult.token}` },
      })
      if (!response.ok) throw new Error('Failed to fetch uploads')

      const data = await response.json()
      const mediaFiles = (data.files || [])
        .filter((file: UploadedMediaFile) => file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/'))
        .map((file: UploadedMediaFile) => {
          if (!file.signedUrl) return { ...file, fullSignedUrl: undefined }
          const fullUrl = `${baseAgentUrl}${file.signedUrl}`
          return { ...file, fullSignedUrl: fullUrl }
        })

      setUploads(mediaFiles)
      setError(null)
    } catch (err) {
      logger.error('recent_uploads.fetch.error', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      })
      setError('Failed to load uploads')
    } finally {
      setIsLoading(false)
    }
  }, [appId])

  useEffect(() => {
    fetchUploads()
  }, [fetchUploads])

  return { uploads, isLoading, error, refetch: fetchUploads }
}
