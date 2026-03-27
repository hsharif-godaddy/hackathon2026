/**
 * @vitest-environment jsdom
 */
import type { Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONNECT_DURATION_WARN_MS,
  MESSAGE_RTT_WARN_MS,
  NetworkQualityMonitor,
  PING_LATENCY_WARN_MS,
  RECOVERY_DURATION_WARN_MS,
  RETRY_COUNT_WARN_THRESHOLD,
} from '../NetworkQualityMonitor'

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}))

import { logger } from '@/lib/request-context'

const mockLogger = logger as unknown as { warn: ReturnType<typeof vi.fn> }

describe('NetworkQualityMonitor', () => {
  let monitor: NetworkQualityMonitor

  beforeEach(() => {
    vi.useFakeTimers()
    monitor = new NetworkQualityMonitor()
    vi.clearAllMocks()
  })

  afterEach(() => {
    monitor.destroy()
    vi.useRealTimers()
  })

  describe('ping latency', () => {
    function createMockSocketWithEngine() {
      const engineListeners: Record<string, () => void> = {}
      const engine = {
        on: vi.fn((event: string, fn: () => void) => {
          engineListeners[event] = fn
        }),
        off: vi.fn((event: string, fn: () => void) => {
          if (engineListeners[event] === fn) {
            delete engineListeners[event]
          }
        }),
      }
      const socket = {
        id: 'sock-1',
        io: { engine },
        on: vi.fn(),
      } as unknown as Socket
      return { socket, engine, engineListeners }
    }

    it('should warn when ping latency exceeds threshold', () => {
      const { socket, engineListeners } = createMockSocketWithEngine()
      monitor.attachToSocket(socket, 'app-1')

      // Simulate ping
      engineListeners['ping']()
      vi.advanceTimersByTime(PING_LATENCY_WARN_MS + 100)
      engineListeners['pong']()

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'websocket.quality.high_ping_latency',
        expect.objectContaining({
          latencyMs: expect.any(Number),
          appId: 'app-1',
          socketId: 'sock-1',
          threshold: PING_LATENCY_WARN_MS,
        })
      )
    })

    it('should not warn when ping latency is below threshold', () => {
      const { socket, engineListeners } = createMockSocketWithEngine()
      monitor.attachToSocket(socket, 'app-1')

      engineListeners['ping']()
      vi.advanceTimersByTime(100)
      engineListeners['pong']()

      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('should not log after detach', () => {
      const { socket, engineListeners } = createMockSocketWithEngine()
      monitor.attachToSocket(socket, 'app-1')

      // Simulate ping, then detach before pong
      engineListeners['ping']()
      monitor.detachFromSocket(socket)

      // pong listener should be removed; calling it manually should be no-op
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('should remove listeners on detach', () => {
      const { socket, engine } = createMockSocketWithEngine()
      monitor.attachToSocket(socket, 'app-1')

      monitor.detachFromSocket(socket)

      expect(engine.off).toHaveBeenCalledTimes(2) // ping + pong
    })

    it('should clean up previous listeners when attachToSocket is called twice', () => {
      const { socket, engine } = createMockSocketWithEngine()

      monitor.attachToSocket(socket, 'app-1')
      // Second attach should detach the first set of listeners before adding new ones
      monitor.attachToSocket(socket, 'app-2')

      // off should have been called for the first set of listeners (ping + pong)
      expect(engine.off).toHaveBeenCalledTimes(2)
      // on should have been called 4 times total (2 per attach)
      expect(engine.on).toHaveBeenCalledTimes(4)
    })
  })

  describe('connect duration', () => {
    it('should warn when connection takes longer than threshold', () => {
      monitor.markConnectStart('app-1')
      vi.advanceTimersByTime(CONNECT_DURATION_WARN_MS + 500)
      monitor.markConnectEstablished('sock-1')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'websocket.quality.slow_connect',
        expect.objectContaining({
          durationMs: expect.any(Number),
          appId: 'app-1',
          socketId: 'sock-1',
          threshold: CONNECT_DURATION_WARN_MS,
        })
      )
    })

    it('should not warn when connection is fast', () => {
      monitor.markConnectStart('app-1')
      vi.advanceTimersByTime(1000)
      monitor.markConnectEstablished('sock-1')

      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('should not warn if markConnectStart was not called', () => {
      monitor.markConnectEstablished('sock-1')
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  describe('message RTT', () => {
    it('should warn when message ack RTT exceeds threshold', () => {
      const sentAt = monitor.markMessageSent()
      vi.advanceTimersByTime(MESSAGE_RTT_WARN_MS + 100)
      monitor.markMessageAcked(sentAt, 'sock-1')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'websocket.quality.slow_message_rtt',
        expect.objectContaining({
          rttMs: expect.any(Number),
          socketId: 'sock-1',
          threshold: MESSAGE_RTT_WARN_MS,
        })
      )
    })

    it('should not warn when message ack is fast', () => {
      const sentAt = monitor.markMessageSent()
      vi.advanceTimersByTime(500)
      monitor.markMessageAcked(sentAt, 'sock-1')

      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  describe('recovery duration', () => {
    it('should warn when recovery exceeds threshold', () => {
      monitor.logRecoveryDuration(RECOVERY_DURATION_WARN_MS + 1000, 'sock-1')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'websocket.quality.slow_recovery',
        expect.objectContaining({
          durationMs: RECOVERY_DURATION_WARN_MS + 1000,
          socketId: 'sock-1',
          threshold: RECOVERY_DURATION_WARN_MS,
        })
      )
    })

    it('should not warn when recovery is fast', () => {
      monitor.logRecoveryDuration(5000, 'sock-1')
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  describe('retry count', () => {
    it('should warn when retry count reaches threshold', () => {
      monitor.logRetryCount(RETRY_COUNT_WARN_THRESHOLD, 'sock-1')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'websocket.quality.excessive_retries',
        expect.objectContaining({
          retryCount: RETRY_COUNT_WARN_THRESHOLD,
          socketId: 'sock-1',
          threshold: RETRY_COUNT_WARN_THRESHOLD,
        })
      )
    })

    it('should not warn below threshold', () => {
      monitor.logRetryCount(RETRY_COUNT_WARN_THRESHOLD - 1, 'sock-1')
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('should only warn at threshold crossings to avoid spam', () => {
      // First crossing at 3
      monitor.logRetryCount(3, 'sock-1')
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)

      // 4 and 5 should not warn again (same bucket)
      monitor.logRetryCount(4, 'sock-1')
      monitor.logRetryCount(5, 'sock-1')
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)

      // Second crossing at 6
      monitor.logRetryCount(6, 'sock-1')
      expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    })

    it('should not warn for count 0', () => {
      monitor.logRetryCount(0, 'sock-1')
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  describe('backgrounded tab guard', () => {
    it('should not start connect timer when tab is hidden', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      })

      monitor.markConnectStart('app-1')
      vi.advanceTimersByTime(CONNECT_DURATION_WARN_MS + 500)
      monitor.markConnectEstablished('sock-1')

      // Should not warn because timer was never started
      expect(mockLogger.warn).not.toHaveBeenCalled()

      // Restore
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
    })

    it('should invalidate in-progress connect timer when tab is backgrounded', () => {
      // Start with visible tab
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })

      monitor.markConnectStart('app-1')
      vi.advanceTimersByTime(5000)

      // Tab goes to background
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      // Connection completes much later
      vi.advanceTimersByTime(60_000)
      monitor.markConnectEstablished('sock-1')

      // Should not warn because timer was invalidated
      expect(mockLogger.warn).not.toHaveBeenCalled()

      // Restore
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
    })

    it('should not invalidate timer if tab stays visible', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })

      monitor.markConnectStart('app-1')
      vi.advanceTimersByTime(CONNECT_DURATION_WARN_MS + 500)
      monitor.markConnectEstablished('sock-1')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'websocket.quality.slow_connect',
        expect.objectContaining({
          appId: 'app-1',
        })
      )
    })

    it('should remove visibilitychange listener on destroy', () => {
      const removeListenerSpy = vi.spyOn(document, 'removeEventListener')
      monitor.destroy()

      expect(removeListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      removeListenerSpy.mockRestore()
    })
  })

  describe('destroy', () => {
    it('should be idempotent', () => {
      monitor.destroy()
      monitor.destroy()
      // No errors thrown
    })

    it('should clean up engine listeners', () => {
      const engineListeners: Record<string, () => void> = {}
      const engine = {
        on: vi.fn((event: string, fn: () => void) => {
          engineListeners[event] = fn
        }),
        off: vi.fn(),
      }
      const socket = {
        id: 'sock-1',
        io: { engine },
        on: vi.fn(),
      } as unknown as Socket

      monitor.attachToSocket(socket, 'app-1')
      monitor.destroy()

      expect(engine.off).toHaveBeenCalledTimes(2)
    })

    it('should reset retry warning state', () => {
      // Reach first threshold
      monitor.logRetryCount(3, 'sock-1')
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)

      // Destroy resets state
      monitor.destroy()

      // Re-create and first threshold should warn again
      monitor = new NetworkQualityMonitor()
      monitor.logRetryCount(3, 'sock-1')
      expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    })
  })
})
