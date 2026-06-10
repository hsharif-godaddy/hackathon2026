/**
 * ClientActionHandler Tests
 *
 * Tests the WebSocket message handler for client_action messages.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublishDenialReason, PublishUpgradeRequiredError } from '@airo/shared/publish'

import { createMockMessageContext } from './testUtils'
import { clientActionExecutors } from '../../actions'
import { ClientActionHandler } from '../ClientActionHandler'
import type { WebSocketMessage } from '../types'

// Mock the clientActionExecutors
vi.mock('../../actions', () => ({
  clientActionExecutors: {
    publish: vi.fn(),
    testAction: vi.fn(),
  },
}))

describe('ClientActionHandler', () => {
  const handler = new ClientActionHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should have correct type', () => {
    expect(handler.type).toBe('client_action')
  })

  describe('message validation', () => {
    it('should reject message with missing data field', async () => {
      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
      } as any

      await handler.handle(data, context)

      // Should not call executor or send result
      expect(context.socket.emit).not.toHaveBeenCalled()
    })

    it('should reject message with non-object data field', async () => {
      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: 'not an object' as any,
      }

      await handler.handle(data, context)

      expect(context.socket.emit).not.toHaveBeenCalled()
    })

    it('should reject message with missing action', async () => {
      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          params: {},
          requestId: 'req-123',
        } as any,
      }

      await handler.handle(data, context)

      expect(context.socket.emit).not.toHaveBeenCalled()
    })

    it('should reject message with non-string action', async () => {
      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 123 as any,
          params: {},
          requestId: 'req-123',
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).not.toHaveBeenCalled()
    })

    it('should reject message with missing requestId', async () => {
      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: {},
        } as any,
      }

      await handler.handle(data, context)

      expect(context.socket.emit).not.toHaveBeenCalled()
    })

    it('should reject message with non-string requestId', async () => {
      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: {},
          requestId: 123 as any,
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).not.toHaveBeenCalled()
    })

    it('should accept valid message with all required fields', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ success: true })
      vi.mocked(clientActionExecutors).publish = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: { appId: 'app-123' },
          requestId: 'req-123',
        },
      }

      await handler.handle(data, context)

      expect(mockExecutor).toHaveBeenCalled()
      expect(context.socket.emit).toHaveBeenCalledWith(
        'client_action_result',
        expect.objectContaining({
          requestId: 'req-123',
          success: true,
        })
      )
    })
  })

  describe('executor dispatch', () => {
    it('should call correct executor for action', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ data: 'result' })
      vi.mocked(clientActionExecutors).publish = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: { appId: 'app-123', commitHash: 'abc123' },
          requestId: 'req-123',
        },
      }

      await handler.handle(data, context)

      expect(mockExecutor).toHaveBeenCalledWith(
        { appId: 'app-123', commitHash: 'abc123' },
        context,
        'req-123'
      )
    })

    it('should pass full context to executor', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({})
      vi.mocked(clientActionExecutors).testAction = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'testAction',
          params: { foo: 'bar' },
          requestId: 'req-456',
        },
      }

      await handler.handle(data, context)

      expect(mockExecutor).toHaveBeenCalledWith({ foo: 'bar' }, context, 'req-456')

      // Verify context has expected properties
      const passedContext = mockExecutor.mock.calls[0][1]
      expect(passedContext.socket).toBeDefined()
      expect(passedContext.currentAppId).toBe('app-123')
      expect(passedContext.actions).toBeDefined()
      expect(passedContext.helpers).toBeDefined()
    })

    it('should handle unknown action', async () => {
      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'unknownAction',
          params: {},
          requestId: 'req-789',
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).toHaveBeenCalledWith(
        'client_action_result',
        expect.objectContaining({
          requestId: 'req-789',
          success: false,
          error: 'Unknown action: unknownAction',
        })
      )
    })
  })

  describe('result handling', () => {
    it('should send success result', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        commitHash: 'abc123',
        deploymentId: 'deploy-456',
      })
      vi.mocked(clientActionExecutors).publish = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: { appId: 'app-123' },
          requestId: 'req-success',
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).toHaveBeenCalledWith('client_action_result', {
        requestId: 'req-success',
        success: true,
        result: {
          commitHash: 'abc123',
          deploymentId: 'deploy-456',
        },
      })
    })

    it('should send error result when executor throws', async () => {
      const mockExecutor = vi.fn().mockRejectedValue(new Error('Publish failed'))
      vi.mocked(clientActionExecutors).publish = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: { appId: 'app-123' },
          requestId: 'req-error',
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).toHaveBeenCalledWith('client_action_result', {
        requestId: 'req-error',
        success: false,
        error: 'Publish failed',
      })
    })

    it('should emit requiresUpgrade and reason when executor throws PublishUpgradeRequiredError', async () => {
      const mockExecutor = vi.fn().mockRejectedValue(
        new PublishUpgradeRequiredError(PublishDenialReason.NoSubscription)
      )
      vi.mocked(clientActionExecutors).publish = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: { appId: 'app-123' },
          requestId: 'req-upgrade',
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).toHaveBeenCalledWith('client_action_result', {
        requestId: 'req-upgrade',
        success: false,
        error: 'Publishing requires a paid Airo Builder plan. Upgrade to continue and make your app live.',
        requiresUpgrade: true,
        reason: 'no_subscription',
      })
    })

    it('should emit requiresUpgrade with publish_limit_reached reason', async () => {
      const mockExecutor = vi.fn().mockRejectedValue(
        new PublishUpgradeRequiredError(PublishDenialReason.PublishLimitReached, 'Publish limit reached')
      )
      vi.mocked(clientActionExecutors).publish = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: { appId: 'app-123' },
          requestId: 'req-limit',
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).toHaveBeenCalledWith('client_action_result', {
        requestId: 'req-limit',
        success: false,
        error: 'Publish limit reached',
        requiresUpgrade: true,
        reason: 'publish_limit_reached',
      })
    })

    it('should NOT include requiresUpgrade for regular errors', async () => {
      const mockExecutor = vi.fn().mockRejectedValue(new Error('Network failure'))
      vi.mocked(clientActionExecutors).publish = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'publish',
          params: { appId: 'app-123' },
          requestId: 'req-regular',
        },
      }

      await handler.handle(data, context)

      const emitted = (context.socket.emit as any).mock.calls[0][1]
      expect(emitted.requiresUpgrade).toBeUndefined()
      expect(emitted.reason).toBeUndefined()
    })

    it('should handle non-Error exceptions', async () => {
      const mockExecutor = vi.fn().mockRejectedValue('String error')
      vi.mocked(clientActionExecutors).testAction = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'testAction',
          params: {},
          requestId: 'req-string-error',
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).toHaveBeenCalledWith('client_action_result', {
        requestId: 'req-string-error',
        success: false,
        error: 'String error',
      })
    })

    it('should send result with undefined result field when executor returns void', async () => {
      const mockExecutor = vi.fn().mockResolvedValue(undefined)
      vi.mocked(clientActionExecutors).testAction = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'testAction',
          params: {},
          requestId: 'req-void',
        },
      }

      await handler.handle(data, context)

      expect(context.socket.emit).toHaveBeenCalledWith('client_action_result', {
        requestId: 'req-void',
        success: true,
        result: undefined,
      })
    })
  })

  describe('params handling', () => {
    it('should handle empty params object', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({})
      vi.mocked(clientActionExecutors).testAction = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'testAction',
          params: {},
          requestId: 'req-empty-params',
        },
      }

      await handler.handle(data, context)

      expect(mockExecutor).toHaveBeenCalledWith({}, context, 'req-empty-params')
      expect(context.socket.emit).toHaveBeenCalledWith(
        'client_action_result',
        expect.objectContaining({ success: true })
      )
    })

    it('should handle undefined params as empty object', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({})
      vi.mocked(clientActionExecutors).testAction = mockExecutor

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'testAction',
          requestId: 'req-no-params',
        } as any,
      }

      await handler.handle(data, context)

      expect(mockExecutor).toHaveBeenCalledWith(undefined, context, 'req-no-params')
    })

    it('should pass complex params object to executor', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({})
      vi.mocked(clientActionExecutors).testAction = mockExecutor

      const complexParams = {
        appId: 'app-123',
        options: {
          nested: true,
          array: [1, 2, 3],
        },
        optional: 'value',
      }

      const context = createMockMessageContext()
      const data: WebSocketMessage = {
        type: 'client_action',
        content: 'test',
        data: {
          action: 'testAction',
          params: complexParams,
          requestId: 'req-complex',
        },
      }

      await handler.handle(data, context)

      expect(mockExecutor).toHaveBeenCalledWith(complexParams, context, 'req-complex')
    })
  })
})
