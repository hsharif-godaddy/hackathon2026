import { useCallback } from 'react'

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'

export interface PublishSnapshotDetail {
  appId: string
  deploymentId: string | undefined
  commitHash: string
}

export function usePublishSnapshotCapture() {
  const upload = useCallback(async (screenshotDataUrl: string, detail: PublishSnapshotDetail) => {
    const { appId, deploymentId, commitHash } = detail

    logger.info('publish-snapshots.upload.start', { appId, deploymentId, commitHash: commitHash.substring(0, 7) })

    try {
      const response = await fetch(screenshotDataUrl)
      const blob = await response.blob()

      const key = deploymentId ?? `${commitHash}-${Date.now()}`
      const manifest = {
        appId,
        deploymentId: deploymentId ?? null,
        commitHash,
        capturedAt: new Date().toISOString(),
        deploymentStatus: 'deployed',
      }

      const formData = new FormData()
      formData.append('key', key)
      formData.append('screenshot', blob, 'screenshot.png')
      formData.append('manifest', JSON.stringify(manifest))

      const uploadResponse = await appFetch(`/api/apps/${appId}/publish-snapshots`, {
        method: 'POST',
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`)
      }

      logger.info('publish-snapshots.upload.success', { appId, key })
    } catch (error) {
      logger.warn('publish-snapshots.upload.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  return { upload }
}
