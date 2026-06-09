import { describe, expect, it } from 'vitest'

import { getExtension, isImageFileName, MIME_MAP } from './utils'

describe('utils', () => {
  describe('MIME_MAP', () => {
    it('contains entries for all supported image extensions', () => {
      expect(MIME_MAP['.png']).toBe('image/png')
      expect(MIME_MAP['.jpg']).toBe('image/jpeg')
      expect(MIME_MAP['.jpeg']).toBe('image/jpeg')
      expect(MIME_MAP['.gif']).toBe('image/gif')
      expect(MIME_MAP['.svg']).toBe('image/svg+xml')
      expect(MIME_MAP['.webp']).toBe('image/webp')
    })
  })

  describe('getExtension', () => {
    it('returns the extension including the dot', () => {
      expect(getExtension('photo.PNG')).toBe('.png')
    })

    it('returns the full name for dotless filenames', () => {
      expect(getExtension('noextension')).toBe('noextension')
    })
  })

  describe('isImageFileName', () => {
    it.each(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'])(
      'returns true for %s extension',
      (ext) => {
        expect(isImageFileName(`photo${ext}`)).toBe(true)
      },
    )

    it.each(['.md', '.txt', '.zip', '.html', '.xml'])(
      'returns false for %s extension',
      (ext) => {
        expect(isImageFileName(`file${ext}`)).toBe(false)
      },
    )

    it('is case-insensitive', () => {
      expect(isImageFileName('photo.PNG')).toBe(true)
      expect(isImageFileName('photo.JPG')).toBe(true)
    })

    it('returns false for a file with no extension', () => {
      expect(isImageFileName('noextension')).toBe(false)
    })
  })
})
