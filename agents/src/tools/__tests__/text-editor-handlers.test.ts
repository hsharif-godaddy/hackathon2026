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
      expect(result).toMatch(/^Contents:/)
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

    it('should block image files with image-specific message', async () => {
      writeFileSync(join(testDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const result = await handleView(join(testDir, 'logo.png'))
      expect(result).toContain('Cannot read logo.png')
      expect(result).toContain('image file')
      expect(result).toContain('Reference by path')
    })

    it('should block document files with doc-specific message', async () => {
      writeFileSync(join(testDir, 'report.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46]))
      const result = await handleView(join(testDir, 'report.pdf'))
      expect(result).toContain('Cannot read report.pdf')
      expect(result).toContain('PDF not supported')
      expect(result).toContain('paste relevant')
    })

    it('should block archive files with generic binary message', async () => {
      writeFileSync(join(testDir, 'data.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      const result = await handleView(join(testDir, 'data.zip'))
      expect(result).toContain('Cannot read data.zip')
      expect(result).toContain('binary file')
      expect(result).toContain('Reference by path')
    })

    it('should allow SVG files since they are readable XML text', async () => {
      writeFileSync(join(testDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')
      const result = await handleView(join(testDir, 'icon.svg'))
      expect(result).toContain('<svg')
      expect(result).not.toContain('Cannot read')
    })

    it('should block binary files with unknown extensions via null-byte sniffing', async () => {
      writeFileSync(join(testDir, 'data.custom'), Buffer.from([0x00, 0x01, 0x02, 0xFF]))
      const result = await handleView(join(testDir, 'data.custom'))
      expect(result).toContain('binary file detected')
      expect(result).not.toContain('\x00')
    })

    it('should allow text files with unknown extensions', async () => {
      writeFileSync(join(testDir, 'config.toml'), '[server]\nport = 3000\n')
      const result = await handleView(join(testDir, 'config.toml'))
      expect(result).toContain('port = 3000')
      expect(result).not.toContain('Cannot read')
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

    it('should throw when no match found with file content in error', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'hello world')
      await expect(handleStrReplace(filePath, 'not here', 'x')).rejects.toThrow('No match found')
    })

    it('should include file content snippet in no-match error for small files', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'line one\nline two\nline three')
      try {
        await handleStrReplace(filePath, 'not here', 'x')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('File content (3 lines):')
        // Uses readFile format: padded line number + pipe separator
        expect(e.message).toContain('     1|line one')
        expect(e.message).toContain('     2|line two')
        expect(e.message).toContain('     3|line three')
      }
    })

    it('should show ±50 lines around partial match for large files', async () => {
      const filePath = join(testDir, 'large.txt')
      const lines = Array.from({ length: 200 }, (_, i) => `line number ${i + 1}`)
      // Put a distinctive line at position 100 (index 99)
      lines[99] = 'UNIQUE_MARKER_LINE here'
      writeFileSync(filePath, lines.join('\n'))
      try {
        // Use multi-line search where first line matches but full text doesn't
        await handleStrReplace(filePath, 'UNIQUE_MARKER_LINE here\nthis second line does not exist', 'x')
        expect.fail('Should have thrown')
      } catch (e: any) {
        // Should find partial match on the first line of search text
        expect(e.message).toContain('File content (200 lines):')
        // Should include line 100 (the marker)
        expect(e.message).toContain('   100|UNIQUE_MARKER_LINE here')
        // Should NOT include line 1 (too far from match)
        expect(e.message).not.toContain('     1|line number 1')
      }
    })

    it('should show first 50 + last 50 with omission when no partial match in large file', async () => {
      const filePath = join(testDir, 'large.txt')
      const lines = Array.from({ length: 200 }, (_, i) => `content ${i + 1}`)
      writeFileSync(filePath, lines.join('\n'))
      try {
        // Search text whose first line is short (<=10 chars), so no partial match
        await handleStrReplace(filePath, 'xyz', 'x')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('     1|content 1')
        expect(e.message).toContain('    50|content 50')
        expect(e.message).toContain('(100 lines omitted)')
        expect(e.message).toContain('   151|content 151')
        expect(e.message).toContain('   200|content 200')
      }
    })

    it('should show full file for 41–99 lines when head+tail would cover entire file (no negative line numbers)', async () => {
      const filePath = join(testDir, 'mid.txt')
      const lines = Array.from({ length: 45 }, (_, i) => `row ${i + 1}`)
      writeFileSync(filePath, lines.join('\n'))
      try {
        await handleStrReplace(filePath, 'xyz', 'x')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('File content (45 lines):')
        expect(e.message).toContain('     1|row 1')
        expect(e.message).toContain('    45|row 45')
        expect(e.message).not.toMatch(/\s+-\d+\|/)
        expect(e.message).not.toMatch(/omitted\)/)
      }
    })

    it('should show full file for 99 lines without head/tail overlap or bogus omission', async () => {
      const filePath = join(testDir, 'ninety-nine.txt')
      const lines = Array.from({ length: 99 }, (_, i) => `L${i + 1}`)
      writeFileSync(filePath, lines.join('\n'))
      try {
        await handleStrReplace(filePath, 'xyz', 'x')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('File content (99 lines):')
        expect(e.message).toContain('     1|L1')
        expect(e.message).toContain('    99|L99')
        expect(e.message).not.toMatch(/\([0-9]+ lines omitted\)/)
      }
    })

    it('should use correct omitted count and tail start line for files just over head+tail span', async () => {
      const filePath = join(testDir, 'one-gap.txt')
      const lines = Array.from({ length: 105 }, (_, i) => `cell ${i + 1}`)
      writeFileSync(filePath, lines.join('\n'))
      try {
        await handleStrReplace(filePath, 'xyz', 'x')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('(5 lines omitted)')
        expect(e.message).toContain('    50|cell 50')
        expect(e.message).toContain('    56|cell 56')
        expect(e.message).toContain('   105|cell 105')
      }
    })

    it('should include truncated prefix for oversized single-line files', async () => {
      const filePath = join(testDir, 'minified.js')
      // Create a single-line file larger than the snippet cap
      const longLine = 'var x=' + 'a'.repeat(25_000) + ';'
      writeFileSync(filePath, longLine)
      try {
        await handleStrReplace(filePath, 'not_in_file', 'x')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('File content (1 lines):')
        // Should include a truncated prefix, not just the truncation marker
        expect(e.message).toContain('     1|var x=')
        expect(e.message).toMatch(/truncated, 25014 chars/)
        // Should NOT contain the full 25KB line
        expect(e.message.length).toBeLessThan(25_000)
      }
    })

    it('should throw when multiple matches found with line numbers', async () => {
      const filePath = join(testDir, 'test.txt')
      writeFileSync(filePath, 'foo\nbar\nfoo')
      try {
        await handleStrReplace(filePath, 'foo', 'baz')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('Found 2 matches for old_str at lines: 1, 3.')
        expect(e.message).toContain('Match 1 (starts line 1)')
        expect(e.message).toContain('Match 2 (starts line 3)')
      }
    })

    it('should include two lines of context before and after each match when available', async () => {
      const filePath = join(testDir, 'multi-ctx.txt')
      const content = [
        'before0',
        'before1',
        'XY',
        'after0',
        'after1',
        'gap1',
        'gap2',
        'before0b',
        'before1b',
        'XY',
        'after0b',
        'after1b',
      ].join('\n')
      writeFileSync(filePath, content)
      try {
        await handleStrReplace(filePath, 'XY', 'Z')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('Found 2 matches for old_str at lines: 3, 10.')
        expect(e.message).toContain('Match 1 (starts line 3)')
        expect(e.message).toContain('     1|before0')
        expect(e.message).toContain('     2|before1')
        expect(e.message).toContain('     3|XY')
        expect(e.message).toContain('     4|after0')
        expect(e.message).toContain('     5|after1')
        expect(e.message).not.toContain('gap1')
        expect(e.message).toContain('Match 2 (starts line 10)')
        expect(e.message).toContain('     8|before0b')
        expect(e.message).toContain('     9|before1b')
        expect(e.message).toContain('    10|XY')
        expect(e.message).toContain('    11|after0b')
        expect(e.message).toContain('    12|after1b')
      }
    })

    it('should clip multi-match context at file start when two lines before do not exist', async () => {
      const filePath = join(testDir, 'multi-start.txt')
      const content = ['dup', 'a', 'b', 'c', 'd', 'e', 'dup', 'f'].join('\n')
      writeFileSync(filePath, content)
      try {
        await handleStrReplace(filePath, 'dup', 'Z')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('Found 2 matches for old_str at lines: 1, 7.')
        expect(e.message).toContain('Match 1 (starts line 1)')
        expect(e.message).toContain('     1|dup')
        expect(e.message).toContain('     2|a')
        expect(e.message).toContain('     3|b')
        expect(e.message).not.toContain('     0|')
        expect(e.message).toContain('Match 2 (starts line 7)')
        expect(e.message).toContain('     5|d')
        expect(e.message).toContain('     6|e')
        expect(e.message).toContain('     7|dup')
        expect(e.message).toContain('     8|f')
      }
    })

    it('should clip multi-match context at file end when two lines after do not exist', async () => {
      const filePath = join(testDir, 'multi-end.txt')
      const content = ['a', 'b', 'c', 'd', 'dup', 'e', 'f', 'g', 'dup'].join('\n')
      writeFileSync(filePath, content)
      try {
        await handleStrReplace(filePath, 'dup', 'Z')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('Found 2 matches for old_str at lines: 5, 9.')
        expect(e.message).toContain('Match 1 (starts line 5)')
        expect(e.message).toContain('     3|c')
        expect(e.message).toContain('     4|d')
        expect(e.message).toContain('     5|dup')
        expect(e.message).toContain('     6|e')
        expect(e.message).toContain('     7|f')
        expect(e.message).toContain('Match 2 (starts line 9)')
        expect(e.message).toContain('     8|g')
        expect(e.message).toContain('     9|dup')
        expect(e.message).not.toMatch(/\s+10\|/)
      }
    })

    it('should list all match start lines in header while capping detail blocks to five', async () => {
      const filePath = join(testDir, 'many-matches.txt')
      const content = Array.from({ length: 10 }, () => 'x').join('\n')
      writeFileSync(filePath, content)
      try {
        await handleStrReplace(filePath, 'x', 'y')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain(
          'Found 10 matches for old_str at lines: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10.',
        )
        expect(e.message).toContain('Match 5 (starts line')
        expect(e.message).not.toContain('Match 6 (starts line')
        expect(e.message).toContain('5 more match locations not shown.')
      }
    })

    it('should append singular omitted note when only one detail block is past the cap', async () => {
      const filePath = join(testDir, 'six-matches.txt')
      const content = Array.from({ length: 6 }, () => 'x').join('\n')
      writeFileSync(filePath, content)
      try {
        await handleStrReplace(filePath, 'x', 'y')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toMatch(/Found 6 matches/)
        expect(e.message).toContain('1 more match location not shown.')
      }
    })

    it('should cap at-lines header after 20 start lines with remainder summarized', async () => {
      const filePath = join(testDir, 'twenty-five-matches.txt')
      const content = Array.from({ length: 25 }, () => 'x').join('\n')
      writeFileSync(filePath, content)
      const first20 = Array.from({ length: 20 }, (_, i) => String(i + 1)).join(', ')
      try {
        await handleStrReplace(filePath, 'x', 'y')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toMatch(/Found 25 matches/)
        expect(e.message).toContain(`at lines: ${first20}, … (5 more).`)
        expect(e.message).toContain('Match 5 (starts line')
        expect(e.message).toContain('20 more match locations not shown.')
      }
    })

    it('should truncate multi-match detail when it exceeds MAX_SNIPPET_CHARS', async () => {
      const filePath = join(testDir, 'huge-blocks.txt')
      const pad = 'p'.repeat(2_000)
      const lines = Array.from({ length: 5 }, (_, i) => `${pad}${i}`)
      writeFileSync(filePath, lines.join('\n'))
      try {
        await handleStrReplace(filePath, pad, 'q')
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('Found 5 matches for old_str at lines: 1, 2, 3, 4, 5.')
        expect(e.message).toContain('truncated at 5000 characters')
        expect(e.message.length).toBeLessThan(6_500)
      }
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

    it('should insert correctly in a >1MB file (streaming path)', async () => {
      const filePath = join(testDir, 'large.txt')
      // Build a >1MB file: ~30000 lines of 40 chars -> ~1.2MB
      const padding = 'x'.repeat(39)
      const lineCount = 30_000
      const lines: string[] = []
      for (let i = 0; i < lineCount; i++) lines.push(padding)
      writeFileSync(filePath, lines.join('\n'))

      await handleInsert(filePath, 1, 'INSERTED_MARKER')

      const resultLines = readFileSync(filePath, 'utf-8').split('\n')
      expect(resultLines[0]).toBe(padding)
      expect(resultLines[1]).toBe('INSERTED_MARKER')
      expect(resultLines[2]).toBe(padding)
      // No tmp file left behind
      expect(existsSync(`${filePath}.tmp`)).toBe(false)
    })

    it('preserves trailing-newline state on the streaming path (no trailing newline)', async () => {
      const filePath = join(testDir, 'large-no-newline.txt')
      const padding = 'x'.repeat(39)
      const lines: string[] = []
      for (let i = 0; i < 30_000; i++) lines.push(padding)
      writeFileSync(filePath, lines.join('\n')) // no trailing \n

      await handleInsert(filePath, 1, 'INSERTED_MARKER')

      const content = readFileSync(filePath, 'utf-8')
      expect(content.endsWith('\n')).toBe(false)
      expect(content).toContain('\nINSERTED_MARKER\n')
    })

    it('preserves trailing-newline state on the streaming path (with trailing newline)', async () => {
      const filePath = join(testDir, 'large-with-newline.txt')
      const padding = 'x'.repeat(39)
      const lines: string[] = []
      for (let i = 0; i < 30_000; i++) lines.push(padding)
      writeFileSync(filePath, lines.join('\n') + '\n') // trailing \n

      await handleInsert(filePath, 1, 'INSERTED_MARKER')

      const content = readFileSync(filePath, 'utf-8')
      expect(content.endsWith('\n')).toBe(true)
      expect(content).toContain('\nINSERTED_MARKER\n')
    })
  })
})
