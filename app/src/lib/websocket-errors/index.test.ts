import { describe, expect, it } from 'vitest'

import {
  getUserMessage,
  isRetryableError,
  isWebSocketError,
  toWebSocketError,
  WebSocketError,
  WebSocketErrorCode,
} from './index'

describe('WebSocket Error System', () => {
  describe('WebSocketError', () => {
    it('should create error with default values', () => {
      const error = new WebSocketError(WebSocketErrorCode.CONNECTION_FAILED)

      expect(error.code).toBe(WebSocketErrorCode.CONNECTION_FAILED)
      expect(error.name).toBe('WebSocketError')
      expect(error.message).toBe(WebSocketErrorCode.CONNECTION_FAILED)
      expect(error.userMessage).toBe('Could not connect to the server. Please check your internet connection.')
      expect(error.retryable).toBe(false)
      expect(error.context).toHaveProperty('timestamp')
    })

    it('should create error with custom options', () => {
      const context = { appId: 'test-app', socketId: 'socket-123' }
      const error = new WebSocketError(WebSocketErrorCode.MESSAGE_SEND_FAILED, {
        message: 'Internal error details',
        context,
        userMessage: 'Custom user message',
        retryable: true
      })

      expect(error.message).toBe('Internal error details')
      expect(error.userMessage).toBe('Custom user message')
      expect(error.retryable).toBe(true)
      expect(error.context.appId).toBe('test-app')
      expect(error.context.socketId).toBe('socket-123')
    })

    it('should include cause error', () => {
      const cause = new Error('Original error')
      const error = new WebSocketError(WebSocketErrorCode.CONNECTION_FAILED, { cause })

      expect(error.cause).toBe(cause)
    })

    it('should convert to log object', () => {
      const error = new WebSocketError(WebSocketErrorCode.AUTH_FAILED, {
        context: { appId: 'test-app' }
      })

      const logObj = error.toLogObject()

      expect(logObj.code).toBe(WebSocketErrorCode.AUTH_FAILED)
      expect(logObj.message).toBe(WebSocketErrorCode.AUTH_FAILED)
      expect(logObj.userMessage).toBe('Authentication failed. Please refresh the page.')
      expect(logObj.retryable).toBe(false)
      expect(logObj.context).toEqual(expect.objectContaining({ appId: 'test-app' }))
      expect(logObj.timestamp).toBeTypeOf('number')
      expect(logObj.stack).toBeDefined()
    })

    it('should convert to JSON', () => {
      const error = new WebSocketError(WebSocketErrorCode.CONNECTION_TIMEOUT)

      const json = error.toJSON()

      expect(json.code).toBe(WebSocketErrorCode.CONNECTION_TIMEOUT)
      expect(json.message).toBe('Connection timed out. Please try again.')
      expect(json.retryable).toBe(true)
      expect(json.timestamp).toBeTypeOf('number')
    })

    describe('default user messages', () => {
      const testCases: Array<[WebSocketErrorCode, string]> = [
        [WebSocketErrorCode.CONNECTION_FAILED, 'Could not connect to the server'],
        [WebSocketErrorCode.CONNECTION_TIMEOUT, 'Connection timed out'],
        [WebSocketErrorCode.CONNECTION_LOST, 'Connection lost'],
        [WebSocketErrorCode.AUTH_FAILED, 'Authentication failed'],
        [WebSocketErrorCode.MESSAGE_SEND_FAILED, 'Failed to send message'],
        [WebSocketErrorCode.MESSAGE_EMPTY, 'Cannot send an empty message'],
        [WebSocketErrorCode.VISUAL_CONTEXT_CAPTURE_FAILED, 'Could not capture page preview'],
        [WebSocketErrorCode.INVALID_STATE, 'Connection is in an invalid state'],
        [WebSocketErrorCode.UNKNOWN_ERROR, 'An unexpected error occurred'],
      ]

      testCases.forEach(([code, expectedSubstring]) => {
        it(`should have user message for ${code}`, () => {
          const error = new WebSocketError(code)
          expect(error.userMessage).toContain(expectedSubstring)
        })
      })
    })

    describe('retryability', () => {
      it('should mark connection timeout as retryable', () => {
        const error = new WebSocketError(WebSocketErrorCode.CONNECTION_TIMEOUT)
        expect(error.retryable).toBe(true)
      })

      it('should mark connection lost as retryable', () => {
        const error = new WebSocketError(WebSocketErrorCode.CONNECTION_LOST)
        expect(error.retryable).toBe(true)
      })

      it('should mark message send failed as retryable', () => {
        const error = new WebSocketError(WebSocketErrorCode.MESSAGE_SEND_FAILED)
        expect(error.retryable).toBe(true)
      })

      it('should mark visual context capture as retryable', () => {
        const error = new WebSocketError(WebSocketErrorCode.VISUAL_CONTEXT_CAPTURE_FAILED)
        expect(error.retryable).toBe(true)
      })

      it('should not mark auth failed as retryable', () => {
        const error = new WebSocketError(WebSocketErrorCode.AUTH_FAILED)
        expect(error.retryable).toBe(false)
      })

      it('should not mark token missing as retryable', () => {
        const error = new WebSocketError(WebSocketErrorCode.TOKEN_MISSING)
        expect(error.retryable).toBe(false)
      })

      it('should allow overriding retryability', () => {
        const error = new WebSocketError(WebSocketErrorCode.AUTH_FAILED, {
          retryable: true
        })
        expect(error.retryable).toBe(true)
      })
    })
  })

  describe('toWebSocketError', () => {
    it('should return WebSocketError with merged context', () => {
      const original = new WebSocketError(WebSocketErrorCode.CONNECTION_FAILED, {
        context: { appId: 'app-1', socketId: 'socket-1' }
      })
      const result = toWebSocketError(original, WebSocketErrorCode.UNKNOWN_ERROR, {
        messageLength: 100,
        attemptNumber: 2
      })

      expect(result).toBeInstanceOf(WebSocketError)
      expect(result.code).toBe(WebSocketErrorCode.CONNECTION_FAILED)
      expect(result.context.appId).toBe('app-1')
      expect(result.context.socketId).toBe('socket-1')
      expect(result.context.messageLength).toBe(100)
      expect(result.context.attemptNumber).toBe(2)
    })

    it('should convert Error to WebSocketError', () => {
      const original = new Error('Something went wrong')
      const result = toWebSocketError(original, WebSocketErrorCode.CONNECTION_FAILED)

      expect(result).toBeInstanceOf(WebSocketError)
      expect(result.code).toBe(WebSocketErrorCode.CONNECTION_FAILED)
      expect(result.message).toBe('Something went wrong')
      expect(result.cause).toBe(original)
    })

    it('should convert string to WebSocketError', () => {
      const result = toWebSocketError('Error message', WebSocketErrorCode.MESSAGE_SEND_FAILED)

      expect(result).toBeInstanceOf(WebSocketError)
      expect(result.code).toBe(WebSocketErrorCode.MESSAGE_SEND_FAILED)
      expect(result.message).toBe('Error message')
    })

    it('should use UNKNOWN_ERROR as default code', () => {
      const result = toWebSocketError(new Error('Test'))

      expect(result.code).toBe(WebSocketErrorCode.UNKNOWN_ERROR)
    })

    it('should include context', () => {
      const context = { appId: 'test-app', attemptNumber: 3 }
      const result = toWebSocketError(new Error('Test'), WebSocketErrorCode.CONNECTION_TIMEOUT, context)

      expect(result.context.appId).toBe('test-app')
      expect(result.context.attemptNumber).toBe(3)
    })
  })

  describe('isWebSocketError', () => {
    it('should return true for WebSocketError', () => {
      const error = new WebSocketError(WebSocketErrorCode.CONNECTION_FAILED)
      expect(isWebSocketError(error)).toBe(true)
    })

    it('should return false for Error', () => {
      const error = new Error('Test')
      expect(isWebSocketError(error)).toBe(false)
    })

    it('should return false for string', () => {
      expect(isWebSocketError('error')).toBe(false)
    })

    it('should check specific code when provided', () => {
      const error = new WebSocketError(WebSocketErrorCode.CONNECTION_FAILED)

      expect(isWebSocketError(error, WebSocketErrorCode.CONNECTION_FAILED)).toBe(true)
      expect(isWebSocketError(error, WebSocketErrorCode.AUTH_FAILED)).toBe(false)
    })
  })

  describe('isRetryableError', () => {
    it('should return true for retryable WebSocketError', () => {
      const error = new WebSocketError(WebSocketErrorCode.CONNECTION_TIMEOUT)
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return false for non-retryable WebSocketError', () => {
      const error = new WebSocketError(WebSocketErrorCode.AUTH_FAILED)
      expect(isRetryableError(error)).toBe(false)
    })

    it('should return false for non-WebSocketError', () => {
      const error = new Error('Test')
      expect(isRetryableError(error)).toBe(false)
    })

    it('should return false for string', () => {
      expect(isRetryableError('error')).toBe(false)
    })
  })

  describe('getUserMessage', () => {
    it('should extract user message from WebSocketError', () => {
      const error = new WebSocketError(WebSocketErrorCode.CONNECTION_FAILED)
      expect(getUserMessage(error)).toBe('Could not connect to the server. Please check your internet connection.')
    })

    it('should extract message from Error', () => {
      const error = new Error('Test error')
      expect(getUserMessage(error)).toBe('Test error')
    })

    it('should convert string to string', () => {
      expect(getUserMessage('Error message')).toBe('Error message')
    })

    it('should convert number to string', () => {
      expect(getUserMessage(404)).toBe('404')
    })

    it('should convert object to string', () => {
      const obj = { error: 'test' }
      expect(getUserMessage(obj)).toBe('[object Object]')
    })
  })

  describe('error context', () => {
    it('should include custom context fields', () => {
      const error = new WebSocketError(WebSocketErrorCode.MESSAGE_SEND_FAILED, {
        context: {
          appId: 'app-123',
          socketId: 'socket-456',
          messageLength: 1024,
          customField: 'custom value'
        }
      })

      expect(error.context.appId).toBe('app-123')
      expect(error.context.socketId).toBe('socket-456')
      expect(error.context.messageLength).toBe(1024)
      expect(error.context.customField).toBe('custom value')
    })

    it('should always include timestamp', () => {
      const before = Date.now()
      const error = new WebSocketError(WebSocketErrorCode.CONNECTION_FAILED)
      const after = Date.now()

      expect(error.context.timestamp).toBeGreaterThanOrEqual(before)
      expect(error.context.timestamp).toBeLessThanOrEqual(after)
    })
  })
})
