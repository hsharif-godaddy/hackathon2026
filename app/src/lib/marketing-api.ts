import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { getRootDomain } from '@/utils/getRootDomain'

const MARKETING_API_BASE_URL = `https://marketing.api.${getRootDomain() || 'godaddy.com'}`

export interface InstagramScheduledPostResponse {
  message: string
  jobId: string
  scheduleTime: string
}

/**
 * Schedule Instagram post via Marketing API
 *
 * Note: Instagram API requires scheduleTime >15 min in future
 * Facebook API requires scheduleTime >10 min in future
 * UI enforces unified 20-minute minimum to account for TimePicker intervals, user delay, and API latency
 * For immediate posts, use Social V2 API instead
 */
export async function scheduleInstagramPost(params: {
  socialId: string
  images: string[] // Image URLs
  message: string
  scheduleTime: string // ISO 8601 format, must be >15 min in future (UI enforces 20 min)
}): Promise<InstagramScheduledPostResponse> {
  logger.info('marketing.instagram.schedule.start', {
    socialId: params.socialId,
    scheduleTime: params.scheduleTime,
    imageCount: params.images.length
  })

  const response = await appFetch(
    `${MARKETING_API_BASE_URL}/v1/instagram/createPost`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        socialId: params.socialId,
        payload: {
          images: params.images.map(src => ({ src })),
          message: params.message,
          scheduleTime: params.scheduleTime
        }
      })
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage = errorData.message || `Failed to schedule Instagram post: ${response.status}`

    logger.error('marketing.instagram.schedule.error', {
      socialId: params.socialId,
      status: response.status,
      error: errorMessage
    })

    throw new Error(errorMessage)
  }

  const data = await response.json()

  logger.info('marketing.instagram.schedule.success', {
    socialId: params.socialId,
    jobId: data.jobId,
    scheduleTime: data.scheduleTime
  })

  return data
}
