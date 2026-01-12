import { SocialPlatform } from '@/types/social'
import { SocialPostData, ValidationDetails } from '@/types/social-posts'
import { formatHashtags } from './format'

/**
 * Platforms that support social post publishing
 * Currently only Facebook and Instagram are supported
 */
type PublishablePlatform = SocialPlatform.FACEBOOK | SocialPlatform.INSTAGRAM

/**
 * Platform-specific limits for social media posts
 */
interface PlatformLimits {
  maxCharacters: number
  minImages: number
  maxImages: number
  maxImageWidthPx?: number
  maxFileSizeMB?: number
}

/**
 * Character and image limits for each social media platform
 * Only includes platforms that support publishing
 */
const PLATFORM_LIMITS: Record<PublishablePlatform, PlatformLimits> = {
  [SocialPlatform.FACEBOOK]: {
    maxCharacters: 63206,
    minImages: 0,
    maxImages: 9
  },
  [SocialPlatform.INSTAGRAM]: {
    maxCharacters: 2200,
    minImages: 1,
    maxImages: 20,
    maxImageWidthPx: 1440,
    maxFileSizeMB: 8
  }
}

/**
 * Gets the platform-specific limits for character count and images
 * @param platform - The social media platform
 * @returns Platform limits object with maxCharacters and maxImages
 */
export function getPlatformLimits(platform: SocialPostData['platform']): PlatformLimits {
  return PLATFORM_LIMITS[platform as PublishablePlatform] || PLATFORM_LIMITS[SocialPlatform.FACEBOOK]
}

/**
 * Calculates total character count for a social post including content, hashtags, and call-to-action
 * @param post - The social post (can be partial for validation during editing)
 * @returns Total character count
 */
export function getCharacterCount(post: Partial<SocialPostData>): number {
  const contentLength = post.content?.length || 0
  const hashtagsLength = formatHashtags(post.hashtags).length
  const callToActionLength = post.callToAction?.length || 0

  return contentLength + hashtagsLength + callToActionLength
}

/**
 * Translation function type for validation messages
 */
type TranslationFunction = (key: string, values?: Record<string, any>, defaultMessage?: string) => string

/**
 * Validates a social post against platform-specific requirements
 * @param post - The social post to validate
 * @param t - Optional translation function. If not provided, uses English defaults
 * @returns Validation details including character counts and any error messages
 */
export function validateSocialPost(
  post: SocialPostData,
  t?: TranslationFunction
): ValidationDetails {
  const limits = getPlatformLimits(post.platform)

  const contentLength = post.content?.length || 0
  const hashtagsLength = formatHashtags(post.hashtags).length
  const callToActionLength = post.callToAction?.length || 0
  const characterCount = contentLength + hashtagsLength + callToActionLength

  const imageCount = post.images?.length || 0
  const hasEnoughImages = imageCount >= limits.minImages
  const notTooManyImages = imageCount <= limits.maxImages
  const withinCharLimit = characterCount <= limits.maxCharacters
  const isValid = withinCharLimit && hasEnoughImages && notTooManyImages

  const errorMessages: string[] = []
  if (!withinCharLimit) {
    errorMessages.push(
      t?.('builder_social_validation_char_limit',
        { maxCharacters: limits.maxCharacters },
        `Content exceeds {maxCharacters} character limit`
      ) || `Content exceeds ${limits.maxCharacters} character limit`
    )
  }
  if (!hasEnoughImages) {
    errorMessages.push(
      t?.('builder_social_validation_min_images',
        { minImages: limits.minImages },
        `At least {minImages} image required`
      ) || `At least ${limits.minImages} image required`
    )
  }
  if (!notTooManyImages) {
    errorMessages.push(
      t?.('builder_social_validation_max_images',
        { maxImages: limits.maxImages },
        `Too many images (max {maxImages})`
      ) || `Too many images (max ${limits.maxImages})`
    )
  }

  return {
    isValid,
    characterCount,
    contentLength,
    hashtagsLength,
    callToActionLength,
    maxCharacters: limits.maxCharacters,
    minImages: limits.minImages,
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
