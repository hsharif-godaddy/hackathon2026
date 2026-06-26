/**
 * Social Platform Enum
 * Matches the CHECK constraint in social_associations table
 */
export enum SocialPlatform {
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  GOOGLE_BUSINESS_PROFILE = 'GOOGLE_BUSINESS_PROFILE',
  GOOGLE_SEARCH_CONSOLE = 'GOOGLE_SEARCH_CONSOLE',
  TIKTOK = 'TIKTOK',
  YELP = 'YELP',
  WHATSAPP = 'WHATSAPP'
}

/**
 * Post State Enum
 * DRAFT is the pre-launch editable state; SCHEDULED/PUBLISHED/FAILED are the post-launch
 * lifecycle states. The legacy social_posts.state CHECK constraint was dropped in RUBICON-436
 * to admit DRAFT; the state is now validated against this enum at the repository boundary
 * (SocialPostRepository.create/update, via assertEnumValue).
 */
export enum PostState {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED'
}

/**
 * Type guard to check if a string is a valid SocialPlatform
 */
export function isSocialPlatform(value: string): value is SocialPlatform {
  return Object.values(SocialPlatform).includes(value as SocialPlatform);
}

/**
 * Type guard to check if a string is a valid PostState
 */
export function isPostState(value: string): value is PostState {
  return Object.values(PostState).includes(value as PostState);
}

/**
 * Get all valid social platforms as array
 */
export function getAllPlatforms(): SocialPlatform[] {
  return Object.values(SocialPlatform);
}

/**
 * Get all valid post states as array
 */
export function getAllPostStates(): PostState[] {
  return Object.values(PostState);
}

export { CONNECT_REQUEST_FROM_PUBLISH, GOOGLE_REVIEWS_READY, GBP_PROFILE_READY, GBP_UPDATE_DONE } from '@airo/shared/social'
