import sharp from 'sharp'
import { logger } from '../logging/index.js'

const MAX_VISION_DIMENSION = 1568

/**
 * Resize an image buffer so its longest edge is ≤1568px.
 * Images already within the limit are returned unchanged (same Buffer reference).
 * On any error, the original buffer is returned (fail open).
 *
 * Based on Anthropic vision docs: images larger than 1568px are automatically
 * downsampled before inference, adding latency with no quality benefit.
 *
 * @returns { buffer, mimeType } — mimeType is 'image/jpeg' for resized output,
 *   or the original mimeType when no resize was needed.
 */
export async function resizeForVision(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const image = sharp(buffer)
    const metadata = await image.metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0

    if (width <= MAX_VISION_DIMENSION && height <= MAX_VISION_DIMENSION) {
      return { buffer, mimeType }
    }

    const resized = await image
      .resize({
        width: MAX_VISION_DIMENSION,
        height: MAX_VISION_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 85 })
      .toBuffer()

    logger.info('image-resize.vision.resized', {
      originalWidth: width,
      originalHeight: height,
      mimeType
    })

    return { buffer: resized, mimeType: 'image/jpeg' }
  } catch (error) {
    logger.warn('image-resize.vision.error', {
      mimeType,
      error: error instanceof Error ? error.message : String(error)
    })
    return { buffer, mimeType }
  }
}
