import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { handleView, handleStrReplace, handleCreate, handleInsert } from '../text-editor-handlers.js'

describe('text-editor-handlers', () => {
  let testDir: string

  beforeEach(() => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`
    testDir = join(tmpdir(), `test-text-editor-${uniqueId}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('handleView', () => {
    it('should read file with line numbers', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'line1\nline2\nline3')
      const result = await handleView(join(testDir, 'test.txt'))
      expect(result).toBe('1: line1\n2: line2\n3: line3')
    })

    it('should list directory contents', async () => {
      writeFileSync(join(testDir, 'a.txt'), '')
      writeFileSync(join(testDir, 'b.txt'), '')
      const result = await handleView(testDir)
      expect(result).toContain('a.txt')
      expect(result).toContain('b.txt')
      expect(result).toMatch(/^Directory contents:/)
    })

    it('should apply view_range with 1-indexed lines', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'line1\nline2\nline3\nline4\nline5')
      const result = await handleView(join(testDir, 'test.txt'), [2, 4])
      expect(result).toBe('2: line2\n3: line3\n4: line4')
    })

    it('should handle view_range with -1 for end of file', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'line1\nline2\nline3')
      const result = await handleView(join(testDir, 'test.txt'), [2, -1])
      expect(result).toBe('2: line2\n3: line3')
    })

    it('should throw for non-existent file', async () => {
      await expect(handleView(join(testDir, 'nope.txt'))).rejects.toThrow('File does not exist')
    })

    it('should handle empty file', async () => {
      writeFileSync(join(testDir, 'empty.txt'), '')
      const result = await handleView(join(testDir, 'empty.txt'))
      expect(result).toBe('1: ')
    })

    it('should handle single line file', async () => {
      writeFileSync(join(testDir, 'single.txt'), 'hello')
      const result = await handleView(join(testDir, 'single.txt'))
      expect(result).toBe('1: hello')
    })
  })

  describe('handleStrReplace', () => {
    it('should replace exact unique match', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'hello world\nfoo bar\nbaz')
      const result = await handleStrReplace(filePath, 'foo bar', 'replaced')
      expect(result).toContain('Successfully')
      expect(readFileSync(filePath, 'utf-8')).toBe('hello world\nreplaced\nbaz')
    })

    it('should throw when no match found', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'hello world')
      await expect(handleStrReplace(filePath, 'not here', 'x')).rejects.toThrow('No match found')
    })

    it('should throw when multiple matches found', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'foo\nbar\nfoo')
      await expect(handleStrReplace(filePath, 'foo', 'baz')).rejects.toThrow(/Found 2 matches/)
    })

    it('should throw for non-existent file', async () => {
      await expect(handleStrReplace(join(testDir, 'nope.txt'), 'a', 'b')).rejects.toThrow('File does not exist')
    })

    it('should handle multi-line replacement', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'line1\nline2\nline3\nline4')
      await handleStrReplace(filePath, 'line2\nline3', 'replaced2\nreplaced3\nreplaced3b')
      expect(readFileSync(filePath, 'utf-8')).toBe('line1\nreplaced2\nreplaced3\nreplaced3b\nline4')
    })

    it('should handle replacing with empty string', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'keep\nremove me\nkeep')
      await handleStrReplace(filePath, '\nremove me', '')
      expect(readFileSync(filePath, 'utf-8')).toBe('keep\nkeep')
    })
  })

  describe('handleCreate', () => {
    it('should create a new file', async () => {
      const filePath = join(testDir, 'new.txt')
      const result = await handleCreate(filePath, 'content here')
      expect(result).toContain('Successfully created')
      expect(readFileSync(filePath, 'utf-8')).toBe('content here')
    })

    it('should create parent directories', async () => {
      const filePath = join(testDir, 'deep', 'nested', 'file.txt')
      await handleCreate(filePath, 'nested content')
      expect(readFileSync(filePath, 'utf-8')).toBe('nested content')
    })

    it('should overwrite if file already exists', async () => {
      const filePath = join(testDir, 'exists.txt')
      writeFileSync(filePath, 'existing')
      const result = await handleCreate(filePath, 'new')
      expect(result).toContain('Successfully created')
      expect(readFileSync(filePath, 'utf-8')).toBe('new')
    })

    it('should handle empty content', async () => {
      const filePath = join(testDir, 'empty.txt')
      await handleCreate(filePath, '')
      expect(readFileSync(filePath, 'utf-8')).toBe('')
    })
  })

  describe('handleInsert', () => {
    it('should insert at beginning with insertLine=0', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'line1\nline2\nline3')
      await handleInsert(filePath, 0, 'inserted')
      expect(readFileSync(filePath, 'utf-8')).toBe('inserted\nline1\nline2\nline3')
    })

    it('should insert after line 1 with insertLine=1', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'line1\nline2\nline3')
      await handleInsert(filePath, 1, 'inserted')
      expect(readFileSync(filePath, 'utf-8')).toBe('line1\ninserted\nline2\nline3')
    })

    it('should append at end with insertLine beyond file length', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'line1\nline2')
      await handleInsert(filePath, 10, 'appended')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('appended')
      // Should be after existing content
      expect(content.indexOf('appended')).toBeGreaterThan(content.indexOf('line2'))
    })

    it('should throw for non-existent file', async () => {
      await expect(handleInsert(join(testDir, 'nope.txt'), 0, 'text')).rejects.toThrow('File does not exist')
    })

    it('should handle inserting multi-line text', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'line1\nline3')
      await handleInsert(filePath, 1, 'line2a\nline2b')
      expect(readFileSync(filePath, 'utf-8')).toBe('line1\nline2a\nline2b\nline3')
    })

    it('should insert at end of file with insertLine equal to line count', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'line1\nline2\nline3')
      // 3 lines -> split produces array of length 3 -> insertLine=3 appends
      await handleInsert(filePath, 3, 'line4')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toBe('line1\nline2\nline3\nline4')
    })
  })
})
