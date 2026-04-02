import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { resizeForVision } from '../image-resize.js'

/** Creates a minimal in-memory image of given dimensions */
async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } }
  })
    .jpeg({ quality: 80 })
    .toBuffer()
}

describe('resizeForVision', () => {
  it('returns original buffer and mimeType when image is within 1568px', async () => {
    const buf = await makeImage(800, 600)
    const { buffer, mimeType } = await resizeForVision(buf, 'image/jpeg')
    expect(buffer).toBe(buf) // same reference — not resized
    expect(mimeType).toBe('image/jpeg')
  })

  it('resizes a wide image so long edge is ≤1568px', async () => {
    const buf = await makeImage(3000, 1000)
    const { buffer, mimeType } = await resizeForVision(buf, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    expect(meta.width).toBeLessThanOrEqual(1568)
    expect(meta.height).toBeLessThanOrEqual(1568)
    expect(mimeType).toBe('image/jpeg')
  })

  it('resizes a tall image so long edge is ≤1568px', async () => {
    const buf = await makeImage(500, 4000)
    const { buffer, mimeType } = await resizeForVision(buf, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    expect(meta.width).toBeLessThanOrEqual(1568)
    expect(meta.height).toBeLessThanOrEqual(1568)
    expect(mimeType).toBe('image/jpeg')
  })

  it('preserves aspect ratio when resizing', async () => {
    const buf = await makeImage(3136, 1568) // 2:1 ratio, needs resize
    const { buffer } = await resizeForVision(buf, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    // After resize: long edge = 1568, short edge = 784 (2:1 ratio preserved)
    expect(meta.width).toBe(1568)
    expect(meta.height).toBe(784)
  })

  it('returns original buffer on sharp error (fail open)', async () => {
    const garbage = Buffer.from('not an image')
    const { buffer, mimeType } = await resizeForVision(garbage, 'image/jpeg')
    expect(buffer).toBe(garbage)
    expect(mimeType).toBe('image/jpeg')
  })
})
