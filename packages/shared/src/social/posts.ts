/**
 * Shared social post types used by both app/ and agents/
 */

/**
 * Validation details for social posts
 */
export interface ValidationDetails {
  isValid: boolean
  characterCount: number      // Total character count
  contentLength: number       // Length of main content text
  hashtagsLength: number      // Length of all hashtags
  callToActionLength: number  // Length of call-to-action
  maxCharacters: number
  minImages?: number          // Optional: only used by app for platform-specific validation
  maxImages: number
  errorMessages?: string[]
}

/**
 * Image data structure for social posts
 */
export interface PostImageData {
  url: string
  prompt?: string
  width: number
  height: number
  fileSizeKB?: number
}
