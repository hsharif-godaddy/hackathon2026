/**
 * Image content builder for vision API
 * Converts processed files into content blocks for AI models with vision capabilities
 */

import type { ProcessedFile } from '../core/types.js'

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export interface ImageContentBlock {
  type: 'image'
  image: string
  mediaType: ImageMediaType
}

export interface TextContentBlock {
  type: 'text'
  text: string
}

export type ContentBlock = TextContentBlock | ImageContentBlock

/**
 * Convert MIME type to vision API media type
 */
function toImageMediaType(mimeType: string): ImageMediaType | null {
  switch (mimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'image/jpeg'
    case 'image/png':
      return 'image/png'
    case 'image/gif':
      return 'image/gif'
    case 'image/webp':
      return 'image/webp'
    default:
      return null
  }
}

/**
 * Check if a processed file is an image that can be sent to vision API
 */
export function isVisionCompatibleImage(file: ProcessedFile): boolean {
  const mediaType = toImageMediaType(file.metadata.mimeType)
  return mediaType !== null && !!file.base64Content
}

/**
 * Build an image content block from a processed file
 */
export function buildImageContentBlock(file: ProcessedFile): ImageContentBlock | null {
  const mediaType = toImageMediaType(file.metadata.mimeType)
  
  if (!mediaType || !file.base64Content) {
    return null
  }

  return {
    type: 'image',
    image: `data:${mediaType};base64,${file.base64Content}`,
    mediaType
  }
}

/**
 * Build content blocks from multiple files
 * Returns an array of content blocks suitable for vision API
 */
export function buildMultiModalContent(
  textPrompt: string,
  files: ProcessedFile[]
): ContentBlock[] {
  const contentBlocks: ContentBlock[] = []

  // Add text content first
  if (textPrompt && textPrompt.trim()) {
    contentBlocks.push({
      type: 'text',
      text: textPrompt
    })
  }

  // Add image content blocks
  for (const file of files) {
    const imageBlock = buildImageContentBlock(file)
    if (imageBlock) {
      contentBlocks.push(imageBlock)
    }
  }

  return contentBlocks
}

/**
 * Build a user message with multi-modal content
 */
export function buildVisionMessage(
  textPrompt: string,
  files: ProcessedFile[]
): { role: 'user'; content: ContentBlock[] | string } {
  const visionCompatibleFiles = files.filter(isVisionCompatibleImage)

  if (visionCompatibleFiles.length === 0) {
    return {
      role: 'user',
      content: textPrompt
    }
  }

  return {
    role: 'user',
    content: buildMultiModalContent(textPrompt, visionCompatibleFiles)
  }
}

/**
 * Build a file summary text for non-vision files
 */
export function buildFileSummaryText(files: ProcessedFile[]): string {
  const summaries: string[] = []

  for (const file of files) {
    const filename = file.metadata.filename || 'unnamed file'
    const mimeType = file.metadata.mimeType
    const size = formatFileSize(file.metadata.size)

    summaries.push(`File: ${filename} (${mimeType}, ${size})`)

    if (file.textContent) {
      summaries.push(`Content:\n${file.textContent}`)
    }

    if (file.structuredData) {
      summaries.push(`Structured Data:\n${JSON.stringify(file.structuredData, null, 2)}`)
    }
  }

  return summaries.join('\n\n---\n\n')
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Build content combining vision-compatible images and text content from other files
 */
export function buildHybridContent(
  textPrompt: string,
  files: ProcessedFile[]
): { role: 'user'; content: ContentBlock[] | string } {
  const visionFiles = files.filter(isVisionCompatibleImage)
  const textFiles = files.filter(f => !isVisionCompatibleImage(f) && f.textContent)

  if (visionFiles.length === 0 && textFiles.length === 0) {
    return {
      role: 'user',
      content: textPrompt
    }
  }

  let enhancedPrompt = textPrompt

  if (textFiles.length > 0) {
    const fileSummary = buildFileSummaryText(textFiles)
    enhancedPrompt = `${textPrompt}\n\n${fileSummary}`
  }

  if (visionFiles.length === 0) {
    return {
      role: 'user',
      content: enhancedPrompt
    }
  }

  return {
    role: 'user',
    content: buildMultiModalContent(enhancedPrompt, visionFiles)
  }
}
