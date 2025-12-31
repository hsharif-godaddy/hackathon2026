/**
 * MessageHandlerRegistry Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageHandlerRegistry } from '../MessageHandlerRegistry'
import type { MessageContext, MessageHandler, WebSocketMessage } from '../types'

describe('MessageHandlerRegistry', () => {
  let registry: MessageHandlerRegistry
  let mockContext: MessageContext

  beforeEach(() => {
    registry = new MessageHandlerRegistry()
    mockContext = {
      socket: { id: 'socket-123' } as any,
      currentAppId: 'app-1',
      actions: {},
      helpers: {},
      refs: {},
    } as any
  })

  describe('register', () => {
    it('should register a handler', () => {
      const mockHandler: MessageHandler = {
        type: 'test_message',
        handle: vi.fn(),
      }

      registry.register(mockHandler)

      expect(registry.hasHandler('test_message')).toBe(true)
    })

    it('should allow overwriting an existing handler', () => {
      const handler1: MessageHandler = {
        type: 'test',
        handle: vi.fn(),
      }
      const handler2: MessageHandler = {
        type: 'test',
        handle: vi.fn(),
      }

      registry.register(handler1)
      registry.register(handler2)

      expect(registry.hasHandler('test')).toBe(true)
    })
  })

  describe('dispatch', () => {
    it('should dispatch message to correct handler', async () => {
      const mockHandle = vi.fn()
      const handler: MessageHandler = {
        type: 'chunk',
        handle: mockHandle,
      }

      registry.register(handler)

      const message: WebSocketMessage = {
        type: 'chunk',
        content: 'test content',
        data: {},
      }

      await registry.dispatch('chunk', message, mockContext)

      expect(mockHandle).toHaveBeenCalledWith(message, mockContext, undefined)
    })

    it('should pass ack callback to handler', async () => {
      const mockHandle = vi.fn()
      const handler: MessageHandler = {
        type: 'conversation_info',
        handle: mockHandle,
      }

      registry.register(handler)

      const message: WebSocketMessage = {
        type: 'conversation_info',
        content: '',
        data: {},
      }
      const mockAck = vi.fn()

      await registry.dispatch('conversation_info', message, mockContext, mockAck)

      expect(mockHandle).toHaveBeenCalledWith(message, mockContext, mockAck)
    })

    it('should not throw for unknown message type', async () => {
      const message: WebSocketMessage = {
        type: 'unknown_type',
        content: '',
        data: {},
      }

      await expect(registry.dispatch('unknown_type', message, mockContext)).resolves.not.toThrow()
    })

    it('should propagate handler errors', async () => {
      const error = new Error('Handler error')
      const handler: MessageHandler = {
        type: 'error_test',
        handle: vi.fn().mockRejectedValue(error),
      }

      registry.register(handler)

      const message: WebSocketMessage = {
        type: 'error_test',
        content: '',
        data: {},
      }

      await expect(registry.dispatch('error_test', message, mockContext)).rejects.toThrow('Handler error')
    })
  })

  describe('hasHandler', () => {
    it('should return true for registered handler', () => {
      const handler: MessageHandler = {
        type: 'test',
        handle: vi.fn(),
      }

      registry.register(handler)

      expect(registry.hasHandler('test')).toBe(true)
    })

    it('should return false for unregistered handler', () => {
      expect(registry.hasHandler('nonexistent')).toBe(false)
    })
  })

  describe('getRegisteredTypes', () => {
    it('should return all registered types', () => {
      const handler1: MessageHandler = {
        type: 'chunk',
        handle: vi.fn(),
      }
      const handler2: MessageHandler = {
        type: 'complete',
        handle: vi.fn(),
      }

      registry.register(handler1)
      registry.register(handler2)

      const types = registry.getRegisteredTypes()
      expect(types).toContain('chunk')
      expect(types).toContain('complete')
      expect(types).toHaveLength(2)
    })

    it('should return empty array for no registered handlers', () => {
      expect(registry.getRegisteredTypes()).toEqual([])
    })
  })

  describe('clear', () => {
    it('should remove all registered handlers', () => {
      const handler: MessageHandler = {
        type: 'test',
        handle: vi.fn(),
      }

      registry.register(handler)
      expect(registry.hasHandler('test')).toBe(true)

      registry.clear()
      expect(registry.hasHandler('test')).toBe(false)
      expect(registry.getRegisteredTypes()).toEqual([])
    })
  })
})
