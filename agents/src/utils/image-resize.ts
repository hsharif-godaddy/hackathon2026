import sharp from 'sharp'
import { logger } from '../logging/index.js'

const MAX_VISION_DIMENSION = 1568
const MIN_JPEG_QUALITY = 40
const MIN_COMPRESS_DIMENSION = 512

/** Anthropic vision API rejects base64-encoded image payloads above 5 MB. */
export const ANTHROPIC_MAX_BASE64_BYTES = 5 * 1024 * 1024

/** Conservative raw-byte ceiling before base64 encoding (~4/3 expansion). */
export const ANTHROPIC_MAX_IMAGE_BYTES = Math.floor(ANTHROPIC_MAX_BASE64_BYTES * 3 / 4)

export function anthropicBase64EncodedSize(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4
}

export function exceedsAnthropicVisionPayload(rawBytes: number): boolean {
  return anthropicBase64EncodedSize(rawBytes) > ANTHROPIC_MAX_BASE64_BYTES
}

export async function encodeVisionJpeg(buffer: Buffer, dimension: number, quality: number): Promise<Buffer> {
  return sharp(buffer)
    .resize({
      width: dimension,
      height: dimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer()
}

type VisionJpegEncoder = (buffer: Buffer, dimension: number, quality: number) => Promise<Buffer>

export async function compressForAnthropicLimit(
  buffer: Buffer,
  maxDimension: number,
  encode: VisionJpegEncoder = encodeVisionJpeg,
): Promise<Buffer> {
  let quality: number = 85
  let dimension: number = maxDimension
  let compressed: Buffer = await encode(buffer, dimension, quality)

  while (
    exceedsAnthropicVisionPayload(compressed.length)
    && (quality > MIN_JPEG_QUALITY || dimension > MIN_COMPRESS_DIMENSION)
  ) {
    if (quality > MIN_JPEG_QUALITY) {
      quality = Math.max(MIN_JPEG_QUALITY, quality - 15)
    } else {
      dimension = Math.max(MIN_COMPRESS_DIMENSION, Math.floor(dimension * 0.75))
    }
    compressed = await encode(buffer, dimension, quality)
  }

  if (exceedsAnthropicVisionPayload(compressed.length)) {
    logger.warn('image-resize.vision.still_oversized', {
      rawBytes: compressed.length,
      base64Bytes: anthropicBase64EncodedSize(compressed.length),
      maxBase64Bytes: ANTHROPIC_MAX_BASE64_BYTES,
      dimension,
      quality,
    })
  }

  return compressed
}

/**
 * Prepare an image buffer for Anthropic vision APIs.
 *
 * Applies two independent limits:
 * - Dimension: long edge ≤1568px (Anthropic auto-downsamples above this with no quality gain)
 * - Payload size: raw bytes must stay within Anthropic's 5 MiB base64-encoded ceiling
 *
 * Returns the original buffer unchanged (same reference) only when both limits are satisfied.
 * Otherwise re-encodes as JPEG with progressive quality/dimension reduction.
 * On sharp errors, returns the original buffer (fail open) and logs when it still exceeds
 * the payload limit.
 *
 * @returns { buffer, mimeType } — mimeType is `image/jpeg` after re-encoding, or the
 *   original mimeType when no changes were needed.
 */
export async function resizeForVision(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const image = sharp(buffer)
    const metadata = await image.metadata()
    const width: number = metadata.width ?? 0
    const height: number = metadata.height ?? 0
    const exceedsDimensionLimit: boolean = width > MAX_VISION_DIMENSION || height > MAX_VISION_DIMENSION
    const exceedsByteLimit: boolean = exceedsAnthropicVisionPayload(buffer.length)

    if (!exceedsDimensionLimit && !exceedsByteLimit) {
      return { buffer, mimeType }
    }

    const resized: Buffer = await compressForAnthropicLimit(
      buffer,
      exceedsDimensionLimit ? MAX_VISION_DIMENSION : Math.max(width, height)
    )

    logger.info('image-resize.vision.resized', {
      originalWidth: width,
      originalHeight: height,
      originalBytes: buffer.length,
      outputBytes: resized.length,
      base64Bytes: anthropicBase64EncodedSize(resized.length),
      mimeType,
    })

    return { buffer: resized, mimeType: 'image/jpeg' }
  } catch (error) {
    logger.warn('image-resize.vision.error', {
      mimeType,
      error: error instanceof Error ? error.message : String(error),
    })
    if (exceedsAnthropicVisionPayload(buffer.length)) {
      logger.warn('image-resize.vision.fail_open_oversized', {
        rawBytes: buffer.length,
        base64Bytes: anthropicBase64EncodedSize(buffer.length),
      })
    }
    return { buffer, mimeType }
  }
}
