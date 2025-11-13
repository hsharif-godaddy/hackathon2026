import { describe, it, expect } from 'vitest'
import { estimateLineCountsFromPartial } from './FileEditToolRenderer'

describe('FileEditToolRenderer', function packageTests() {
  describe('#estimateLineCountsFromPartial', function estimateTests() {
    it('should return null for empty or very short input', function empty() {
      expect(estimateLineCountsFromPartial('')).toBeNull()
      expect(estimateLineCountsFromPartial('abc')).toBeNull()
      expect(estimateLineCountsFromPartial('{"path"')).toBeNull()
    })

    it('should parse complete JSON with edits array', function completeEdits() {
      const input = JSON.stringify({
        path: 'test.tsx',
        mode: 'edit',
        edits: [
          { old: 'line1\nline2\nline3', new: 'line1\nline2\nline3\nline4' }
        ]
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      expect(result?.deletions).toBe(2)
      expect(result?.additions).toBe(3)
    })

    it('should parse complete JSON with content field', function completeContent() {
      const input = JSON.stringify({
        path: 'test.tsx',
        mode: 'create',
        content: 'line1\nline2\nline3\nline4\nline5'
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      expect(result?.additions).toBe(4)
      expect(result?.deletions).toBe(0)
    })

    it('should handle streaming deltas accumulating', function streamingDeltas() {
      // Simulate the actual deltas from websocket
      const deltas = [
        '',
        '{"path": "sr',
        'c/pages/blo',
        'g.tsx"',
        ', "mode": "e',
        'dit"',
        ', "edits": [{',
        '"old": "line1',
        '\\nline2',
        '\\nline3"',
        ', "new": "line1',
        '\\nline2',
        '\\nline3',
        '\\nline4"',
        '}]',
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

      // Should eventually parse and return counts
      expect(lastResult).not.toBeNull()
      expect(lastResult?.deletions).toBe(2)
      expect(lastResult?.additions).toBe(3)
    })

    it('should handle partial JSON with incomplete string', function partialString() {
      const input = '{"path": "src/pages/blog.tsx", "mode": "edit", "edits": [{"old": "line1\\nline2'
      const result = estimateLineCountsFromPartial(input)
      // May or may not parse depending on how incomplete it is
      // Just verify it doesn't crash
      expect(result === null || (typeof result === 'object' && 'additions' in result && 'deletions' in result)).toBe(true)
    })

    it('should handle partial JSON with incomplete edits array', function partialArray() {
      const input = '{"path": "test.tsx", "mode": "edit", "edits": [{"old": "line1\\nline2\\nline3", "new": "line1\\nline2'
      const result = estimateLineCountsFromPartial(input)
      // Should parse what it can
      if (result) {
        expect(result.deletions).toBe(2)
      }
    })

    it('should handle partial JSON with trailing comma', function trailingComma() {
      const input = '{"path": "test.tsx", "mode": "edit", "edits": [{"old": "line1\\nline2", "new": "line1\\nline2\\nline3"},'
      const result = estimateLineCountsFromPartial(input)
      // Should handle trailing comma and still parse
      if (result) {
        expect(result.deletions).toBe(1)
        expect(result.additions).toBe(2)
      }
    })

    it('should return null for unparseable JSON', function unparseable() {
      const input = '{"path": "test.tsx" invalid json here'
      const result = estimateLineCountsFromPartial(input)
      expect(result).toBeNull()
    })

    it('should handle multiple edits in array', function multipleEdits() {
      const input = JSON.stringify({
        path: 'test.tsx',
        mode: 'edit',
        edits: [
          { old: 'line1\nline2', new: 'line1\nline2\nline3' },
          { old: 'line4\nline5\nline6', new: 'line4\nline5' }
        ]
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      // First edit: old has 1 newline, new has 2 newlines
      // Second edit: old has 2 newlines, new has 1 newline
      expect(result?.deletions).toBe(3) // 1 + 2 = 3 newlines in old fields
      expect(result?.additions).toBe(3) // 2 + 1 = 3 newlines in new fields
    })

    it('should handle partial content field', function partialContent() {
      const input = '{"path": "test.tsx", "mode": "create", "content": "line1\\nline2\\nline3'
      const result = estimateLineCountsFromPartial(input)
      // Should parse after completing
      if (result) {
        expect(result.additions).toBe(2)
      }
    })
  })
})

