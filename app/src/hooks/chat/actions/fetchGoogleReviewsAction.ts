/**
 * Fetch Google Reviews Action Executor
 *
 * Fetches Google Business Profile reviews via the Social V2 API.
 * Called by the google-reviews skill's executeWorkflow tool via clientActionService.
 */

import { logger } from '@/lib/request-context'
import { socialV2Client } from '@/lib/social'
import { isGoogleConnection } from '@/lib/utils/social-type-guards'
import type { GoogleReview } from '@/types/social'
import type { ClientActionExecutor } from './types'

const STAR_RATING_MAP: Record<GoogleReview['starRating'], number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

export const fetchGoogleReviewsAction: ClientActionExecutor = async (params) => {
  const { socialId } = params

  if (!socialId || typeof socialId !== 'string') {
    throw new Error('socialId is required and must be a string')
  }

  logger.info('client-action.fetch-google-reviews.begin', { socialId })

  const connection = await socialV2Client.getConnectionById(socialId)
  if (!isGoogleConnection(connection)) {
    throw new Error(`Expected GOOGLE_BUSINESS_PROFILE connection, got ${connection.platform}`)
  }

  const { userTokenId, locationId } = connection
  let { accountId } = connection

  if (!userTokenId) {
    throw new Error('No user token found for this Google connection')
  }
  if (!locationId) {
    throw new Error('Google Business Profile connection is missing a location. Please reconnect your Google Business Profile and select your business location.')
  }

  if (!accountId) {
    const locations = await socialV2Client.getGoogleLocations(userTokenId)
    accountId = locations.find(loc => loc.id === locationId)?.accountId
  }

  if (!accountId) {
    throw new Error('Google Business Profile connection is missing account info. Please reconnect your Google Business Profile and select your business location.')
  }

  const reviews = await socialV2Client.getGoogleReviews(userTokenId, accountId, locationId)

  logger.info('client-action.fetch-google-reviews.success', { socialId, count: reviews.length })

  const totalRating = reviews.reduce((sum, r) => sum + (STAR_RATING_MAP[r.starRating] ?? 0), 0)
  const averageRating = reviews.length > 0 ? totalRating / reviews.length : undefined

  return {
    reviews,
    averageRating,
    totalReviewCount: reviews.length,
  }
}
