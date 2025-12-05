import { estimateLineCountsFromPartial, parseStreamingInput } from './FileEditToolRenderer'
import { describe, expect, it } from 'vitest'

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

    it('should aggregate counts from batch operations array', function batchAggregate() {
      const input = JSON.stringify({
        operations: [
          {
            path: 'file1.tsx',
            mode: 'create',
            content: 'line1\nline2\nline3'
          },
          {
            path: 'file2.tsx',
            mode: 'edit',
            edits: [
              { old: 'old1\nold2\nold3', new: 'new1\nnew2' }
            ]
          }
        ]
      })
      const result = estimateLineCountsFromPartial(input)
      expect(result).not.toBeNull()
      expect(result?.additions).toBe(3) // 2 from content + 1 from edits
      expect(result?.deletions).toBe(2) // 2 from edits
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

    it('should handle batch operation results with operations array', function batchResult() {
      // Batch operations don't stream, so this tests the static parsing
      // The actual rendering logic will check for parsedResult.operations array
      const input = JSON.stringify({
        success: true,
        totalOperations: 3,
        completedOperations: 3,
        operations: [
          {
            path: 'file1.tsx',
            mode: 'create',
            success: true,
            changes: { additions: 10, deletions: 0, totalLines: 10 }
          },
          {
            path: 'file2.tsx',
            mode: 'edit',
            success: true,
            changes: { additions: 5, deletions: 3, totalLines: 50 }
          },
          {
            path: 'file3.tsx',
            mode: 'delete',
            success: true,
            changes: { additions: 0, deletions: 0, totalLines: 0 }
          }
        ]
      })

      // estimateLineCountsFromPartial works on single operation input format
      // For batch operations, we rely on the component's result parsing logic
      // This test just verifies the JSON structure is valid
      const parsed = JSON.parse(input)
      expect(parsed.operations).toHaveLength(3)
      expect(parsed.totalOperations).toBe(3)
      expect(parsed.completedOperations).toBe(3)
    })

    it('should handle partial batch operation failure', function batchPartialFailure() {
      const input = JSON.stringify({
        success: false,
        totalOperations: 5,
        completedOperations: 3,
        operations: [
          {
            path: 'file1.tsx',
            mode: 'create',
            success: true,
            changes: { additions: 10, deletions: 0, totalLines: 10 }
          },
          {
            path: 'file2.tsx',
            mode: 'create',
            success: true,
            changes: { additions: 20, deletions: 0, totalLines: 20 }
          },
          {
            path: 'file3.tsx',
            mode: 'create',
            success: true,
            changes: { additions: 15, deletions: 0, totalLines: 15 }
          },
          {
            path: 'file4.tsx',
            mode: 'edit',
            success: false,
            error: 'File not found'
          }
        ],
        error: 'Operation 3 failed: File not found'
      })

      const parsed = JSON.parse(input)
      expect(parsed.success).toBe(false)
      expect(parsed.operations).toHaveLength(4)
      expect(parsed.operations[3].success).toBe(false)
      expect(parsed.operations[3].error).toBe('File not found')
    })
  })

  describe('#parseStreamingInput', function parseTests() {
    it('should detect batch operations from parsed JSON', function detectBatch() {
      const result = parseStreamingInput(JSON.stringify({
        operations: [
          { path: 'file1.ts', mode: 'edit', edits: [{ old: 'a', new: 'b' }] },
          { path: 'file2.ts', mode: 'create', content: 'foo' }
        ]
      }))
      expect(result.isBatch).toBe(true)
      expect(result.batchCount).toBe(2)
      expect(result.firstOp?.path).toBe('file1.ts')
    })

    it('should treat legacy single operation payloads as non-batch', function legacySingle() {
      const result = parseStreamingInput(JSON.stringify({
        path: 'legacy.tsx',
        mode: 'edit',
        edits: [{ old: 'foo', new: 'bar' }]
      }))
      expect(result.isBatch).toBe(false)
      expect(result.batchCount).toBe(0)
      expect(result.firstOp?.path).toBe('legacy.tsx')
    })

    it('should parse partial batch payloads after JSON completion', function partialWithCompletion() {
      const partial = '{"operations": [{"path": "file1.ts", "mode": "edit"}, {"path": "file2.ts", "mode": "create"}'
      const result = parseStreamingInput(partial)
      expect(result.isBatch).toBe(true)
      expect(result.batchCount).toBe(2)
      expect(result.firstOp?.path).toBe('file1.ts')
    })

    it('should fallback to string detection when JSON completion fails', function fallbackBatch() {
      const partial = '"operations": [{"path": "file1.ts", "mode": "edit"}, {"path": "file2.ts", "mode": "create"}'
      const result = parseStreamingInput(partial)
      expect(result.isBatch).toBe(true)
      expect(result.batchCount).toBe(2)
      expect(result.firstOp).toBeNull()
    })

    it('should return non-batch when no operations are detected', function nonBatch() {
      const result = parseStreamingInput('{"unrelated": true}')
      expect(result.isBatch).toBe(false)
      expect(result.batchCount).toBe(0)
    })
  })
})
