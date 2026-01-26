import type { SocialPublishResult } from './social'

/**
 * Platforms that support direct publishing
 * Subset of SocialPlatform that has publish functionality implemented
 */
export enum PublishablePlatform {
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram'
}

/**
 * State of a social post in the database
 * Represents the lifecycle state after a publish attempt
 */
export enum SocialPostState {
  PUBLISHED = 'PUBLISHED',   // Successfully published to platform
  SCHEDULED = 'SCHEDULED',   // Scheduled for future publishing
  FAILED = 'FAILED',         // Publish attempt failed
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
  minImages: number
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
  platform: PublishablePlatform
  callToAction?: string
  images?: PostImageData[]
  hasImages?: boolean       // Flag indicating if post has images
  validation?: ValidationDetails
  publishedState?: SocialPostState  // Publication state (PUBLISHED, SCHEDULED, FAILED)
}

export enum PublishFlowState {
  ReadyToPublish = 'ready-to-publish',
  Publishing = 'publishing',
  Success = 'success',
  Error = 'error'
}

export type PublishStatus = `${PublishFlowState}`

export interface PendingPublish {
  publishId?: string
  platform: PublishablePlatform
  message: string
  imageUrls: string[]
  scheduledAt?: Date
}

export type PublishResult = SocialPublishResult | { error: string }

export interface PublishFlowCallbacks {
  onStatusChange: (status: PublishStatus) => void
  onResultChange: (result: PublishResult) => void
}
