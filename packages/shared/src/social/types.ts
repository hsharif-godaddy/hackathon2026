/**
 * Shared social platform constant
 */
export const CONNECT_REQUEST_FROM_PUBLISH = 'social_connect_with_post'

/**
 * Context attachment type sent by frontend after fetching Google reviews
 */
export const GOOGLE_REVIEWS_READY = 'google_reviews_ready'

/**
 * A single Google review as returned by the My Business Reviews API
 */
export interface GoogleReview {
  reviewId: string
  reviewer: {
    displayName: string
    profilePhotoUrl?: string
  }
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE'
  comment?: string
  createTime: string
  updateTime: string
}
