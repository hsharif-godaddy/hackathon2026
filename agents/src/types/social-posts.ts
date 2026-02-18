/**
 * Social Posts Type Definitions
 *
 * Shared types for social post tools and components.
 */

import { z } from 'zod'

/**
 * Validation details interface
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
 * Zod schema for validation details
 */
export const ValidationDetailsSchema = z.object({
  isValid: z.boolean(),
  characterCount: z.number(),
  contentLength: z.number(),
  hashtagsLength: z.number(),
  callToActionLength: z.number(),
  maxCharacters: z.number(),
  maxImages: z.number(),
  errorMessages: z.array(z.string()).optional()
})

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
 * Zod schema for post image data
 */
export const PostImageDataSchema = z.object({
  url: z.string(),
  prompt: z.string().optional(),
  width: z.number(),
  height: z.number(),
  fileSizeKB: z.number().optional()
})

/**
 * Social post data structure
 *
 * Represents a social media post throughout its lifecycle:
 * - During generation: id, topic assigned immediately
 * - After save: selectedAt is added to indicate persistence
 */
export interface SocialPost {
  id: string                // Unique identifier (assigned at generation)
  styleLabel: string
  styleDescription?: string
  content: string
  hashtags: string[]
  platform?: 'facebook' | 'instagram'  // Optional - posts are now platform-agnostic
  callToAction?: string
  images?: PostImageData[]
  validation?: ValidationDetails
  topic: string             // Topic/campaign (assigned at generation)
  selectedAt?: Date         // Timestamp when saved (only present for persisted posts)
}

/**
 * Zod schema for social post
 */
export const SocialPostSchema = z.object({
  id: z.string(),
  styleLabel: z.string(),
  styleDescription: z.string().optional(),
  content: z.string(),
  hashtags: z.array(z.string()),
  platform: z.enum(['facebook', 'instagram']).optional(),
  callToAction: z.string().optional(),
  images: z.array(PostImageDataSchema).optional(),
  validation: ValidationDetailsSchema.optional(),
  topic: z.string(),
  selectedAt: z.date().optional()
})
