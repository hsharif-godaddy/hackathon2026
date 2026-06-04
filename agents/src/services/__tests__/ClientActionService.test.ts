/**
 * ClientActionService Tests
 *
 * Tests the WebSocket-based request/response service for client-side actions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ClientActionService } from '../ClientActionService.js'
import type { Socket } from 'socket.io'

describe('ClientActionService', () => {
  let service: ClientActionService
  let mockSocket: any
  const conversationId = 'test-conv-123'

  beforeEach(() => {
    // Create mock socket
    mockSocket = {
      id: 'socket-123',
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }

    service = new ClientActionService(mockSocket as Socket, conversationId)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should store socket and conversationId', () => {
      expect(service['socket']).toBe(mockSocket)
      expect(service['conversationId']).toBe(conversationId)
    })

    it('should register client_action_result event listener', () => {
      expect(mockSocket.on).toHaveBeenCalledWith('client_action_result', expect.any(Function))
    })

    it('should store bound handler reference for cleanup', () => {
      expect(service['boundHandler']).toBeDefined()
      expect(typeof service['boundHandler']).toBe('function')
    })
  })

  describe('executeAction', () => {
    it('should emit client_action message with correct parameters', async () => {
      const request = {
        action: 'publish',
        params: { appId: 'app-123', commitHash: 'abc123' },
        timeoutMs: 30000,
      }

      // Don't await - just trigger the call
      const promise = service.executeAction(request)

      // Verify message was emitted
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'message',
        expect.objectContaining({
          type: 'client_action',
          content: 'Requesting client to execute: publish',
          data: expect.objectContaining({
            action: 'publish',
            params: { appId: 'app-123', commitHash: 'abc123' },
            requestId: expect.any(String),
            conversationId: 'test-conv-123',
          }),
        })
      )

      // Extract requestId from emitted message
      const emitCall = mockSocket.emit.mock.calls[0]
      const requestId = emitCall[1].data.requestId

      // Simulate successful response
      const handler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'client_action_result')?.[1]
      handler({
        requestId,
        success: true,
        result: { commitHash: 'abc123', deploymentId: 'deploy-456' },
      })

      // Now await the promise
      const result = await promise

      expect(result).toEqual({
        success: true,
        result: { commitHash: 'abc123', deploymentId: 'deploy-456' },
      })
    })

    it('should generate unique requestId for each call', async () => {
      const request1 = { action: 'action1', params: {} }
      const request2 = { action: 'action2', params: {} }

      service.executeAction(request1)
      service.executeAction(request2)

      const requestId1 = mockSocket.emit.mock.calls[0][1].data.requestId
      const requestId2 = mockSocket.emit.mock.calls[1][1].data.requestId

      expect(requestId1).not.toBe(requestId2)
    })

    it('should handle successful response', async () => {
      const request = { action: 'test', params: { foo: 'bar' } }

      const promise = service.executeAction(request)

      // Get requestId from emitted message
      const requestId = mockSocket.emit.mock.calls[0][1].data.requestId

      // Simulate success
      const handler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'client_action_result')?.[1]
      handler({ requestId, success: true, result: { data: 'success' } })

      const result = await promise

      expect(result.success).toBe(true)
      expect(result.result).toEqual({ data: 'success' })
    })

    it('should handle error response', async () => {
      const request = { action: 'test', params: {} }

      const promise = service.executeAction(request)

      // Get requestId
      const requestId = mockSocket.emit.mock.calls[0][1].data.requestId

      // Simulate error
      const handler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'client_action_result')?.[1]
      handler({ requestId, success: false, error: 'Action failed' })

      const result = await promise

      expect(result.success).toBe(false)
      expect(result.error).toBe('Action failed')
    })

    it('should reject on timeout', async () => {
      vi.useFakeTimers()

      const request = { action: 'test', params: {}, timeoutMs: 5000 }

      const promise = service.executeAction(request)

      // Advance time past timeout
      vi.advanceTimersByTime(5001)

      await expect(promise).rejects.toThrow('Client action timed out after 5000ms')

      vi.useRealTimers()
    })

    it('should use default timeout of 30000ms', async () => {
      vi.useFakeTimers()

      const request = { action: 'test', params: {} }

      const promise = service.executeAction(request)

      // Advance to just before default timeout
      vi.advanceTimersByTime(29999)

      // Should not reject yet
      await Promise.race([promise, Promise.resolve('pending')]).then((val) => {
        expect(val).toBe('pending')
      })

      // Advance past timeout
      vi.advanceTimersByTime(2)

      await expect(promise).rejects.toThrow('Client action timed out after 30000ms')

      vi.useRealTimers()
    })

    it('should handle multiple concurrent requests', async () => {
      const request1 = { action: 'action1', params: { id: 1 } }
      const request2 = { action: 'action2', params: { id: 2 } }

      const promise1 = service.executeAction(request1)
      const promise2 = service.executeAction(request2)

      const requestId1 = mockSocket.emit.mock.calls[0][1].data.requestId
      const requestId2 = mockSocket.emit.mock.calls[1][1].data.requestId

      // Get handler
      const handler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'client_action_result')?.[1]

      // Resolve second request first
      handler({ requestId: requestId2, success: true, result: { id: 2 } })

      // Then resolve first request
      handler({ requestId: requestId1, success: true, result: { id: 1 } })

      const [result1, result2] = await Promise.all([promise1, promise2])

      expect(result1.result).toEqual({ id: 1 })
      expect(result2.result).toEqual({ id: 2 })
    })

    it('should clear timeout after successful response', async () => {
      vi.useFakeTimers()

      const request = { action: 'test', params: {}, timeoutMs: 5000 }

      const promise = service.executeAction(request)

      // Get requestId
      const requestId = mockSocket.emit.mock.calls[0][1].data.requestId

      // Resolve immediately
      const handler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'client_action_result')?.[1]
      handler({ requestId, success: true, result: {} })

      await promise

      // Advance time past timeout - should not cause issues
      vi.advanceTimersByTime(6000)

      vi.useRealTimers()
    })
  })

  describe('cleanup', () => {
    it('should remove event listener', () => {
      service.cleanup()

      expect(mockSocket.off).toHaveBeenCalledWith('client_action_result', service['boundHandler'])
    })

    it('should reject all pending requests', async () => {
      const request1 = { action: 'test1', params: {} }
      const request2 = { action: 'test2', params: {} }

      const promise1 = service.executeAction(request1).catch((e) => e)
      const promise2 = service.executeAction(request2).catch((e) => e)

      service.cleanup()

      const error1 = await promise1
      const error2 = await promise2

      expect(error1.message).toBe('Client action registry cleanup')
      expect(error2.message).toBe('Client action registry cleanup')
    })

    it('should clear all pending timeouts', () => {
      vi.useFakeTimers()

      const request = { action: 'test', params: {}, timeoutMs: 5000 }

      // Catch the rejection to prevent unhandled error
      service.executeAction(request).catch(() => {})

      expect(service.getPendingRequestIds().length).toBe(1)

      service.cleanup()

      expect(service.getPendingRequestIds().length).toBe(0)

      // Advance time - should not cause timeout rejection since it was cleaned up
      vi.advanceTimersByTime(6000)

      vi.useRealTimers()
    })

    it('should be safe to call multiple times', () => {
      service.cleanup()
      service.cleanup()

      expect(mockSocket.off).toHaveBeenCalledTimes(2)
    })

    it('should remove pending request after cleanup', () => {
      const request = { action: 'test', params: {} }

      // Catch the rejection to prevent unhandled error
      service.executeAction(request).catch(() => {})

      expect(service.getPendingRequestIds().length).toBe(1)

      service.cleanup()

      expect(service.getPendingRequestIds().length).toBe(0)
    })
  })

  describe('requiresUpgrade/reason passthrough', () => {
    it('should pass through requiresUpgrade and reason on failure', async () => {
      const request = { action: 'publish', params: { appId: 'app-123' } }

      const promise = service.executeAction(request)

      const requestId = mockSocket.emit.mock.calls[0][1].data.requestId
      const handler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'client_action_result')?.[1]
      handler({
        requestId,
        success: false,
        error: 'Upgrade required',
        requiresUpgrade: true,
        reason: 'no_subscription',
      })

      const result = await promise

      expect(result.success).toBe(false)
      expect(result.requiresUpgrade).toBe(true)
      expect(result.reason).toBe('no_subscription')
      expect(result.error).toBe('Upgrade required')
    })

    it('should not include requiresUpgrade/reason when not provided', async () => {
      const request = { action: 'publish', params: { appId: 'app-123' } }

      const promise = service.executeAction(request)

      const requestId = mockSocket.emit.mock.calls[0][1].data.requestId
      const handler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'client_action_result')?.[1]
      handler({
        requestId,
        success: false,
        error: 'Some other error',
      })

      const result = await promise

      expect(result.success).toBe(false)
      expect(result.requiresUpgrade).toBeUndefined()
      expect(result.reason).toBeUndefined()
    })
  })

  describe('handleClientActionResult', () => {
    it('should ignore results for unknown requestIds', async () => {
      const request = { action: 'test', params: {} }

      const promise = service.executeAction(request).catch((e) => e)

      // Send result with wrong requestId
      const handler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'client_action_result')?.[1]
      handler({ requestId: 'wrong-id', success: true, result: {} })

      // Original promise should not resolve yet
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Get correct requestId and resolve
      const requestId = mockSocket.emit.mock.calls[0][1].data.requestId
      handler({ requestId, success: true, result: {} })

      const result = await promise
      expect(result).toBeDefined()
      expect(result.success).toBe(true)
    })
  })
})
