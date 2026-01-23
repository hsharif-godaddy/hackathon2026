/**
 * Social Platform Enum
 * Matches the CHECK constraint in social_associations table
 */
export enum SocialPlatform {
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  GOOGLE_BUSINESS_PROFILE = 'GOOGLE_BUSINESS_PROFILE',
  TIKTOK = 'TIKTOK',
  YELP = 'YELP',
  WHATSAPP = 'WHATSAPP'
}

/**
 * Post State Enum
 * Matches the CHECK constraint in social_posts table
 */
export enum PostState {
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

export const CONNECT_REQUEST_FROM_PUBLISH = 'social_connect_with_post'
