import { SocialPostData, ValidationDetails } from '@/types/social-posts'

/**
 * Platform-specific limits for social media posts
 */
interface PlatformLimits {
  maxCharacters: number
  maxImages: number
}

/**
 * Character and image limits for each social media platform
 */
const PLATFORM_LIMITS: Record<SocialPostData['platform'], PlatformLimits> = {
  facebook: {
    maxCharacters: 63206,
    maxImages: 9
  },
  instagram: {
    maxCharacters: 2200,
    maxImages: 1
  }
}

/**
 * Gets the platform-specific limits for character count and images
 * @param platform - The social media platform
 * @returns Platform limits object with maxCharacters and maxImages
 */
export function getPlatformLimits(platform: SocialPostData['platform']): PlatformLimits {
  return PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.facebook
}

/**
 * Calculates total character count for a social post including content, hashtags, and call-to-action
 * @param post - The social post (can be partial for validation during editing)
 * @returns Total character count
 */
export function getCharacterCount(post: Partial<SocialPostData>): number {
  const contentLength = post.content?.length || 0
  const hashtagsLength = post.hashtags ? post.hashtags.map(tag => `#${tag}`).join(' ').length : 0
  const callToActionLength = post.callToAction?.length || 0

  return contentLength + hashtagsLength + callToActionLength
}

/**
 * Validates a social post against platform-specific requirements
 * @param post - The social post to validate
 * @returns Validation details including character counts and any error messages
 */
export function validateSocialPost(post: SocialPostData): ValidationDetails {
  const limits = getPlatformLimits(post.platform)

  const contentLength = post.content?.length || 0
  const hashtagsText = post.hashtags ? post.hashtags.map(tag => `#${tag}`).join(' ') : ''
  const hashtagsLength = hashtagsText.length
  const callToActionLength = post.callToAction?.length || 0
  const characterCount = contentLength + hashtagsLength + callToActionLength

  const imageCount = post.images?.length || 0
  const isValid = characterCount <= limits.maxCharacters && imageCount <= limits.maxImages

  const errorMessages: string[] = []
  if (characterCount > limits.maxCharacters) {
    errorMessages.push(`Content exceeds ${limits.maxCharacters} character limit`)
  }
  if (imageCount > limits.maxImages) {
    errorMessages.push(`Too many images (max ${limits.maxImages})`)
  }

  return {
    isValid,
    characterCount,
    contentLength,
    hashtagsLength,
    callToActionLength,
    maxCharacters: limits.maxCharacters,
    maxImages: limits.maxImages,
    errorMessages: errorMessages.length > 0 ? errorMessages : undefined
  }
}

/**
 * Checks if a social post exceeds the character limit for its platform
 * @param post - The social post to check (can be partial for validation during editing)
 * @returns True if post exceeds character limit, false otherwise
 */
export function isPostOverLimit(post: Partial<SocialPostData>): boolean {
  if (!post.platform) return false

  const limits = getPlatformLimits(post.platform as SocialPostData['platform'])
  const charCount = getCharacterCount(post)

  return charCount > limits.maxCharacters
}
