import { PublishablePlatform } from '@/lib/social-platforms'
import type { SocialPublishResult } from './social'

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
 * View states for the social post modal
 */
export enum PostModalView {
  PREVIEW = 'preview',
  EDIT = 'edit',
  SCHEDULING = 'scheduling'
}

/**
 * Timing options for publishing
 */
export enum PublishTiming {
  NOW = 'now',
  LATER = 'later'
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
  platform?: PublishablePlatform  // Optional - for backwards compatibility and display
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
  platforms: PublishablePlatform[]  // Changed from single platform to array
  platformData?: Array<{  // Optional for backwards compatibility
    platform: PublishablePlatform
    message: string
    imageUrls: string[]
    scheduledAt?: Date
  }>
  message: string  // Fallback for single platform or backwards compatibility
  imageUrls: string[]  // Fallback for single platform or backwards compatibility
  scheduledAt?: Date  // Fallback for single platform or backwards compatibility
}

export type PublishResult = SocialPublishResult | { error: string }

export interface PublishFlowCallbacks {
  onPlatformStatusChange: (platform: PublishablePlatform, status: PublishStatus) => void
  onPlatformResultChange: (platform: PublishablePlatform, result: PublishResult) => void
  onOverallStatusChange: (status: PublishStatus) => void
}

export type PublishAction =
  | { type: 'PLATFORM_STATUS_CHANGE'; platform: PublishablePlatform; status: PublishFlowState }
  | { type: 'PLATFORM_RESULT_CHANGE'; platform: PublishablePlatform; result: PublishResult }
  | { type: 'OVERALL_STATUS_CHANGE'; status: PublishFlowState }
  | { type: 'PUBLISH_STARTED' }
  | { type: 'BATCH_PLATFORM_UPDATE'; platform: PublishablePlatform; status: PublishFlowState; result?: PublishResult }
