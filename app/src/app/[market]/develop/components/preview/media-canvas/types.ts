/**
 * Media Library type definitions and constants.
 *
 * Central source of truth for media types, accepted formats, and per-type
 * attributes used throughout the Media Canvas feature.
 */

// ─── Media Categories ───────────────────────────────────────────────────────────

export enum MediaCategory {
  Image = 'image',
  Video = 'video',
  Audio = 'audio',
}

// ─── Accepted Formats (MIME types) ──────────────────────────────────────────────

export const IMAGE_FORMATS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export const VIDEO_FORMATS = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const

export const AUDIO_FORMATS = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/webm',
] as const

export type ImageMimeType = (typeof IMAGE_FORMATS)[number]
export type VideoMimeType = (typeof VIDEO_FORMATS)[number]
export type AudioMimeType = (typeof AUDIO_FORMATS)[number]
export type MediaMimeType = ImageMimeType | VideoMimeType | AudioMimeType

export const ALL_MEDIA_FORMATS: readonly MediaMimeType[] = [
  ...IMAGE_FORMATS,
  ...VIDEO_FORMATS,
  ...AUDIO_FORMATS,
]

export const FORMATS_BY_CATEGORY: Record<MediaCategory, readonly MediaMimeType[]> = {
  [MediaCategory.Image]: IMAGE_FORMATS,
  [MediaCategory.Video]: VIDEO_FORMATS,
  [MediaCategory.Audio]: AUDIO_FORMATS,
}

// ─── File Extensions (for display / accept strings) ─────────────────────────────

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'] as const
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'] as const
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.weba'] as const

// ─── Size Limits ────────────────────────────────────────────────────────────────

export const MAX_IMAGE_SIZE = 25 * 1024 * 1024 // 25 MB
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024 // 50 MB
export const MAX_AUDIO_SIZE = 25 * 1024 * 1024 // 25 MB

export const MAX_SIZE_BY_CATEGORY: Record<MediaCategory, number> = {
  [MediaCategory.Image]: MAX_IMAGE_SIZE,
  [MediaCategory.Video]: MAX_VIDEO_SIZE,
  [MediaCategory.Audio]: MAX_AUDIO_SIZE,
}

// ─── Upload Limits ──────────────────────────────────────────────────────────────

export const MAX_FILES_PER_UPLOAD = 10

// ─── Per-Type Attributes ────────────────────────────────────────────────────────

export interface ImageAttributes {
  name: string
  alt: string
  width: number | null
  height: number | null
  mimeType: ImageMimeType
  fileSize: number
}

export interface VideoAttributes {
  name: string
  alt: string
  width: number | null
  height: number | null
  duration: number | null
  mimeType: VideoMimeType
  fileSize: number
  thumbnailUrl: string | null
}

export interface AudioAttributes {
  name: string
  alt: string
  duration: number | null
  mimeType: AudioMimeType
  fileSize: number
}

export type MediaAttributes = ImageAttributes | VideoAttributes | AudioAttributes

// ─── Utility helpers ────────────────────────────────────────────────────────────

export function getCategoryForMime(mimeType: string): MediaCategory | null {
  if ((IMAGE_FORMATS as readonly string[]).includes(mimeType)) return MediaCategory.Image
  if ((VIDEO_FORMATS as readonly string[]).includes(mimeType)) return MediaCategory.Video
  if ((AUDIO_FORMATS as readonly string[]).includes(mimeType)) return MediaCategory.Audio
  return null
}

export function getMaxSizeForMime(mimeType: string): number {
  const category = getCategoryForMime(mimeType)
  if (!category) return MAX_IMAGE_SIZE
  return MAX_SIZE_BY_CATEGORY[category]
}
