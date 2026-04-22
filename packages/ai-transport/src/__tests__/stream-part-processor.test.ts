import { describe, it, expect, vi } from 'vitest'
import { StreamPartProcessor } from '../stream-part-processor.js'
import type { PartProcessorCallbacks } from '../stream-part-processor.js'

function createMockCallbacks(): PartProcessorCallbacks {
  return {
    onTextDelta: vi.fn(),
    onToolStart: vi.fn(),
    onToolInputDelta: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onToolError: vi.fn(),
    onStepStart: vi.fn(),
    onError: vi.fn(),
  }
}

describe('StreamPartProcessor', () => {
  describe('text-delta', () => {
    it('accumulates text content across multiple deltas', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'text-delta', text: 'Hello ' })
      processor.processPart({ type: 'text-delta', text: 'world' })

      expect(cb.onTextDelta).toHaveBeenCalledTimes(2)
      expect(cb.onTextDelta).toHaveBeenNthCalledWith(1, 'Hello ', 'Hello ')
      expect(cb.onTextDelta).toHaveBeenNthCalledWith(2, 'world', 'Hello world')
      expect(processor.getState().accumulatedContent).toBe('Hello world')
    })
  })

  describe('tool lifecycle', () => {
    it('accumulates tool input across start, deltas, and call', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-input-delta', id: 'tc1', delta: '{"path":' })
      processor.processPart({ type: 'tool-input-delta', id: 'tc1', delta: '"/tmp/f"}' })
      processor.processPart({ type: 'tool-call', id: 'tc1', toolName: 'readFile' })

      expect(cb.onToolStart).toHaveBeenCalledWith('tc1', 'readFile', 1)
      expect(cb.onToolInputDelta).toHaveBeenCalledTimes(2)
      expect(cb.onToolInputDelta).toHaveBeenNthCalledWith(2, 'tc1', '"/tmp/f"}', '{"path":"/tmp/f"}')
      expect(cb.onToolCall).toHaveBeenCalledWith('tc1', 'readFile', { path: '/tmp/f' })

      const state = processor.getState()
      expect(state.toolCalls.get('tc1')).toMatchObject({
        name: 'readFile',
        input: { path: '/tmp/f' },
      })
    })

    it('handles tool-result', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-call', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-result', id: 'tc1', toolName: 'readFile', output: 'file contents' })

      expect(cb.onToolResult).toHaveBeenCalledWith('tc1', 'file contents')
      expect(processor.getState().toolCalls.get('tc1')).toMatchObject({ status: 'completed' })
    })

    it('handles tool-error', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-call', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-error', id: 'tc1', toolName: 'readFile', error: new Error('ENOENT') })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'ENOENT' }))
      expect(processor.getState().toolCalls.get('tc1')).toMatchObject({ status: 'error' })
    })
  })

  describe('step tracking', () => {
    it('increments step on tool-input-start after a previous tool call', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'a' })
      processor.processPart({ type: 'tool-call', id: 'tc1', toolName: 'a' })
      processor.processPart({ type: 'tool-result', id: 'tc1', toolName: 'a', output: 'ok' })
      processor.processPart({ type: 'tool-input-start', id: 'tc2', toolName: 'b' })

      expect(cb.onStepStart).toHaveBeenCalledTimes(2)
      expect(cb.onStepStart).toHaveBeenNthCalledWith(1, 1)
      expect(cb.onStepStart).toHaveBeenNthCalledWith(2, 2)
      expect(processor.getState().currentStep).toBe(2)
    })
  })

  describe('tool ID aliases', () => {
    it('handles tool-result with toolCallId field', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-call', toolCallId: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-result', toolCallId: 'tc1', toolName: 'readFile', output: 'data' })

      expect(cb.onToolResult).toHaveBeenCalledWith('tc1', 'data')
      expect(processor.getState().toolCalls.get('tc1')).toMatchObject({ status: 'completed' })
    })

    it('handles tool-error with toolId field', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-call', toolCallId: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-error', toolId: 'tc1', toolName: 'readFile', error: new Error('fail') })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'fail' }))
      expect(processor.getState().toolCalls.get('tc1')).toMatchObject({ status: 'error' })
    })

    it('handles tool-input-delta with toolCallId field', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-input-delta', toolCallId: 'tc1', delta: '{"a":1}' })
      processor.processPart({ type: 'tool-call', toolCallId: 'tc1', toolName: 'x' })

      expect(cb.onToolCall).toHaveBeenCalledWith('tc1', 'x', { a: 1 })
    })
  })

  describe('error handling', () => {
    it('calls onError for error parts', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)
      const err = new Error('stream error')

      processor.processPart({ type: 'error', error: err })

      expect(cb.onError).toHaveBeenCalledWith(err)
    })

    it('falls back to raw string for malformed tool JSON', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-input-delta', id: 'tc1', delta: '{invalid json' })
      processor.processPart({ type: 'tool-call', id: 'tc1', toolName: 'x' })

      expect(cb.onToolCall).toHaveBeenCalledWith('tc1', 'x', '{invalid json')
    })
  })
})
