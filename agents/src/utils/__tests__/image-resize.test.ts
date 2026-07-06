import { describe, it, expect, vi, afterEach } from 'vitest'
import sharp from 'sharp'
import {
  anthropicBase64EncodedSize,
  ANTHROPIC_MAX_BASE64_BYTES,
  ANTHROPIC_MAX_IMAGE_BYTES,
  compressForAnthropicLimit,
  encodeVisionJpeg,
  exceedsAnthropicVisionPayload,
  resizeForVision,
} from '../image-resize.js'
import { logger } from '../../logging/index.js'

/** Creates a minimal in-memory image of given dimensions */
async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } }
  })
    .jpeg({ quality: 80 })
    .toBuffer()
}

describe('anthropicBase64EncodedSize', () => {
  it('matches ceil(raw / 3) * 4 base64 expansion', () => {
    expect(anthropicBase64EncodedSize(3)).toBe(4)
    expect(anthropicBase64EncodedSize(4)).toBe(8)
    expect(anthropicBase64EncodedSize(6291456)).toBe(8388608)
  })

  it('flags raw sizes that fit the old threshold but exceed base64 payload limit', () => {
    const rawBytes: number = 4_500_000
    expect(rawBytes).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(rawBytes).toBeGreaterThan(ANTHROPIC_MAX_IMAGE_BYTES)
    expect(exceedsAnthropicVisionPayload(rawBytes)).toBe(true)
  })
})

describe('compressForAnthropicLimit', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reduces byte-heavy in-dimension images to fit the base64 payload limit', async () => {
    const input: Buffer = await makeImage(1400, 1400)
    let encodeCalls: number = 0
    const mockEncode = vi.fn(async (buffer: Buffer, dimension: number, quality: number) => {
      encodeCalls++
      const encoded: Buffer = await encodeVisionJpeg(buffer, dimension, quality)
      if (encodeCalls <= 2) {
        return Buffer.alloc(4_500_000)
      }
      return encoded
    })

    const result: Buffer = await compressForAnthropicLimit(input, 1568, mockEncode)
    expect(exceedsAnthropicVisionPayload(result.length)).toBe(false)
    expect(encodeCalls).toBeGreaterThan(2)
  })

  it('never encodes below the JPEG quality floor of 40', async () => {
    const qualities: number[] = []
    const input: Buffer = await makeImage(1200, 1200)
    const mockEncode = vi.fn(async (buffer: Buffer, dimension: number, quality: number) => {
      qualities.push(quality)
      if (quality > 40) {
        return Buffer.alloc(4_500_000)
      }
      return encodeVisionJpeg(buffer, dimension, quality)
    })

    await compressForAnthropicLimit(input, 1568, mockEncode)

    expect(qualities.length).toBeGreaterThan(0)
    expect(Math.min(...qualities)).toBeGreaterThanOrEqual(40)
  })

  it('logs still_oversized when compression exhausts quality and dimension floors', async () => {
    const oversized: Buffer = Buffer.alloc(4_500_000)
    const mockEncode = vi.fn().mockResolvedValue(oversized)
    const warnSpy = vi.spyOn(logger, 'warn')

    const input: Buffer = await makeImage(1200, 1200)
    const result: Buffer = await compressForAnthropicLimit(input, 1568, mockEncode)

    expect(result).toBe(oversized)
    expect(warnSpy).toHaveBeenCalledWith(
      'image-resize.vision.still_oversized',
      expect.objectContaining({ rawBytes: oversized.length })
    )
  })
})

describe('resizeForVision', () => {
  it('returns original buffer and mimeType when image is within 1568px', async () => {
    const buf: Buffer = await makeImage(800, 600)
    const { buffer, mimeType } = await resizeForVision(buf, 'image/jpeg')
    expect(buffer).toBe(buf) // same reference — not resized
    expect(mimeType).toBe('image/jpeg')
  })

  it('resizes a wide image so long edge is ≤1568px', async () => {
    const buf: Buffer = await makeImage(3000, 1000)
    const { buffer, mimeType } = await resizeForVision(buf, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    expect(meta.width).toBeLessThanOrEqual(1568)
    expect(meta.height).toBeLessThanOrEqual(1568)
    expect(mimeType).toBe('image/jpeg')
    expect(exceedsAnthropicVisionPayload(buffer.length)).toBe(false)
  })

  it('resizes a tall image so long edge is ≤1568px', async () => {
    const buf: Buffer = await makeImage(500, 4000)
    const { buffer, mimeType } = await resizeForVision(buf, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    expect(meta.width).toBeLessThanOrEqual(1568)
    expect(meta.height).toBeLessThanOrEqual(1568)
    expect(mimeType).toBe('image/jpeg')
    expect(exceedsAnthropicVisionPayload(buffer.length)).toBe(false)
  })

  it('preserves aspect ratio when resizing', async () => {
    const buf: Buffer = await makeImage(3136, 1568) // 2:1 ratio, needs resize
    const { buffer } = await resizeForVision(buf, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    // After resize: long edge = 1568, short edge = 784 (2:1 ratio preserved)
    expect(meta.width).toBe(1568)
    expect(meta.height).toBe(784)
  })

  it('returns original buffer on sharp error (fail open)', async () => {
    const garbage: Buffer = Buffer.from('not an image')
    const { buffer, mimeType } = await resizeForVision(garbage, 'image/jpeg')
    expect(buffer).toBe(garbage)
    expect(mimeType).toBe('image/jpeg')
  })

  it('compresses large noisy images so base64 payload fits Anthropic limit', async () => {
    const buf: Buffer = await sharp({
      create: {
        width: 3000,
        height: 3000,
        channels: 3,
        noise: { type: 'gaussian', mean: 128, sigma: 64 }
      }
    })
      .jpeg({ quality: 100 })
      .toBuffer()

    expect(exceedsAnthropicVisionPayload(buf.length)).toBe(true)

    const { buffer, mimeType } = await resizeForVision(buf, 'image/jpeg')
    expect(anthropicBase64EncodedSize(buffer.length)).toBeLessThanOrEqual(ANTHROPIC_MAX_BASE64_BYTES)
    expect(mimeType).toBe('image/jpeg')
  })
})
