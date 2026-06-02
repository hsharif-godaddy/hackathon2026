/**
 * Shared handling for `video` generation events pushed from the backend.
 *
 * Used by BOTH transports' client handlers (WS `VideoHandler`, SSE
 * `useSSEChat`) so a launch-video result produces the same customer-visible
 * outcome — store update AND a Growl toast — regardless of transport. WS is
 * the reference behavior; keep this in lockstep with it.
 */

import Growl from '@ux/growl'

import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

export interface VideoEventData {
  status: string
  appId?: string
  jobId?: string
  videoUrl?: string
  error?: string
}

export function isVideoEventData(raw: unknown): raw is VideoEventData {
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

export interface HandleVideoNotificationParams {
  /** Raw event payload (`data.data` for WS, `event.data` for SSE). */
  raw: unknown
  /** The app the client is currently viewing, used for the mismatch guard. */
  clientAppId: string | null | undefined
  /** Translation function (WS handler context / `useTranslations()`). */
  t: (id: string, values?: Record<string, unknown>) => string
  /** Log-event namespace so WS/SSE turns stay distinguishable in logs. */
  logPrefix: string
}

/**
 * Validate, guard on appId, update the launch-video store, and show a Growl
 * toast. Store/toast failures are caught and logged under `${logPrefix}.*`
 * rather than propagated (assuming the injected `logger` honors its own
 * non-throwing contract).
 */
export function handleVideoNotification(params: HandleVideoNotificationParams): void {
  const { raw, clientAppId, t, logPrefix } = params

  if (!isVideoEventData(raw)) {
    logger.warn(`${logPrefix}.invalid-payload`, {
      appId: clientAppId,
      reason: 'missing or non-string status field',
      received: typeof (raw as Record<string, unknown>)?.status,
    })
    return
  }

  const { status, appId: payloadAppId, jobId, videoUrl, error } = raw

  if (payloadAppId && clientAppId && payloadAppId !== clientAppId) {
    logger.debug(`${logPrefix}.ignored`, {
      clientAppId,
      payloadAppId,
      reason: 'appId mismatch',
    })
    return
  }

  // Fall back to the payload appId when the client has no current app (e.g. a
  // background SSE turn). Without an appId the store keys nowhere.
  const targetAppId = clientAppId ?? payloadAppId
  if (!targetAppId) {
    logger.debug(`${logPrefix}.ignored`, { reason: 'no appId' })
    return
  }

  logger.info(`${logPrefix}.received`, {
    appId: targetAppId,
    status,
    jobId,
    hasVideoUrl: !!videoUrl,
    hasError: !!error,
  })

  try {
    const store = useDevelopPageStore.getState()

    if (status === 'completed' && videoUrl) {
      store.setLaunchVideoResult(targetAppId, { type: 'success', url: videoUrl })

      Growl.addGrowlMessage({
        id: `video-success-${jobId}`,
        title: t('builder_video_ready_title') || 'Video Ready',
        children: t('builder_video_ready_description') || 'Your launch video has been generated successfully.',
        emphasis: 'success',
        lifetime: 5000,
      })

      logger.info(`${logPrefix}.completed`, { appId: targetAppId, jobId, videoUrl })
    } else if (status === 'failed') {
      store.setLaunchVideoResult(targetAppId, { type: 'error', message: 'Video generation failed' })

      Growl.addGrowlMessage({
        id: `video-failure-${jobId}`,
        title: t('builder_video_failed_title') || 'Video Failed',
        children: t('builder_video_failed_default_error') || 'Your video generation failed. Please try again.',
        emphasis: 'critical',
        lifetime: 8000,
      })

      logger.error(`${logPrefix}.failed`, { appId: targetAppId, jobId, error: error || 'Unknown error' })
    } else {
      // 'completed' without a videoUrl, or any unrecognized status: no store
      // update or toast would otherwise leave the launch-video UI waiting with
      // no terminal signal. Log so it's diagnosable.
      logger.warn(`${logPrefix}.unhandled_status`, {
        appId: targetAppId,
        jobId,
        status,
        hasVideoUrl: !!videoUrl,
      })
    }
  } catch (err) {
    logger.warn(`${logPrefix}.notification_failed`, {
      appId: targetAppId,
      status,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
