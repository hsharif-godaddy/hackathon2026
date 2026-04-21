/**
 * Asset types for chat file attachments
 * Extracted from AssetManagerModal to support both legacy asset manager and new file upload system
 */

/**
 * Media type enumeration for asset manager items
 */
export enum MediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  PDF = 'PDF',
  FILE = 'FILE',
}

/**
 * Base properties common to all asset types
 */
interface BaseAsset {
  /** The type of media */
  mediaType: MediaType
  /** The source type (e.g., 'gc', 'vimeo') */
  sourceType: string
  /** The URL to the thumbnail or preview image (protocol-relative). May be undefined for uploads without signed URLs. */
  imageUrl?: string
}

/**
 * Represents an image asset from the Asset Manager
 */
export interface ImageAsset extends BaseAsset {
  mediaType: MediaType.IMAGE
  /** The filename of the image */
  filename: string
  /** The MIME content type */
  contentType: string
  /** File size in bytes */
  size: number
  /** Image dimensions */
  dimensions: {
    width: number
    height: number
  }
  /** The URL to the thumbnail image (protocol-relative) */
  thumbnailUrl: string
  /** Alt text for accessibility */
  altText?: string
}

/**
 * Represents a video asset from the Asset Manager
 */
export interface VideoAsset extends BaseAsset {
  mediaType: MediaType.VIDEO
  /** The video URL */
  videoUrl: string
  /** Video ID */
  id: string
  /** URL hash */
  urlHash: string
  /** Video width */
  width: number
  /** Video height */
  height: number
  /** The filename of the video (for uploaded files) */
  filename?: string
  /** The MIME content type (for uploaded files) */
  contentType?: string
  /** File size in bytes (for uploaded files) */
  size?: number
  /** The URL to the thumbnail image (for uploaded files) */
  thumbnailUrl?: string
}

/**
 * Represents a PDF asset from the Asset Manager
 */
export interface PDFAsset extends BaseAsset {
  mediaType: MediaType.PDF
  /** The filename of the PDF */
  filename: string
  /** The MIME content type */
  contentType: string
  /** File size in bytes */
  size: number
  /** The URL to the thumbnail image (protocol-relative) */
  thumbnailUrl: string
}

/**
 * Represents a generic file asset (e.g., markdown, JSON, text files)
 */
export interface FileAsset extends BaseAsset {
  mediaType: MediaType.FILE
  /** The filename of the file */
  filename: string
  /** The MIME content type */
  contentType: string
  /** File size in bytes */
  size: number
  /** The URL to the thumbnail image (protocol-relative) */
  thumbnailUrl: string
}

/**
 * Union type representing any asset from the Asset Manager
 */
export type AssetManagerItem = ImageAsset | VideoAsset | PDFAsset | FileAsset
