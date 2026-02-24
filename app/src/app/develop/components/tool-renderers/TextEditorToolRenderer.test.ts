import { describe, expect, it } from 'vitest'

import { estimateLineCountsFromPartial } from './TextEditorToolRenderer'

describe('TextEditorToolRenderer', () => {
  describe('#estimateLineCountsFromPartial', () => {
    it('should return null for empty or very short input', () => {
      expect(estimateLineCountsFromPartial('')).toBeNull()
      expect(estimateLineCountsFromPartial('abc')).toBeNull()
      expect(estimateLineCountsFromPartial('{"command"')).toBeNull()
    })

    it('should parse complete str_replace JSON', () => {
      const input = JSON.stringify({
        command: 'str_replace',
        path: 'test.tsx',
        old_str: 'line1\nline2\nline3',
        new_str: 'line1\nline2\nline3\nline4'
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      expect(result?.deletions).toBe(3)
      expect(result?.additions).toBe(4)
    })

    it('should parse complete create JSON', () => {
      const input = JSON.stringify({
        command: 'create',
        path: 'test.tsx',
        file_text: 'line1\nline2\nline3\nline4\nline5'
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      expect(result?.additions).toBe(5)
      expect(result?.deletions).toBe(0)
    })

    it('should parse complete insert JSON', () => {
      const input = JSON.stringify({
        command: 'insert',
        path: 'test.tsx',
        insert_line: 5,
        insert_text: 'new line 1\nnew line 2'
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      expect(result?.additions).toBe(2)
      expect(result?.deletions).toBe(0)
    })

    it('should return zero counts for view command', () => {
      const input = JSON.stringify({
        command: 'view',
        path: 'test.tsx'
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      expect(result?.additions).toBe(0)
      expect(result?.deletions).toBe(0)
    })

    it('should handle streaming deltas accumulating', () => {
      const deltas = [
        '',
        '{"command": "str',
        '_replace"',
        ', "path": "sr',
        'c/App.tsx"',
        ', "old_str": "line1',
        '\\nline2',
        '\\nline3"',
        ', "new_str": "line1',
        '\\nline2',
        '\\nline3',
        '\\nline4"',
        '}'
      ]

      let accumulated = ''
      let lastResult: { additions: number; deletions: number } | null = null

      for (const delta of deltas) {
        accumulated += delta
        const result = estimateLineCountsFromPartial(accumulated)
        if (result) {
          lastResult = result
        }
      }

      expect(lastResult).not.toBeNull()
      expect(lastResult?.deletions).toBe(3)
      expect(lastResult?.additions).toBe(4)
    })

    it('should handle partial JSON gracefully', () => {
      const input = '{"command": "str_replace", "path": "test.tsx", "old_str": "line1\\nline2'
      const result = estimateLineCountsFromPartial(input)
      // Should not crash - may return partial result or null
      expect(result === null || (typeof result === 'object' && 'additions' in result && 'deletions' in result)).toBe(true)
    })

    it('should return null for unparseable JSON', () => {
      const input = '{"command": "str_replace" invalid json here'
      const result = estimateLineCountsFromPartial(input)
      expect(result).toBeNull()
    })

    it('should handle trailing newlines in content correctly', () => {
      const input = JSON.stringify({
        command: 'create',
        path: 'test.tsx',
        file_text: 'line1\nline2\n'
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      // "line1\nline2\n" should count as 2 lines (trailing newline ignored)
      expect(result?.additions).toBe(2)
    })

    it('should handle str_replace with empty new_str', () => {
      const input = JSON.stringify({
        command: 'str_replace',
        path: 'test.tsx',
        old_str: 'line1\nline2',
        new_str: ''
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      expect(result?.deletions).toBe(2)
      expect(result?.additions).toBe(0)
    })
  })
})
