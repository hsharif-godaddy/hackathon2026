import { describe, it, expect, beforeEach } from 'vitest'
import {
  safeJoin,
  safeResolve,
  isSafePath,
  createSafePathBuilder,
  UnsafePathError
} from '../safe-path.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('safe-path - Path Traversal Protection', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'safe-path-test-'))
  })

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('safeJoin', () => {
    it('should allow safe relative paths', () => {
      const result = safeJoin(testDir, 'subdir', 'file.txt')
      expect(result).toContain('subdir')
      expect(result).toContain('file.txt')
      expect(result).toContain(testDir)
    })

    it('should block .. traversal attempts', () => {
      expect(() => {
        safeJoin(testDir, '..', '..', 'etc', 'passwd')
      }).toThrow(UnsafePathError)
    })

    it('should block mixed traversal attempts', () => {
      expect(() => {
        safeJoin(testDir, 'safe', '..', '..', 'unsafe')
      }).toThrow(UnsafePathError)
    })

    it('should block absolute paths by default', () => {
      expect(() => {
        safeJoin(testDir, '/etc/passwd')
      }).toThrow(UnsafePathError)
    })

    it('should block Windows absolute paths', () => {
      expect(() => {
        safeJoin(testDir, 'C:\\Windows\\System32\\config\\sam')
      }).toThrow(UnsafePathError)
    })

    it('should strip null bytes', () => {
      // Null bytes should be stripped, but the path should still be safe
      const result = safeJoin(testDir, 'file\x00.txt')
      expect(result).not.toContain('\x00')
      expect(result).toContain(testDir)
    })

    it('should strip control characters', () => {
      const result = safeJoin(testDir, 'file\x01\x02\x03.txt')
      // eslint-disable-next-line no-control-regex
      expect(result).not.toMatch(/[\x00-\x1f]/)
      expect(result).toContain(testDir)
    })

    it('should reject dangerous Windows device names', () => {
      expect(() => safeJoin(testDir, 'CON')).toThrow(UnsafePathError)
      expect(() => safeJoin(testDir, 'PRN')).toThrow(UnsafePathError)
      expect(() => safeJoin(testDir, 'AUX')).toThrow(UnsafePathError)
      expect(() => safeJoin(testDir, 'NUL')).toThrow(UnsafePathError)
      expect(() => safeJoin(testDir, 'COM1')).toThrow(UnsafePathError)
      expect(() => safeJoin(testDir, 'LPT1')).toThrow(UnsafePathError)
    })

    it('should reject dot and double-dot as components', () => {
      expect(() => safeJoin(testDir, '.')).toThrow(UnsafePathError)
      expect(() => safeJoin(testDir, '..')).toThrow(UnsafePathError)
    })

    it('should handle encoded traversal attempts', () => {
      // Encoded ".." should be sanitized
      const result = safeJoin(testDir, '%2e%2e', 'etc', 'passwd')
      // The path should be safe (dots removed/sanitized)
      expect(result).toContain(testDir)
    })

    it('should collapse multiple slashes', () => {
      const result = safeJoin(testDir, 'sub////dir///file.txt')
      expect(result).not.toMatch(/\/\/+/)
      expect(result).toContain(testDir)
    })
  })

  describe('safeResolve', () => {
    it('should resolve safe relative paths', () => {
      const result = safeResolve(testDir, 'subdir/file.txt')
      expect(result).toContain('subdir')
      expect(result).toContain('file.txt')
      expect(result).toContain(testDir)
    })

    it('should block traversal in relative paths', () => {
      expect(() => {
        safeResolve(testDir, '../../../etc/passwd')
      }).toThrow(UnsafePathError)
    })

    it('should block absolute paths by default', () => {
      expect(() => {
        safeResolve(testDir, '/etc/passwd')
      }).toThrow(UnsafePathError)
    })

    it('should allow absolute paths with option', () => {
      const result = safeResolve(testDir, '/tmp/test.txt', { allowAbsolute: true, allowTraversal: true })
      expect(result).toBe('/tmp/test.txt')
    })

    it('should validate absolute paths stay within base when not allowing traversal', () => {
      // Even with allowAbsolute, path must be within base if !allowTraversal
      expect(() => {
        safeResolve(testDir, '/etc/passwd', { allowAbsolute: true, allowTraversal: false })
      }).toThrow(UnsafePathError)
    })
  })

  describe('isSafePath', () => {
    it('should return true for safe paths', () => {
      expect(isSafePath('subdir/file.txt', testDir)).toBe(true)
    })

    it('should return false for traversal attempts', () => {
      expect(isSafePath('../../../etc/passwd', testDir)).toBe(false)
    })

    it('should return false for absolute paths by default', () => {
      expect(isSafePath('/etc/passwd', testDir)).toBe(false)
    })

    it('should return true for absolute paths with option', () => {
      expect(isSafePath('/tmp/test.txt', testDir, { allowAbsolute: true, allowTraversal: true })).toBe(true)
    })
  })

  describe('createSafePathBuilder', () => {
    it('should create builder with bound base directory', () => {
      const builder = createSafePathBuilder(testDir)
      const result = builder.join('subdir', 'file.txt')

      expect(result).toContain(testDir)
      expect(result).toContain('subdir')
      expect(result).toContain('file.txt')
    })

    it('should block traversal in builder.join', () => {
      const builder = createSafePathBuilder(testDir)

      expect(() => {
        builder.join('..', '..', 'etc', 'passwd')
      }).toThrow(UnsafePathError)
    })

    it('should block traversal in builder.resolve', () => {
      const builder = createSafePathBuilder(testDir)

      expect(() => {
        builder.resolve('../../../etc/passwd')
      }).toThrow(UnsafePathError)
    })

    it('should check safety with builder.isSafe', () => {
      const builder = createSafePathBuilder(testDir)

      expect(builder.isSafe('subdir/file.txt')).toBe(true)
      expect(builder.isSafe('../../../etc/passwd')).toBe(false)
    })

    it('should return base directory with builder.getBaseDir', () => {
      const builder = createSafePathBuilder(testDir)
      expect(builder.getBaseDir()).toBe(testDir)
    })
  })

  describe('FileUploadService path traversal scenarios', () => {
    it('should sanitize filename with .. sequences', () => {
      const builder = createSafePathBuilder(testDir)

      // Simulate what FileUploadService.getFilePath does
      const appId = 'my-app'
      const uploadId = 'upload_123'
      const attackFilename = '../../etc/passwd'

      // This should NOT throw because the path is sanitized
      const result = builder.join(appId, uploadId, attackFilename)

      // Result should be within testDir and NOT contain ".."
      expect(result).toContain(testDir)
      expect(result).not.toContain('..')
      expect(result).toContain('my-app')
      expect(result).toContain('upload_123')
    })

    it('should sanitize filename with absolute path', () => {
      const builder = createSafePathBuilder(testDir)

      const appId = 'my-app'
      const uploadId = 'upload_123'
      const attackFilename = '/etc/passwd'

      // Should throw because absolute paths are not allowed by default
      expect(() => {
        builder.join(appId, uploadId, attackFilename)
      }).toThrow(UnsafePathError)
    })

    it('should sanitize filename with null byte injection', () => {
      const builder = createSafePathBuilder(testDir)

      const appId = 'my-app'
      const uploadId = 'upload_123'
      const attackFilename = 'file\x00.txt'

      const result = builder.join(appId, uploadId, attackFilename)

      // Null bytes should be stripped
      expect(result).not.toContain('\x00')
      expect(result).toContain(testDir)
    })

    it('should sanitize filename with encoded traversal', () => {
      const builder = createSafePathBuilder(testDir)

      const appId = 'my-app'
      const uploadId = 'upload_123'
      const attackFilename = '....//....//etc/passwd'

      const result = builder.join(appId, uploadId, attackFilename)

      // Should be sanitized and stay within base
      expect(result).toContain(testDir)
      expect(result).not.toContain('..')
    })

    it('should handle complex multi-segment traversal', () => {
      const builder = createSafePathBuilder(testDir)

      const appId = '../../../etc'
      const uploadId = 'upload_123'
      const filename = 'passwd'

      // Should throw because appId contains traversal
      expect(() => {
        builder.join(appId, uploadId, filename)
      }).toThrow(UnsafePathError)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty strings', () => {
      expect(() => safeJoin(testDir, '')).toThrow(UnsafePathError)
    })

    it('should handle whitespace-only strings', () => {
      const result = safeJoin(testDir, '   ')
      // Whitespace should be preserved but path should be safe
      expect(result).toContain(testDir)
    })

    it('should require non-empty base directory', () => {
      expect(() => safeJoin('', 'file.txt')).toThrow(UnsafePathError)
    })

    it('should require string base directory', () => {
      expect(() => safeJoin(null as any, 'file.txt')).toThrow(UnsafePathError)
      expect(() => safeJoin(undefined as any, 'file.txt')).toThrow(UnsafePathError)
    })

    it('should require string path segments', () => {
      expect(() => safeJoin(testDir, 123 as any)).toThrow(UnsafePathError)
      expect(() => safeJoin(testDir, null as any)).toThrow(UnsafePathError)
      expect(() => safeJoin(testDir, {} as any)).toThrow(UnsafePathError)
    })

    it('should handle very long path segments', () => {
      const longSegment = 'a'.repeat(1000)
      const result = safeJoin(testDir, longSegment)
      expect(result).toContain(testDir)
      expect(result).toContain(longSegment)
    })

    it('should handle Unicode characters', () => {
      const unicodeFilename = 'файл-文件-ファイル.txt'
      const result = safeJoin(testDir, unicodeFilename)
      expect(result).toContain(testDir)
      expect(result).toContain(unicodeFilename)
    })
  })
})
