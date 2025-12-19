import { describe, it, expect, beforeEach, vi } from 'vitest'
import { APMSubscriber, type APMAgent, type APMSpan, type APMTransaction } from '../apm-subscriber.js'
import type { StreamingEvent } from '../../interfaces.js'

/**
 * Mock APM span for testing
 */
class MockAPMSpan {
  name: string
  type: string
  subtype: string
  labels: Record<string, string> = {}
  outcome?: string
  ended: boolean = false

  constructor(name: string, type: string, subtype: string) {
    this.name = name
    this.type = type
    this.subtype = subtype
  }

  addLabels(labels: Record<string, string>): void {
    this.labels = { ...this.labels, ...labels }
  }

  setOutcome(outcome: string): void {
    this.outcome = outcome
  }

  end(): void {
    this.ended = true
  }
}

/**
 * Mock APM transaction for testing
 */
class MockAPMTransaction {
  createdSpans: MockAPMSpan[] = []

  startSpan(name: string, type: string, subtype: string): MockAPMSpan {
    const span = new MockAPMSpan(name, type, subtype)
    this.createdSpans.push(span)
    return span
  }
}

/**
 * Mock APM agent for testing
 */
class MockAPMAgent {
  createdSpans: MockAPMSpan[] = []

  startSpan(name: string, type: string, subtype: string): MockAPMSpan {
    const span = new MockAPMSpan(name, type, subtype)
    this.createdSpans.push(span)
    return span
  }
}

/**
 * Helper to create test streaming event
 */
function createTestEvent(overrides?: Partial<StreamingEvent>): StreamingEvent {
  return {
    id: 'event-123',
    conversationId: 'conv1',
    sequence: 0,
    type: 'chunk',
    content: 'Test content',
    data: {},
    timestamp: new Date(),
    agentName: 'test-agent',
    ...overrides
  }
}

