import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { scheduleInstagramPost } from '@/lib/marketing-api'
import { SocialV2Client } from '@/lib/social'
import { type PublishablePlatform, SocialPlatform } from '@/lib/social-platforms'
import { isFacebookConnection, isInstagramConnection } from '@/lib/utils/social-type-guards'
import type { SocialConnection, SocialPublishResult } from '@/types/social'
import { type PendingPublish, SocialPostState } from '@/types/social-posts'

const socialV2Client = new SocialV2Client()

export interface PublishErrorMessages {
  platformMismatchFacebook?: string
  platformMismatchInstagram?: string
  missingPageCredentials?: string
  missingInstagramCredentials?: string
  instagramImageRequired?: string
  platformNotSupported?: string
  commonError?: string
}

interface StorePostParams {
  appId: string
  associationId: string
  platform: string
  state: SocialPostState
  message: string
  imageUrls: string[]
  result?: SocialPublishResult
  error?: string
  scheduledAt?: Date
}

export async function storePostResult(params: StorePostParams): Promise<void> {
  const apiUrl = await buildDynamicApiUrl('social/posts', params.appId)
  await agentFetch(apiUrl, {
    siteId: params.appId,
    method: 'POST',
    body: JSON.stringify({
      associationId: params.associationId,
      platform: params.platform,
      state: params.state,
      payload: {
        message: params.message,
        imageUrls: params.imageUrls
      },
      externalResponse: params.result ?? (params.error ? { error: params.error } : null),
      externalId: params.result?.id ?? null,
      completedAt: new Date().toISOString(),
      ...(params.scheduledAt && { scheduledAt: params.scheduledAt.toISOString() })
    })
  })
}

async function publishToFacebook(
  publish: PendingPublish,
  connection: SocialConnection,
  errorMessages?: PublishErrorMessages
): Promise<SocialPublishResult> {
  if (!isFacebookConnection(connection)) {
    throw new Error(errorMessages?.platformMismatchFacebook)
  }
  if (!connection.pageId || !connection.pageTokenId) {
    throw new Error(errorMessages?.missingPageCredentials)
  }

  return socialV2Client.publishToFacebook({
    pageId: connection.pageId,
    tokenId: connection.pageTokenId,
    message: publish.message,
    imageUrls: publish.imageUrls,
    scheduledAt: publish.scheduledAt
  })
}

async function publishToInstagram(
  publish: PendingPublish,
  connection: SocialConnection,
  errorMessages?: PublishErrorMessages
): Promise<SocialPublishResult> {
  if (!isInstagramConnection(connection)) {
    throw new Error(errorMessages?.platformMismatchInstagram)
  }
  if (!publish.imageUrls?.length) {
    throw new Error(errorMessages?.instagramImageRequired)
  }

  // Use Marketing API for scheduled posts
  if (publish.scheduledAt) {
    const result = await scheduleInstagramPost({
      socialId: connection.socialId,
      images: publish.imageUrls,
      message: publish.message,
      scheduleTime: publish.scheduledAt.toISOString()
    })

    return {
      id: result.jobId,
      scheduledAt: result.scheduleTime
    }
  }

  // Use Social V2 API for immediate posts
  if (!connection.igAccountId || !connection.userTokenId) {
    throw new Error(errorMessages?.missingInstagramCredentials)
  }

  return socialV2Client.publishToInstagram({
    igAccountId: connection.igAccountId,
    tokenId: connection.userTokenId,
    imageUrl: publish.imageUrls[0],
    caption: publish.message
  })
}

const platformPublishers: Record<PublishablePlatform, (publish: PendingPublish, connection: SocialConnection, errorMessages?: PublishErrorMessages) => Promise<SocialPublishResult>> = {
  [SocialPlatform.FACEBOOK]: publishToFacebook,
  [SocialPlatform.INSTAGRAM]: publishToInstagram
}

export async function publishToPlatform(
  publish: PendingPublish,
  connection: SocialConnection,
  errorMessages?: PublishErrorMessages
): Promise<SocialPublishResult> {
  const publisher = platformPublishers[publish.platform]
  if (!publisher) {
    throw new Error(errorMessages?.platformNotSupported)
  }

  return publisher(publish, connection, errorMessages)
}
