import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

import { resizeForVision } from '../../utils/image-resize.js'
import { parseScreenshotDataUrl } from '../screenshot-data-url.js'

/** Creates an in-memory PNG image of given dimensions */
async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } }
  })
    .png()
    .toBuffer()
}

/** Wraps a buffer as a data:image/png;base64 URI (matching scraper output) */
function toDataUri(buffer: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

describe('site-analyzer screenshot resize integration', () => {
  describe('resize path (parseScreenshotDataUrl → resizeForVision)', () => {
    it('resizes an oversized PNG screenshot to ≤1568px and converts to JPEG', async () => {
      const largePng = await makePng(1920, 10000)
      const dataUri = toDataUri(largePng)

      const parsed = parseScreenshotDataUrl(dataUri)
      expect(parsed).not.toBeNull()

      const { buffer: resized, mimeType } = await resizeForVision(parsed!.buffer, parsed!.mimeType)

      const meta = await sharp(resized).metadata()
      expect(meta.width).toBeLessThanOrEqual(1568)
      expect(meta.height).toBeLessThanOrEqual(1568)
      expect(mimeType).toBe('image/jpeg')
    })

    it('resizes a very wide screenshot (>8000px) to safe dimensions', async () => {
      const widePng = await makePng(9000, 2000)
      const dataUri = toDataUri(widePng)

      const parsed = parseScreenshotDataUrl(dataUri)
      expect(parsed).not.toBeNull()

      const { buffer: resized, mimeType } = await resizeForVision(parsed!.buffer, parsed!.mimeType)

      const meta = await sharp(resized).metadata()
      expect(meta.width).toBeLessThanOrEqual(1568)
      expect(meta.height).toBeLessThanOrEqual(1568)
      expect(mimeType).toBe('image/jpeg')
    })

    it('does not resize a screenshot already within limits', async () => {
      const smallPng = await makePng(1024, 768)
      const dataUri = toDataUri(smallPng)

      const parsed = parseScreenshotDataUrl(dataUri)
      expect(parsed).not.toBeNull()

      const { buffer: resized, mimeType } = await resizeForVision(parsed!.buffer, parsed!.mimeType)

      expect(resized).toBe(parsed!.buffer)
      expect(mimeType).toBe('image/png')
    })

    it('reduces file size significantly for large PNG screenshots', async () => {
      const largePng = await makePng(1920, 8000)
      const dataUri = toDataUri(largePng)

      const parsed = parseScreenshotDataUrl(dataUri)
      expect(parsed).not.toBeNull()

      const originalSize = parsed!.buffer.length
      const { buffer: resized } = await resizeForVision(parsed!.buffer, parsed!.mimeType)

      expect(resized.length).toBeLessThan(originalSize)
      // Base64 encoding expands by ~33%, so the encoded size for Bedrock is:
      const base64Size = resized.length * 1.37
      expect(base64Size).toBeLessThan(3.75 * 1024 * 1024)
    })

    it('preserves aspect ratio for tall page screenshots', async () => {
      const tallPng = await makePng(1440, 5000)
      const dataUri = toDataUri(tallPng)

      const parsed = parseScreenshotDataUrl(dataUri)
      expect(parsed).not.toBeNull()

      const { buffer: resized } = await resizeForVision(parsed!.buffer, parsed!.mimeType)
      const meta = await sharp(resized).metadata()

      // Original ratio: 1440/5000 = 0.288
      // After resize with height=1568: width should be ~451
      const ratio = meta.width! / meta.height!
      const originalRatio = 1440 / 5000
      expect(ratio).toBeCloseTo(originalRatio, 1)
    })

    it('handles the exact boundary (1568px) without resizing', async () => {
      const boundaryPng = await makePng(1568, 1568)
      const dataUri = toDataUri(boundaryPng)

      const parsed = parseScreenshotDataUrl(dataUri)
      expect(parsed).not.toBeNull()

      const { buffer: resized, mimeType } = await resizeForVision(parsed!.buffer, parsed!.mimeType)

      expect(resized).toBe(parsed!.buffer)
      expect(mimeType).toBe('image/png')
    })

    it('resizes when only one dimension exceeds 1568px', async () => {
      const tallNarrow = await makePng(400, 3000)
      const dataUri = toDataUri(tallNarrow)

      const parsed = parseScreenshotDataUrl(dataUri)
      expect(parsed).not.toBeNull()

      const { buffer: resized, mimeType } = await resizeForVision(parsed!.buffer, parsed!.mimeType)

      const meta = await sharp(resized).metadata()
      expect(meta.height).toBeLessThanOrEqual(1568)
      expect(meta.width).toBeLessThanOrEqual(1568)
      expect(mimeType).toBe('image/jpeg')
    })
  })
})
