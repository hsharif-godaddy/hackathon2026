import { appFetch } from '@/lib/gasket-config'
import { SocialV2Client } from '@/lib/social'
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
  await appFetch(`/api/sites/${params.appId}/social/posts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      association_id: params.associationId,
      platform: params.platform,
      state: params.state,
      payload: {
        message: params.message,
        imageUrls: params.imageUrls
      },
      external_response: params.result ?? (params.error ? { error: params.error } : null),
      external_id: params.result?.id ?? null,
      completed_at: new Date().toISOString(),
      ...(params.scheduledAt && { scheduled_at: params.scheduledAt.toISOString() })
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
  if (!connection.igAccountId || !connection.userTokenId) {
    throw new Error(errorMessages?.missingInstagramCredentials)
  }
  if (!publish.imageUrls?.length) {
    throw new Error(errorMessages?.instagramImageRequired)
  }

  return socialV2Client.publishToInstagram({
    igAccountId: connection.igAccountId,
    tokenId: connection.userTokenId,
    imageUrl: publish.imageUrls[0],
    caption: publish.message,
    scheduledAt: publish.scheduledAt
  })
}

const platformPublishers = {
  facebook: publishToFacebook,
  instagram: publishToInstagram
} as const

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
