import { describe, it, expect, beforeEach } from 'vitest'

import { clearExtensionResolved, pickAndMarkExtensionResolved } from '../upload-resolution-tracking.js'
import type { UploadedFile } from '../../services/FileUploadService.js'

let fileCounter = 0
function makeFile(originalName: string, uploadedAt = '2024-01-01T00:00:00.000Z'): UploadedFile {
  const uniqueId = `file_${++fileCounter}`
  return {
    id: uniqueId,
    originalName,
    filename: `app_${Date.now()}_${uniqueId}${originalName.substring(originalName.lastIndexOf('.'))}`,
    size: 100,
    mimeType: 'image/png',
    uploadedAt,
  }
}

const noopComparator = (_a: UploadedFile, _b: UploadedFile) => 0

describe('upload-resolution-tracking', function trackingTests() {
  const appId = 'test-app'

  beforeEach(function reset() {
    clearExtensionResolved(appId)
    clearExtensionResolved('other-app')
  })

  describe('#pickAndMarkExtensionResolved', function pickTests() {
    it('should return null for empty candidates', function emptyList() {
      expect(pickAndMarkExtensionResolved(appId, [], noopComparator)).toBeNull()
    })

    it('should return the single candidate', function singleCandidate() {
      const file = makeFile('hero.jpg')
      const result = pickAndMarkExtensionResolved(appId, [file], noopComparator)
      expect(result?.originalName).toBe('hero.jpg')
    })

    it('should use compareFn to pick the best candidate', function usesCompareFn() {
      const a = makeFile('a.jpg', '2024-01-01T00:00:00.000Z')
      const b = makeFile('b.jpg', '2024-01-02T00:00:00.000Z')
      // compareFn: descending by date so most-recent (b) sorts first
      const result = pickAndMarkExtensionResolved(appId, [a, b], (x, y) => {
        return new Date(y.uploadedAt) > new Date(x.uploadedAt) ? 1 : -1
      })
      expect(result?.originalName).toBe('b.jpg')
    })

    it('should mark the picked file as consumed', function marksConsumed() {
      const file = makeFile('icon.png')
      pickAndMarkExtensionResolved(appId, [file], noopComparator)
      // Second call with same single candidate should still return it (fallback)
      // but with two candidates the consumed one should be skipped
      const other = makeFile('logo.png')
      const result = pickAndMarkExtensionResolved(appId, [file, other], noopComparator)
      expect(result?.originalName).toBe('logo.png')
    })

    it('should skip consumed candidates on subsequent calls', function skipsConsumed() {
      const first = makeFile('slide1.jpg')
      const second = makeFile('slide2.jpg')
      const third = makeFile('slide3.jpg')

      const pick1 = pickAndMarkExtensionResolved(appId, [first, second, third], noopComparator)
      const pick2 = pickAndMarkExtensionResolved(appId, [first, second, third], noopComparator)
      const pick3 = pickAndMarkExtensionResolved(appId, [first, second, third], noopComparator)

      const names = [pick1?.originalName, pick2?.originalName, pick3?.originalName]
      expect(new Set(names).size).toBe(3)
      expect(names).toContain('slide1.jpg')
      expect(names).toContain('slide2.jpg')
      expect(names).toContain('slide3.jpg')
    })

    it('should fall back to full pool when all candidates are consumed', function fallback() {
      const file = makeFile('only.jpg')
      pickAndMarkExtensionResolved(appId, [file], noopComparator)
      // All consumed; should still return something rather than null
      const result = pickAndMarkExtensionResolved(appId, [file], noopComparator)
      expect(result?.originalName).toBe('only.jpg')
    })

    it('should handle duplicate originalNames by tracking unique filename', function duplicateOriginalName() {
      // Simulates user uploading "folder1/hero.jpg" and "folder2/hero.jpg" in one batch
      const fileA = makeFile('hero.jpg')
      const fileB = makeFile('hero.jpg')
      // Both have originalName "hero.jpg" but different filename values

      const pick1 = pickAndMarkExtensionResolved(appId, [fileA, fileB], noopComparator)
      const pick2 = pickAndMarkExtensionResolved(appId, [fileA, fileB], noopComparator)

      // Should pick different files despite same originalName
      expect(pick1?.filename).not.toBe(pick2?.filename)
    })

    it('should isolate tracking per appId', function isolatedPerApp() {
      const file = makeFile('shared.jpg')
      const other = makeFile('alt.jpg')

      // Mark file as consumed for appId
      pickAndMarkExtensionResolved(appId, [file, other], noopComparator)

      // 'other-app' starts fresh — file should be available
      const resultOtherApp = pickAndMarkExtensionResolved('other-app', [file], noopComparator)
      expect(resultOtherApp?.originalName).toBe('shared.jpg')
    })
  })

  describe('#clearExtensionResolved', function clearTests() {
    it('should reset consumed state for an appId', function resetsState() {
      const file = makeFile('banner.jpg')
      const alt = makeFile('alt.jpg')

      // Consume file
      pickAndMarkExtensionResolved(appId, [file, alt], noopComparator)
      pickAndMarkExtensionResolved(appId, [file, alt], noopComparator)

      // Clear and verify both are available again
      clearExtensionResolved(appId)

      const pick1 = pickAndMarkExtensionResolved(appId, [file, alt], noopComparator)
      const pick2 = pickAndMarkExtensionResolved(appId, [file, alt], noopComparator)
      const names = new Set([pick1?.originalName, pick2?.originalName])
      expect(names.size).toBe(2)
    })

    it('should not affect other appIds', function doesNotAffectOthers() {
      const file = makeFile('photo.jpg')
      const alt = makeFile('other.jpg')

      // Consume file for 'other-app'
      pickAndMarkExtensionResolved('other-app', [file, alt], noopComparator)

      // Clear only appId
      clearExtensionResolved(appId)

      // 'other-app' state is untouched — 'other.jpg' should be next unconsumed
      const result = pickAndMarkExtensionResolved('other-app', [file, alt], noopComparator)
      expect(result?.originalName).toBe('other.jpg')
    })

    it('should be idempotent when called on unknown appId', function idempotent() {
      expect(() => clearExtensionResolved('nonexistent-app')).not.toThrow()
    })
  })

  describe('concurrent resolution simulation', function concurrentTests() {
    it('should assign distinct files when two calls run with overlapping candidates', function distinct() {
      const img1 = makeFile('image1.jpg', '2024-01-01T00:00:00.000Z')
      const img2 = makeFile('image2.jpg', '2024-01-02T00:00:00.000Z')

      // Simulate two concurrent file_edit calls resolving by extension
      // (synchronous, so no actual concurrency, but tests the atomic pick-and-mark)
      const byRecency = (a: UploadedFile, b: UploadedFile) =>
        new Date(a.uploadedAt) < new Date(b.uploadedAt) ? -1 : 1

      const resolved1 = pickAndMarkExtensionResolved(appId, [img1, img2], byRecency)
      const resolved2 = pickAndMarkExtensionResolved(appId, [img1, img2], byRecency)

      expect(resolved1?.originalName).not.toBe(resolved2?.originalName)
      expect(new Set([resolved1?.originalName, resolved2?.originalName]).size).toBe(2)
    })
  })
})