describe('APMSubscriber', () => {
  let apmAgent: MockAPMAgent
  let activeSpans: Map<string, MockAPMSpan>
  let transaction: MockAPMTransaction
  let getActiveTransaction: (socketId: string) => MockAPMTransaction | undefined
  let subscriber: APMSubscriber

  beforeEach(() => {
    apmAgent = new MockAPMAgent()
    activeSpans = new Map()
    transaction = new MockAPMTransaction()
    getActiveTransaction = vi.fn((socketId: string) => transaction)
    subscriber = new APMSubscriber(apmAgent, activeSpans, getActiveTransaction, 'socket-123')
  })

  describe('constructor', () => {
    it('initializes with APM agent and span map', () => {
      expect(subscriber.id).toBe('apm-socket-123')
      expect(subscriber).toBeInstanceOf(APMSubscriber)
    })

    it('uses global ID when no socket ID provided', () => {
      const globalSubscriber = new APMSubscriber(apmAgent, activeSpans)
      expect(globalSubscriber.id).toBe('apm-global')
    })
  })

  describe('onEvent', () => {
    it('starts span on tool_start event', async () => {
      const event = createTestEvent({
        type: 'tool_start',
        data: {
          toolId: 'tool-123',
          toolName: 'fileEdit'
        }
      })

      await subscriber.onEvent(event)

      expect(transaction.createdSpans).toHaveLength(1)
      expect(transaction.createdSpans[0].name).toBe('Tool: fileEdit')
      expect(transaction.createdSpans[0].type).toBe('tool_execution')
      expect(transaction.createdSpans[0].subtype).toBe('agent')
    })

    it('ends span on tool_result event with success', async () => {
      // Start span first
      const startEvent = createTestEvent({
        type: 'tool_start',
        data: {
          toolId: 'tool-123',
          toolName: 'fileEdit'
        }
      })
      await subscriber.onEvent(startEvent)

      const span = activeSpans.get('socket-123:tool-123')!
      expect(span).toBeDefined()
      expect(span.ended).toBe(false)

      // End span with success
      const endEvent = createTestEvent({
        type: 'tool_result',
        data: {
          toolId: 'tool-123',
          is_error: false
        }
      })
      await subscriber.onEvent(endEvent)

      expect(span.outcome).toBe('success')
      expect(span.ended).toBe(true)
      expect(activeSpans.has('socket-123:tool-123')).toBe(false)
    })

    it('ends span on tool_result event with failure', async () => {
      // Start span first
      const startEvent = createTestEvent({
        type: 'tool_start',
        data: {
          toolId: 'tool-456',
          toolName: 'gitTool'
        }
      })
      await subscriber.onEvent(startEvent)

      const span = activeSpans.get('socket-123:tool-456')!

      // End span with failure
      const endEvent = createTestEvent({
        type: 'tool_result',
        data: {
          toolId: 'tool-456',
          is_error: true,
          error: 'Git command failed'
        }
      })
      await subscriber.onEvent(endEvent)

      expect(span.outcome).toBe('failure')
      expect(span.labels.error_message).toBe('Git command failed')
      expect(span.ended).toBe(true)
    })

    it('ignores non-tool events', async () => {
      const chunkEvent = createTestEvent({ type: 'chunk' })
      await subscriber.onEvent(chunkEvent)

      const stepEvent = createTestEvent({ type: 'step_start' })
      await subscriber.onEvent(stepEvent)

      expect(transaction.createdSpans).toHaveLength(0)
      expect(activeSpans.size).toBe(0)
    })

    it('adds labels to span (tool_id, tool_name, socket_id)', async () => {
      const event = createTestEvent({
        type: 'tool_start',
        data: {
          toolId: 'tool-789',
          toolName: 'terminalCommand'
        }
      })

      await subscriber.onEvent(event)

      const span = activeSpans.get('socket-123:tool-789')!
      expect(span.labels).toEqual({
        tool_id: 'tool-789',
        tool_name: 'terminalCommand',
        socket_id: 'socket-123',
        conversation_id: 'conv1'
      })
    })

    it('handles tool data with nested structure', async () => {
      // Some events have tool data nested under 'tool' property
      const event = createTestEvent({
        type: 'tool_start',
        data: {
          tool: {
            id: 'tool-nested',
            name: 'nestedTool'
          }
        }
      })

      await subscriber.onEvent(event)

      expect(transaction.createdSpans).toHaveLength(1)
      const span = activeSpans.get('socket-123:tool-nested')!
      expect(span).toBeDefined()
      expect(span.labels.tool_id).toBe('tool-nested')
      expect(span.labels.tool_name).toBe('nestedTool')
    })
  })

  describe('filter', () => {
    it('returns true only for tool_* events', () => {
      expect(subscriber.filter(createTestEvent({ type: 'tool_start' }))).toBe(true)
      expect(subscriber.filter(createTestEvent({ type: 'tool_result' }))).toBe(true)

      expect(subscriber.filter(createTestEvent({ type: 'chunk' }))).toBe(false)
      expect(subscriber.filter(createTestEvent({ type: 'tool_input_delta' }))).toBe(false)
      expect(subscriber.filter(createTestEvent({ type: 'tool_call' }))).toBe(false)
      expect(subscriber.filter(createTestEvent({ type: 'step_start' }))).toBe(false)
      expect(subscriber.filter(createTestEvent({ type: 'complete' }))).toBe(false)
    })
  })

  describe('onError', () => {
    it('logs error without affecting stream', () => {
      const error = new Error('APM tracking failed')

      // Should not throw
      expect(() => subscriber.onError(error)).not.toThrow()
    })
  })

  describe('integration scenarios', () => {
    it('tracks complete tool execution lifecycle', async () => {
      // Start tool execution
      await subscriber.onEvent(createTestEvent({
        type: 'tool_start',
        data: { toolId: 'tool-complete', toolName: 'fileEdit' }
      }))

      const span = activeSpans.get('socket-123:tool-complete')!
      expect(span.ended).toBe(false)

      // End tool execution
      await subscriber.onEvent(createTestEvent({
        type: 'tool_result',
        data: { toolId: 'tool-complete', is_error: false }
      }))

      expect(span.ended).toBe(true)
      expect(span.outcome).toBe('success')
      expect(activeSpans.size).toBe(0)
    })

    it('handles multiple concurrent tool executions', async () => {
      // Start first tool
      await subscriber.onEvent(createTestEvent({
        type: 'tool_start',
        data: { toolId: 'tool-1', toolName: 'fileEdit' }
      }))

      // Start second tool
      await subscriber.onEvent(createTestEvent({
        type: 'tool_start',
        data: { toolId: 'tool-2', toolName: 'gitTool' }
      }))

      expect(activeSpans.size).toBe(2)

      // End first tool
      await subscriber.onEvent(createTestEvent({
        type: 'tool_result',
        data: { toolId: 'tool-1', is_error: false }
      }))

      expect(activeSpans.size).toBe(1)

      // End second tool
      await subscriber.onEvent(createTestEvent({
        type: 'tool_result',
        data: { toolId: 'tool-2', is_error: false }
      }))

      expect(activeSpans.size).toBe(0)
    })

    it('creates standalone span when no transaction available', async () => {
      // Subscriber without transaction
      const noTransactionSubscriber = new APMSubscriber(apmAgent, activeSpans, undefined, 'socket-456')

      await noTransactionSubscriber.onEvent(createTestEvent({
        type: 'tool_start',
        data: { toolId: 'tool-standalone', toolName: 'standalone' }
      }))

      // Should create span directly on agent
      expect(apmAgent.createdSpans).toHaveLength(1)
      expect(apmAgent.createdSpans[0].name).toBe('Tool: standalone')
    })

    it('handles missing tool data gracefully', async () => {
      // Event without toolId/toolName should not create span
      await subscriber.onEvent(createTestEvent({
        type: 'tool_start',
        data: {}
      }))

      expect(transaction.createdSpans).toHaveLength(0)
      expect(activeSpans.size).toBe(0)
    })

    it('handles tool_result without corresponding start gracefully', async () => {
      // Try to end span that was never started
      await subscriber.onEvent(createTestEvent({
        type: 'tool_result',
        data: { toolId: 'non-existent', is_error: false }
      }))

      // Should not throw or cause issues
      expect(activeSpans.size).toBe(0)
    })
  })
})
