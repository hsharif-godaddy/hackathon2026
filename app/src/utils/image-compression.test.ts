import { describe, expect, it } from 'vitest'

import { compressImageFile, compressImageFiles } from '@/utils/image-compression'

function makeFile(name: string, type: string, size = 300 * 1024): File {
  return new File([new ArrayBuffer(size)], name, { type })
}

describe('image-compression', () => {
  describe('#compressImageFile', () => {
    it('should return any file unchanged (server handles compression)', async () => {
      const file = makeFile('photo.jpg', 'image/jpeg')
      expect(await compressImageFile(file)).toBe(file)
    })

    it('should return large files unchanged', async () => {
      const file = makeFile('big.jpg', 'image/jpeg', 20 * 1024 * 1024)
      expect(await compressImageFile(file)).toBe(file)
    })

    it('should return non-image files unchanged', async () => {
      const file = makeFile('doc.pdf', 'application/pdf')
      expect(await compressImageFile(file)).toBe(file)
    })

    it('should return SVG files unchanged', async () => {
      const file = makeFile('icon.svg', 'image/svg+xml')
      expect(await compressImageFile(file)).toBe(file)
    })

    it('should return GIF files unchanged', async () => {
      const file = makeFile('anim.gif', 'image/gif')
      expect(await compressImageFile(file)).toBe(file)
    })

    it('should return PNG files unchanged', async () => {
      const file = makeFile('image.png', 'image/png')
      expect(await compressImageFile(file)).toBe(file)
    })
  })

  describe('#compressImageFiles', () => {
    it('should return all files unchanged', async () => {
      const files = [
        makeFile('a.jpg', 'image/jpeg'),
        makeFile('b.png', 'image/png'),
      ]
      const results = await compressImageFiles(files)
      expect(results).toHaveLength(2)
      expect(results[0]).toBe(files[0])
      expect(results[1]).toBe(files[1])
    })

    it('should return empty array for empty input', async () => {
      const results = await compressImageFiles([])
      expect(results).toHaveLength(0)
    })
  })
})
