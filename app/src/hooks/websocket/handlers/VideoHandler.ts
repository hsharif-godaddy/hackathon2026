/**
 * Handles video generation completion/failure events pushed from the backend.
 */

import Growl from '@ux/growl'

import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

interface VideoEventData {
  status: string
  appId?: string
  jobId?: string
  videoUrl?: string
  error?: string
}

function isVideoEventData(raw: unknown): raw is VideoEventData {
  if (typeof raw !== 'object' || raw === null) return false
  const r = raw as Record<string, unknown>
  return (
    typeof r.status === 'string' &&
    (r.appId === undefined || typeof r.appId === 'string') &&
    (r.jobId === undefined || typeof r.jobId === 'string') &&
    (r.videoUrl === undefined || typeof r.videoUrl === 'string') &&
    (r.error === undefined || typeof r.error === 'string')
  )
}

export class VideoHandler implements MessageHandler {
  readonly type = 'video'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    const raw = data.data ?? {}
    const clientAppId = context.currentAppId

    if (!isVideoEventData(raw)) {
      logger.warn('video.websocket.invalid-payload', {
        appId: clientAppId,
        reason: 'missing or non-string status field',
        received: typeof raw.status
      })
      return
    }

    const { status, appId: payloadAppId, jobId, videoUrl, error } = raw

    if (payloadAppId && clientAppId && payloadAppId !== clientAppId) {
      logger.debug('video.websocket.ignored', {
        clientAppId,
        payloadAppId,
        reason: 'appId mismatch'
      })
      return
    }

    logger.info('video.websocket.received', {
      appId: clientAppId,
      status,
      jobId,
      hasVideoUrl: !!videoUrl,
      hasError: !!error
    })

    const store = useDevelopPageStore.getState()

    if (status === 'completed' && videoUrl) {
      store.setLaunchVideoResult(clientAppId, { type: 'success', url: videoUrl })

      Growl.addGrowlMessage({
        id: `video-success-${jobId}`,
        title: context.t('builder_video_ready_title') || 'Video Ready',
        children: context.t('builder_video_ready_description') || 'Your launch video has been generated successfully.',
        emphasis: 'success',
        lifetime: 5000
      })

      logger.info('video.websocket.completed', {
        appId: clientAppId,
        jobId,
        videoUrl
      })
    } else if (status === 'failed') {
      store.setLaunchVideoResult(clientAppId, { type: 'error', message: "Video generation failed" })

      Growl.addGrowlMessage({
        id: `video-failure-${jobId}`,
        title: context.t('builder_video_failed_title') || 'Video Failed',
        children: context.t('builder_video_failed_default_error') || 'Your video generation failed. Please try again.',
        emphasis: 'critical',
        lifetime: 8000
      })

      logger.error('video.websocket.failed', {
        appId: clientAppId,
        jobId,
        error: error || 'Unknown error'
      })
    }
  }
}
