/**
 * File Type Detection Utilities
 *
 * Shared constants and utilities for detecting file types by extension.
 * Used across the application for determining how to preview/handle different file types.
 */

/**
 * Image file extensions
 */
export const IMAGE_EXTENSIONS = ['png', 'jpe?g', 'gif', 'svg', 'webp', 'bmp', 'ico'] as const

/**
 * Video file extensions
 */
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov'] as const

/**
 * Other binary file extensions (not image/video)
 */
export const OTHER_BINARY_EXTENSIONS = ['pdf'] as const

/**
 * All binary file extensions combined
 */
export const ALL_BINARY_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...OTHER_BINARY_EXTENSIONS
] as const

/**
 * Pre-compiled regex for detecting image files
 */
export const IMAGE_FILE_REGEX = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i')

/**
 * Pre-compiled regex for detecting video files
 */
export const VIDEO_FILE_REGEX = new RegExp(`\\.(${VIDEO_EXTENSIONS.join('|')})$`, 'i')

/**
 * Pre-compiled regex for detecting all binary files
 */
export const BINARY_FILE_REGEX = new RegExp(
  `\\.(${ALL_BINARY_EXTENSIONS.join('|')})$`,
  'i'
)

/**
 * Check if a file path is an image file
 * @param filePath - File path or name to check
 * @returns True if the file is an image
 */
export function isImageFile(filePath: string): boolean {
  return IMAGE_FILE_REGEX.test(filePath)
}

/**
 * Check if a file path is a video file
 * @param filePath - File path or name to check
 * @returns True if the file is a video
 */
export function isVideoFile(filePath: string): boolean {
  return VIDEO_FILE_REGEX.test(filePath)
}

/**
 * Check if a file path is a binary file (image, video, or other binary format)
 * @param filePath - File path or name to check
 * @returns True if the file is binary
 */
export function isBinaryFile(filePath: string): boolean {
  return BINARY_FILE_REGEX.test(filePath)
}

/**
 * Get the file extension from a path
 * @param filePath - File path or name
 * @returns The extension (without dot) or empty string if no extension
 */
export function getFileExtension(filePath: string): string {
  const match = filePath.match(/\.([^.]+)$/i)
  return match ? match[1].toLowerCase() : ''
}

/**
 * Accepted file types for file upload inputs
 * Used in the HTML accept attribute to filter file picker
 *
 * Includes:
 * - Images: image/* (all image types)
 * - Videos: video/* (all video types)
 * - Documents: .pdf, .txt, .md, .csv
 * - Data: .json, .xml, .yaml, .yml
 * - Fonts: .ttf, .otf, .woff, .woff2
 * - Audio: audio/* (all audio types), .mp3, .wav, .m4a
 * - Code: .js, .ts, .jsx, .tsx, .css, .html
 */
export const ACCEPTED_UPLOAD_FILE_TYPES =
  'image/*,video/*,audio/*,.pdf,.json,.xml,.yaml,.yml,.txt,.md,.csv,.ttf,.otf,.woff,.woff2,.mp3,.wav,.m4a,.js,.ts,.jsx,.tsx,.css,.html'
