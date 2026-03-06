import { beforeEach, describe, expect, it, vi } from 'vitest'

import { compressImageFile, compressImageFiles } from '@/utils/image-compression'

const mockCompress = vi.fn()

vi.mock('browser-image-compression', () => ({
  default: (...args: Parameters<typeof mockCompress>) => mockCompress(...args),
}))

// Large enough to exceed the 200KB minimum compression threshold
const LARGE_SIZE = 300 * 1024

function makeFile(name: string, type: string, size = LARGE_SIZE): File {
  return new File([new ArrayBuffer(size)], name, { type })
}

describe('image-compression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('#compressImageFile', () => {
    it('should return non-image files unchanged', async function passthrough() {
      const file = makeFile('doc.pdf', 'application/pdf')
      expect(await compressImageFile(file)).toBe(file)
      expect(mockCompress).not.toHaveBeenCalled()
    })

    it('should return SVG files unchanged', async function passSvg() {
      const file = makeFile('icon.svg', 'image/svg+xml')
      expect(await compressImageFile(file)).toBe(file)
      expect(mockCompress).not.toHaveBeenCalled()
    })

    it('should return GIF files unchanged', async function passGif() {
      const file = makeFile('anim.gif', 'image/gif')
      expect(await compressImageFile(file)).toBe(file)
      expect(mockCompress).not.toHaveBeenCalled()
    })

    it('should return files under 200KB unchanged', async function passSmall() {
      const file = makeFile('tiny.jpg', 'image/jpeg', 100 * 1024)
      expect(await compressImageFile(file)).toBe(file)
      expect(mockCompress).not.toHaveBeenCalled()
    })

    it('should compress large JPEG files', async function compressJpeg() {
      const file = makeFile('photo.jpg', 'image/jpeg')
      mockCompress.mockResolvedValueOnce(new Blob(['compressed'], { type: 'image/jpeg' }))
      await compressImageFile(file)
      expect(mockCompress).toHaveBeenCalledOnce()
    })

    it('should compress large PNG files', async function compressPng() {
      const file = makeFile('image.png', 'image/png')
      mockCompress.mockResolvedValueOnce(new Blob(['compressed'], { type: 'image/png' }))
      await compressImageFile(file)
      expect(mockCompress).toHaveBeenCalledOnce()
    })

    it('should preserve original filename after compression', async function preserveName() {
      const file = makeFile('my-photo.jpg', 'image/jpeg')
      mockCompress.mockResolvedValueOnce(new Blob(['compressed'], { type: 'image/jpeg' }))
      const result = await compressImageFile(file)
      expect(result.name).toBe('my-photo.jpg')
    })

    it('should preserve original MIME type when compressor returns empty type', async function preserveType() {
      const file = makeFile('photo.png', 'image/png')
      // Simulates Web Worker blob transfer losing the MIME type
      mockCompress.mockResolvedValueOnce(new Blob(['compressed'], { type: '' }))
      const result = await compressImageFile(file)
      expect(result.type).toBe('image/png')
    })

    it('should return a File instance after compression', async function returnsFile() {
      const file = makeFile('photo.jpg', 'image/jpeg')
      mockCompress.mockResolvedValueOnce(new Blob(['compressed'], { type: 'image/jpeg' }))
      const result = await compressImageFile(file)
      expect(result).toBeInstanceOf(File)
    })

    it('should pass correct compression options to library', async function passesOptions() {
      const file = makeFile('photo.jpg', 'image/jpeg')
      mockCompress.mockResolvedValueOnce(new Blob(['compressed'], { type: 'image/jpeg' }))
      await compressImageFile(file)
      expect(mockCompress).toHaveBeenCalledWith(
        file,
        expect.objectContaining({
          maxSizeMB: 1,
          maxWidthOrHeight: 2048,
          useWebWorker: true,
          initialQuality: 0.85,
        })
      )
    })
  })

  describe('#compressImageFiles', () => {
    it('should compress multiple image files', async function compressMany() {
      const files = [
        makeFile('a.jpg', 'image/jpeg'),
        makeFile('b.jpg', 'image/jpeg'),
      ]
      mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }))
      const results = await compressImageFiles(files)
      expect(results).toHaveLength(2)
      expect(mockCompress).toHaveBeenCalledTimes(2)
    })

    it('should pass non-image files through unchanged', async function passthroughMixed() {
      const image = makeFile('photo.jpg', 'image/jpeg')
      const pdf = makeFile('doc.pdf', 'application/pdf')
      mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }))
      const results = await compressImageFiles([image, pdf])
      expect(results[1]).toBe(pdf)
      expect(mockCompress).toHaveBeenCalledOnce()
    })

    it('should return empty array for empty input', async function emptyInput() {
      const results = await compressImageFiles([])
      expect(results).toHaveLength(0)
      expect(mockCompress).not.toHaveBeenCalled()
    })
  })
})
