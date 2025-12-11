/**
 * Social Posts Type Definitions
 *
 * Shared types for social post components, widgets, and tools.
 */

export enum SocialPlatform {
  Facebook = 'facebook',
  Instagram = 'instagram'
}

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

/**
 * Social Post data structure
 */
export interface SocialPostData {
  id?: string               // Unique identifier generated for each post
  name?: string             // Human-readable name for the post
  topic?: string            // Topic or theme of the post
  styleLabel: string
  styleDescription?: string
  content: string
  hashtags: string[]
  platform: SocialPlatform
  callToAction?: string
  images?: PostImageData[]
  hasImages?: boolean       // Flag indicating if post has images
  validation?: ValidationDetails
}
