import { describe, it, expect, vi } from 'vitest'
import { StreamPartProcessor } from '../stream-part-processor.js'
import type { PartProcessorCallbacks } from '../stream-part-processor.js'

function createMockCallbacks(): PartProcessorCallbacks {
  return {
    onTextDelta: vi.fn(),
    onToolStart: vi.fn(),
    onToolInputDelta: vi.fn(),
    onToolInputParseFailure: vi.fn(),
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
      expect(cb.onToolInputDelta).toHaveBeenNthCalledWith(2, 'tc1', '"/tmp/f"}', '{"path":"/tmp/f"}', 'readFile')
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

      // With no intermediate tool-input-delta, the empty-buffer branch of
      // `tool-call` should default parsed input to `{}` (not attempt
      // JSON.parse on an empty string).
      expect(cb.onToolCall).toHaveBeenCalledWith('tc1', 'readFile', {})
      expect(cb.onToolResult).toHaveBeenCalledWith('tc1', 'file contents', undefined, 'readFile')
      expect(processor.getState().toolCalls.get('tc1')).toMatchObject({ status: 'completed' })
    })

    it('fires onToolInputParseFailure (and still onToolCall with the raw string) when buffered JSON is invalid', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'media' })
      processor.processPart({ type: 'tool-input-delta', id: 'tc1', delta: '{"slot":"hero","extras":{' })
      processor.processPart({ type: 'tool-call', id: 'tc1', toolName: 'media' })

      expect(cb.onToolInputParseFailure).toHaveBeenCalledWith('tc1', 'media', '{"slot":"hero","extras":{')
      // Wire-shape fallback stays at the call site, so the raw string still flows through onToolCall.
      expect(cb.onToolCall).toHaveBeenCalledWith('tc1', 'media', '{"slot":"hero","extras":{')
    })

    it('handles tool-error', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-call', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-error', id: 'tc1', toolName: 'readFile', error: new Error('ENOENT') })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'ENOENT' }), undefined, 'readFile')
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

      expect(cb.onToolResult).toHaveBeenCalledWith('tc1', 'data', undefined, 'readFile')
      expect(processor.getState().toolCalls.get('tc1')).toMatchObject({ status: 'completed' })
    })

    it('handles tool-error with toolId field', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-call', toolCallId: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-error', toolId: 'tc1', toolName: 'readFile', error: new Error('fail') })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'fail' }), undefined, 'readFile')
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

  describe('tool-error payloads', () => {
    it('preserves .message for plain error-shaped objects', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-error', id: 'tc1', error: { message: 'Tool timed out' } })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'Tool timed out' }), undefined, 'x')
      expect(processor.getState().toolCalls.get('tc1')).toMatchObject({ status: 'error', error: 'Tool timed out' })
    })

    it('uses raw string payloads', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-error', id: 'tc1', error: 'plain string failure' })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'plain string failure' }), undefined, 'x')
    })

    it('falls back to generic message for null payload', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-error', id: 'tc1', error: null })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'Tool execution error' }), undefined, 'x')
    })

    it('falls back to generic message for undefined payload', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-error', id: 'tc1' })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'Tool execution error' }), undefined, 'x')
    })

    it('falls back to generic message for opaque payloads', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-error', id: 'tc1', error: { code: 500 } })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'Tool execution error' }), undefined, 'x')
    })

    it('falls back to generic message for empty-string payload', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-error', id: 'tc1', error: '' })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'Tool execution error' }), undefined, 'x')
    })
  })

  describe('tool-input-delta toolName forwarding', () => {
    it('forwards part.toolName directly from the SDK payload', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-input-delta', id: 'tc1', toolName: 'readFile', delta: '{}' })

      expect(cb.onToolInputDelta).toHaveBeenCalledWith('tc1', '{}', '{}', 'readFile')
    })

    it('falls back to the registered name when part.toolName is missing', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-input-delta', id: 'tc1', delta: '{}' })

      expect(cb.onToolInputDelta).toHaveBeenCalledWith('tc1', '{}', '{}', 'readFile')
    })

    it('emits undefined when neither part.toolName nor a registered record is available', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-delta', id: 'tc1', delta: '{}' })

      expect(cb.onToolInputDelta).toHaveBeenCalledWith('tc1', '{}', '{}', undefined)
    })
  })

  describe('SDK-normalized input forwarding', () => {
    it('forwards part.input to onToolResult and overwrites buffered input', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-input-delta', id: 'tc1', delta: '{"raw":1}' })
      processor.processPart({ type: 'tool-call', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-result', id: 'tc1', input: { coerced: 1, defaulted: 'yes' }, output: 'ok' })

      expect(cb.onToolResult).toHaveBeenCalledWith('tc1', 'ok', { coerced: 1, defaulted: 'yes' }, 'x')
      expect(processor.getToolCall('tc1')).toMatchObject({ input: { coerced: 1, defaulted: 'yes' } })
    })

    it('forwards part.input to onToolError', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-error', id: 'tc1', input: { schemaValid: true }, error: 'boom' })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'boom' }), { schemaValid: true }, 'x')
      // Pin the live-state write symmetric to the tool-result path: the
      // processor persists SDK-supplied input onto the record so consumers
      // reading `getToolCall(id)` post-callback see the coerced value.
      expect(processor.getToolCall('tc1')).toMatchObject({ input: { schemaValid: true } })
    })

    // `null` input means the SDK validated and accepted a nullable argument;
    // `undefined` means the SDK did not supply input for this part. A
    // consumer writing `sdkInput ?? fallback` would silently mishandle the
    // null case, so these tests pin the distinction.
    it('forwards part.input=null to onToolResult as null (not undefined)', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-result', id: 'tc1', input: null, output: 'ok' })

      expect(cb.onToolResult).toHaveBeenCalledWith('tc1', 'ok', null, 'x')
      expect(processor.getToolCall('tc1')).toMatchObject({ input: null })
    })

    it('forwards part.input=null to onToolError as null (not undefined)', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'x' })
      processor.processPart({ type: 'tool-error', id: 'tc1', input: null, error: 'boom' })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'boom' }), null, 'x')
      expect(processor.getToolCall('tc1')).toMatchObject({ input: null })
    })
  })

  describe('tool ID preference', () => {
    it('resolves under toolCallId when part.id is absent on tool-call/tool-result', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-input-delta', id: 'tc1', delta: '{"v":1}' })
      processor.processPart({ type: 'tool-call', toolCallId: 'tc1', toolName: 'readFile' })
      processor.processPart({ type: 'tool-result', toolCallId: 'tc1', output: 'ok' })

      expect(processor.getToolCall('tc1')).toMatchObject({ status: 'completed', input: { v: 1 } })
    })

    it('prefers part.id over part.toolCallId for tool-call', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'primary', toolName: 'x' })
      processor.processPart({ type: 'tool-input-delta', id: 'primary', delta: '{"v":1}' })
      processor.processPart({ type: 'tool-call', id: 'primary', toolCallId: 'alias', toolName: 'x' })
      processor.processPart({ type: 'tool-result', id: 'primary', toolCallId: 'alias', output: 'ok' })

      expect(processor.getToolCall('primary')).toMatchObject({ status: 'completed', input: { v: 1 } })
      expect(processor.getToolCall('alias')).toBeUndefined()
    })
  })

  describe('out-of-order tool parts', () => {
    // The processor fires onToolResult/onToolError even when no prior
    // tool-input-start registered a ToolCallRecord. Consumers should NOT
    // assume `getToolCall(id)` is defined after a result/error callback —
    // these tests pin that contract so a regression wrapping the callback
    // in an `if (toolCall)` would be caught.
    it('fires onToolResult without a prior tool-input-start and leaves getToolCall undefined', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-result', id: 'orphan', output: 'ok' })

      expect(cb.onToolResult).toHaveBeenCalledWith('orphan', 'ok', undefined, undefined)
      expect(processor.getToolCall('orphan')).toBeUndefined()
    })

    it('fires onToolError without a prior tool-input-start and leaves getToolCall undefined', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-error', id: 'orphan', error: new Error('boom') })

      expect(cb.onToolError).toHaveBeenCalledWith('orphan', expect.objectContaining({ message: 'boom' }), undefined, undefined)
      expect(processor.getToolCall('orphan')).toBeUndefined()
    })

    // Orphan parts CAN carry `toolName` from the SDK payload — the processor
    // forwards it even when no prior tool-input-start registered a record,
    // so consumers can label telemetry/events with the real tool name
    // instead of falling back to 'unknown'.
    it('forwards part.toolName on orphan tool-result', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-result', id: 'orphan', toolName: 'readFile', output: 'ok' })

      expect(cb.onToolResult).toHaveBeenCalledWith('orphan', 'ok', undefined, 'readFile')
    })

    it('forwards part.toolName on orphan tool-error', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-error', id: 'orphan', toolName: 'readFile', error: new Error('boom') })

      expect(cb.onToolError).toHaveBeenCalledWith('orphan', expect.objectContaining({ message: 'boom' }), undefined, 'readFile')
    })

    // Fallback path: when `part.toolName` is absent, the processor should
    // use the name registered via the prior `tool-input-start`. Symmetric
    // with the `onToolInputDelta` fallback already covered in its own
    // describe block.
    it('falls back to the registered record name when tool-result omits part.toolName', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'registered' })
      processor.processPart({ type: 'tool-result', id: 'tc1', output: 'ok' })

      expect(cb.onToolResult).toHaveBeenCalledWith('tc1', 'ok', undefined, 'registered')
    })

    it('falls back to the registered record name when tool-error omits part.toolName', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'tool-input-start', id: 'tc1', toolName: 'registered' })
      processor.processPart({ type: 'tool-error', id: 'tc1', error: new Error('boom') })

      expect(cb.onToolError).toHaveBeenCalledWith('tc1', expect.objectContaining({ message: 'boom' }), undefined, 'registered')
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

    it('wraps non-Error error-part payloads via new Error(String(...))', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'error', error: 'plain string failure' })

      const received = (cb.onError as any).mock.calls[0][0]
      expect(received).toBeInstanceOf(Error)
      expect(received.message).toBe('plain string failure')
    })

    // `type: 'error'` and `tool-error` now share `extractToolError`, so
    // structured payloads with `.message` preserve that message on both paths.
    it('preserves .message for structured error-part objects', () => {
      const cb = createMockCallbacks()
      const processor = new StreamPartProcessor(cb)

      processor.processPart({ type: 'error', error: { message: 'budget exceeded', statusCode: 429 } })

      const received = (cb.onError as any).mock.calls[0][0]
      expect(received).toBeInstanceOf(Error)
      expect(received.message).toBe('budget exceeded')
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
