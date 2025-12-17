import { describe, it, expect } from 'vitest'

import {
  buildStepContentSignature,
  createDuplicateResponseStopCondition,
  DEFAULT_DUPLICATE_RESPONSE_THRESHOLD,
  StepContentItem,
  StepResult
} from '../duplicate-detection.js'

describe('duplicate-detection', function duplicateDetection() {
  describe('#buildStepContentSignature', function signatureTests() {
    it('should create signature for text content', function textContent() {
      const content: StepContentItem[] = [
        { type: 'text', text: 'Hello world' }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toBe(JSON.stringify(['text:Hello world']))
    })

    it('should trim whitespace from text content', function trimText() {
      const content: StepContentItem[] = [
        { type: 'text', text: '  Hello world  ' }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toBe(JSON.stringify(['text:Hello world']))
    })

    it('should create signature for tool calls', function toolCall() {
      const content: StepContentItem[] = [
        { type: 'tool-call', toolName: 'readFile', input: { path: '/test.txt' } }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toBe(JSON.stringify(['tool:readFile:{"path":"/test.txt"}']))
    })

    it('should handle tool calls without input', function toolCallNoInput() {
      const content: StepContentItem[] = [
        { type: 'tool-call', toolName: 'getTime' }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toBe(JSON.stringify(['tool:getTime:']))
    })

    it('should create signature for mixed text and tool calls', function mixedContent() {
      const content: StepContentItem[] = [
        { type: 'text', text: 'Processing request' },
        { type: 'tool-call', toolName: 'search', input: { query: 'test' } }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toBe(JSON.stringify([
        'text:Processing request',
        'tool:search:{"query":"test"}'
      ]))
    })

    it('should skip empty/whitespace-only text', function skipEmptyText() {
      const content: StepContentItem[] = [
        { type: 'text', text: '   ' },
        { type: 'tool-call', toolName: 'action', input: {} }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toBe(JSON.stringify(['tool:action:{}']))
    })

    it('should skip tool-result items', function skipToolResult() {
      const content: StepContentItem[] = [
        { type: 'tool-result', toolName: 'readFile', text: 'file contents' },
        { type: 'text', text: 'Processing done' }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toBe(JSON.stringify(['text:Processing done']))
    })

    it('should return null for empty content array', function emptyArray() {
      const signature = buildStepContentSignature([])

      expect(signature).toBeNull()
    })

    it('should return null when all content is filtered', function allFiltered() {
      const content: StepContentItem[] = [
        { type: 'text', text: '   ' },
        { type: 'tool-result', toolName: 'readFile' },
        { type: 'unknown-type' }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toBeNull()
    })

    it('should handle tool args containing pipe characters (previous delimiter)', function pipeInArgs() {
      const content1: StepContentItem[] = [
        { type: 'tool-call', toolName: 'execute', input: { cmd: 'ls | grep test' } }
      ]
      const content2: StepContentItem[] = [
        { type: 'tool-call', toolName: 'execute', input: { cmd: 'ls' } },
        { type: 'tool-call', toolName: 'grep', input: { pattern: 'test' } }
      ]

      const sig1 = buildStepContentSignature(content1)
      const sig2 = buildStepContentSignature(content2)

      // Signatures should be different - JSON.stringify prevents collision
      expect(sig1).not.toBe(sig2)
    })

    it('should handle complex nested input objects', function nestedInput() {
      const content: StepContentItem[] = [
        {
          type: 'tool-call',
          toolName: 'complexTool',
          input: {
            nested: { deep: { value: 123 } },
            array: [1, 2, 3],
            special: 'chars: |, ", \\'
          }
        }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toContain('complexTool')
      expect(signature).not.toBeNull()
    })

    it('should handle very long text content', function longText() {
      const longText = 'a'.repeat(10000)
      const content: StepContentItem[] = [
        { type: 'text', text: longText }
      ]

      const signature = buildStepContentSignature(content)

      expect(signature).toContain(longText)
    })
  })

  describe('#createDuplicateResponseStopCondition', function stopConditionTests() {
    it('should export default threshold of 2', function defaultThreshold() {
      expect(DEFAULT_DUPLICATE_RESPONSE_THRESHOLD).toBe(2)
    })

    it('should not stop on first step', function firstStep() {
      const stopCondition = createDuplicateResponseStopCondition()
      const result: StepResult = {
        steps: [
          { content: [{ type: 'text', text: 'Hello' }] }
        ]
      }

      expect(stopCondition(result)).toBe(false)
    })

    it('should not stop on different consecutive steps', function differentSteps() {
      const stopCondition = createDuplicateResponseStopCondition()

      const result1: StepResult = {
        steps: [{ content: [{ type: 'text', text: 'First response' }] }]
      }
      const result2: StepResult = {
        steps: [
          { content: [{ type: 'text', text: 'First response' }] },
          { content: [{ type: 'text', text: 'Second response' }] }
        ]
      }

      expect(stopCondition(result1)).toBe(false)
      expect(stopCondition(result2)).toBe(false)
    })

    it('should detect duplicate text responses', function duplicateText() {
      const stopCondition = createDuplicateResponseStopCondition()
      const duplicateContent = [{ type: 'text', text: 'Same response' }]

      // First step
      expect(stopCondition({
        steps: [{ content: duplicateContent }]
      })).toBe(false)

      // Second step (first duplicate)
      expect(stopCondition({
        steps: [
          { content: duplicateContent },
          { content: duplicateContent }
        ]
      })).toBe(false)

      // Third step (second duplicate - should trigger stop with default threshold of 2)
      expect(stopCondition({
        steps: [
          { content: duplicateContent },
          { content: duplicateContent },
          { content: duplicateContent }
        ]
      })).toBe(true)
    })

    it('should detect duplicate tool calls with identical args', function duplicateToolCalls() {
      const stopCondition = createDuplicateResponseStopCondition()
      const duplicateContent = [
        { type: 'tool-call', toolName: 'readFile', input: { path: '/same.txt' } }
      ]

      expect(stopCondition({ steps: [{ content: duplicateContent }] })).toBe(false)
      expect(stopCondition({
        steps: [{ content: duplicateContent }, { content: duplicateContent }]
      })).toBe(false)
      expect(stopCondition({
        steps: [
          { content: duplicateContent },
          { content: duplicateContent },
          { content: duplicateContent }
        ]
      })).toBe(true)
    })

    it('should not trigger for tool calls with different args', function differentToolArgs() {
      const stopCondition = createDuplicateResponseStopCondition()

      expect(stopCondition({
        steps: [{ content: [{ type: 'tool-call', toolName: 'readFile', input: { path: '/file1.txt' } }] }]
      })).toBe(false)

      expect(stopCondition({
        steps: [
          { content: [{ type: 'tool-call', toolName: 'readFile', input: { path: '/file1.txt' } }] },
          { content: [{ type: 'tool-call', toolName: 'readFile', input: { path: '/file2.txt' } }] }
        ]
      })).toBe(false)

      expect(stopCondition({
        steps: [
          { content: [{ type: 'tool-call', toolName: 'readFile', input: { path: '/file1.txt' } }] },
          { content: [{ type: 'tool-call', toolName: 'readFile', input: { path: '/file2.txt' } }] },
          { content: [{ type: 'tool-call', toolName: 'readFile', input: { path: '/file3.txt' } }] }
        ]
      })).toBe(false)
    })

    it('should detect mixed text + tool duplicates', function mixedDuplicates() {
      const stopCondition = createDuplicateResponseStopCondition()
      const duplicateContent = [
        { type: 'text', text: 'Processing...' },
        { type: 'tool-call', toolName: 'search', input: { query: 'test' } }
      ]

      expect(stopCondition({ steps: [{ content: duplicateContent }] })).toBe(false)
      expect(stopCondition({
        steps: [{ content: duplicateContent }, { content: duplicateContent }]
      })).toBe(false)
      expect(stopCondition({
        steps: [
          { content: duplicateContent },
          { content: duplicateContent },
          { content: duplicateContent }
        ]
      })).toBe(true)
    })

    it('should respect custom threshold', function customThreshold() {
      const stopCondition = createDuplicateResponseStopCondition(3)
      const duplicateContent = [{ type: 'text', text: 'Same' }]

      expect(stopCondition({ steps: [{ content: duplicateContent }] })).toBe(false)
      expect(stopCondition({
        steps: Array(2).fill({ content: duplicateContent })
      })).toBe(false)
      expect(stopCondition({
        steps: Array(3).fill({ content: duplicateContent })
      })).toBe(false)
      // With threshold 3, need 4 identical steps (3 duplicates)
      expect(stopCondition({
        steps: Array(4).fill({ content: duplicateContent })
      })).toBe(true)
    })

    it('should reset counter when different content appears', function resetOnDifferent() {
      const stopCondition = createDuplicateResponseStopCondition()

      // Two duplicate steps
      expect(stopCondition({
        steps: [{ content: [{ type: 'text', text: 'A' }] }]
      })).toBe(false)
      expect(stopCondition({
        steps: [
          { content: [{ type: 'text', text: 'A' }] },
          { content: [{ type: 'text', text: 'A' }] }
        ]
      })).toBe(false)

      // Different content - resets counter
      expect(stopCondition({
        steps: [
          { content: [{ type: 'text', text: 'A' }] },
          { content: [{ type: 'text', text: 'A' }] },
          { content: [{ type: 'text', text: 'B' }] }
        ]
      })).toBe(false)

      // Back to A - counter should have reset
      expect(stopCondition({
        steps: [
          { content: [{ type: 'text', text: 'A' }] },
          { content: [{ type: 'text', text: 'A' }] },
          { content: [{ type: 'text', text: 'B' }] },
          { content: [{ type: 'text', text: 'A' }] }
        ]
      })).toBe(false)
    })

    it('should reset state when step count decreases (agent reuse)', function resetOnReuse() {
      const stopCondition = createDuplicateResponseStopCondition()
      const duplicateContent = [{ type: 'text', text: 'Same' }]

      // Build up to 2 duplicates (one more would trigger stop)
      expect(stopCondition({
        steps: [{ content: duplicateContent }]
      })).toBe(false)
      expect(stopCondition({
        steps: [{ content: duplicateContent }, { content: duplicateContent }]
      })).toBe(false)

      // Simulate agent reuse - step count decreases
      expect(stopCondition({
        steps: [{ content: duplicateContent }]
      })).toBe(false)

      // Should start fresh - not trigger stop
      expect(stopCondition({
        steps: [{ content: duplicateContent }, { content: duplicateContent }]
      })).toBe(false)
    })

    it('should handle empty steps array', function emptySteps() {
      const stopCondition = createDuplicateResponseStopCondition()

      expect(stopCondition({ steps: [] })).toBe(false)
    })

    it('should handle steps with empty content', function emptyContent() {
      const stopCondition = createDuplicateResponseStopCondition()

      expect(stopCondition({
        steps: [{ content: [] }]
      })).toBe(false)
    })

    it('should handle undefined/null results', function nullResults() {
      const stopCondition = createDuplicateResponseStopCondition()

      expect(stopCondition(undefined)).toBe(false)
      expect(stopCondition(null)).toBe(false)
      expect(stopCondition({})).toBe(false)
    })

    it('should handle steps with only filtered content', function onlyFilteredContent() {
      const stopCondition = createDuplicateResponseStopCondition()

      expect(stopCondition({
        steps: [{ content: [{ type: 'text', text: '   ' }] }]
      })).toBe(false)

      expect(stopCondition({
        steps: [
          { content: [{ type: 'text', text: '   ' }] },
          { content: [{ type: 'text', text: '   ' }] }
        ]
      })).toBe(false)
    })

    it('should handle threshold of 1 (stop on first duplicate)', function thresholdOne() {
      const stopCondition = createDuplicateResponseStopCondition(1)
      const duplicateContent = [{ type: 'text', text: 'Same' }]

      expect(stopCondition({ steps: [{ content: duplicateContent }] })).toBe(false)
      // With threshold 1, second identical step should trigger
      expect(stopCondition({
        steps: [{ content: duplicateContent }, { content: duplicateContent }]
      })).toBe(true)
    })
  })
})

