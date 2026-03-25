import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createConsoleSpy,
  createMockAiEditContext,
  createMockAssets,
  createMockController,
  createMockMessageOptions,
  createMockStoreState,
  createMockVisualContext,
  createMockWebSocketState,
  createWebSocketTestHarness,
  expectCalledWithPartial,
  flushPromises
} from './websocket-test-utils'

describe('WebSocket Test Utilities', () => {
  describe('createMockController', () => {
    it('should create a controller with all required methods', () => {
      const controller = createMockController()

      expect(controller.connect).toBeDefined()
      expect(controller.disconnect).toBeDefined()
      expect(controller.destroy).toBeDefined()
      expect(controller.sendMessage).toBeDefined()
      expect(controller.stopGeneration).toBeDefined()
      expect(controller.loadMoreHistory).toBeDefined()
      expect(controller.emitGrantContext).toBeDefined()
      expect(controller.onGrantRefreshRequested).toBeDefined()
      expect(controller.flushToolDeltaBufferImmediate).toBeDefined()
      expect(controller.scheduleToolDeltaFlush).toBeDefined()
      expect(controller.isInReplayMode).toBeDefined()
      expect(controller.startReplayDeduplication).toBeDefined()
      expect(controller.clearReplayDeduplication).toBeDefined()
      expect(controller.hasSeenEvent).toBeDefined()
      expect(controller.markEventSeen).toBeDefined()
    })

    it('should return sensible defaults', () => {
      const controller = createMockController()

      expect(controller.loadMoreHistory()).toBe(true)
      expect(controller.emitGrantContext()).toBe(true)
      expect(controller.isInReplayMode()).toBe(false)
      expect(controller.hasSeenEvent('test')).toBe(false)
    })

    it('should allow overriding specific methods', () => {
      const customConnect = vi.fn().mockResolvedValue('custom')
      const controller = createMockController({
        connect: customConnect
      })

      expect(controller.connect).toBe(customConnect)
      expect(controller.disconnect).toBeDefined()
    })

    it('should return functions that can be awaited', async () => {
      const controller = createMockController()

      await expect(controller.connect()).resolves.toBeUndefined()
      await expect(controller.sendMessage({ content: 'test' })).resolves.toBeUndefined()
    })
  })

  describe('createMockWebSocketState', () => {
    it('should create state with default values', () => {
      const state = createMockWebSocketState()

      expect(state.connected).toBe(false)
      expect(state.status).toBe('idle')
      expect(state.error).toBeUndefined()
    })

    it('should allow overriding values', () => {
      const state = createMockWebSocketState({
        connected: true,
        status: 'streaming',
        error: { message: 'Test error' }
      })

      expect(state.connected).toBe(true)
      expect(state.status).toBe('streaming')
      expect(state.error).toEqual({ message: 'Test error' })
    })
  })

  describe('createMockMessageOptions', () => {
    it('should create options with default content', () => {
      const options = createMockMessageOptions()

      expect(options.content).toBe('Test message')
    })

    it('should allow overriding content and adding fields', () => {
      const options = createMockMessageOptions({
        content: 'Custom message',
        isActionRequest: true
      })

      expect(options.content).toBe('Custom message')
      expect(options.isActionRequest).toBe(true)
    })
  })

  describe('createWebSocketTestHarness', () => {
    it('should create harness with default controller and state', () => {
      const harness = createWebSocketTestHarness()

      expect(harness.controller).toBeDefined()
      expect(harness.state).toBeDefined()
      expect(harness.state.connected).toBe(false)
      expect(harness.state.status).toBe('idle')
    })

    it('should allow custom controller', () => {
      const customController = createMockController()
      const harness = createWebSocketTestHarness({
        controller: customController
      })

      expect(harness.controller).toBe(customController)
    })

    it('should allow custom initial state', () => {
      const harness = createWebSocketTestHarness({
        initialState: {
          connected: true,
          status: 'streaming'
        }
      })

      expect(harness.state.connected).toBe(true)
      expect(harness.state.status).toBe('streaming')
    })

    describe('harness methods', () => {
      let harness: ReturnType<typeof createWebSocketTestHarness>

      beforeEach(() => {
        harness = createWebSocketTestHarness()
      })

      it('setConnected should update connected state', () => {
        harness.setConnected(true)
        expect(harness.state.connected).toBe(true)

        harness.setConnected(false)
        expect(harness.state.connected).toBe(false)
      })

      it('setStatus should update status', () => {
        harness.setStatus('streaming')
        expect(harness.state.status).toBe('streaming')

        harness.setStatus('completing')
        expect(harness.state.status).toBe('completing')
      })

      it('setError should set error and status', () => {
        const error = new Error('Test error')
        harness.setError(error)

        expect(harness.state.error).toBe(error)
        expect(harness.state.status).toBe('error')
      })

      it('clearError should clear error and reset status from error', () => {
        harness.setError(new Error('Test'))
        expect(harness.state.status).toBe('error')

        harness.clearError()
        expect(harness.state.error).toBeUndefined()
        expect(harness.state.status).toBe('idle')
      })

      it('clearError should not change status if not error', () => {
        harness.setStatus('streaming')
        harness.clearError()

        expect(harness.state.status).toBe('streaming')
      })

      it('simulateConnect should set connected state', () => {
        harness.simulateConnect()

        expect(harness.state.connected).toBe(true)
        expect(harness.state.status).toBe('idle')
        expect(harness.state.error).toBeUndefined()
      })

      it('simulateDisconnect should clear connected state', () => {
        harness.simulateConnect()
        harness.simulateDisconnect()

        expect(harness.state.connected).toBe(false)
        expect(harness.state.status).toBe('idle')
      })

      it('simulateStreamStart should set streaming state', () => {
        harness.simulateStreamStart()

        expect(harness.state.connected).toBe(true)
        expect(harness.state.status).toBe('streaming')
      })

      it('simulateStreamComplete should transition to completing', () => {
        harness.simulateStreamComplete()

        expect(harness.state.status).toBe('completing')
      })

      it('simulateStreamComplete should eventually transition to idle', async () => {
        harness.simulateStreamComplete()
        await flushPromises()

        expect(harness.state.status).toBe('idle')
      })

      it('simulateError should set error state', () => {
        const error = new Error('Test error')
        harness.simulateError(error)

        expect(harness.state.error).toBe(error)
        expect(harness.state.status).toBe('error')
        expect(harness.state.connected).toBe(false)
      })

      it('reset should clear all state and mocks', () => {
        harness.simulateConnect()
        harness.setError(new Error('Test'))
        harness.controller.sendMessage({ content: 'test' })

        harness.reset()

        expect(harness.state.connected).toBe(false)
        expect(harness.state.status).toBe('idle')
        expect(harness.state.error).toBeUndefined()
        expect(vi.mocked(harness.controller.sendMessage).mock.calls).toHaveLength(0)
      })
    })
  })

  describe('createMockStoreState', () => {
    it('should create store state with all required fields', () => {
      const state = createMockStoreState()

      expect(state.messages).toEqual([])
      expect(state.activeStream).toBeNull()
      expect(state.streamingState).toBe('idle')
      expect(state.currentStep).toBe(0)
      expect(state.currentAppId).toBeNull()
      expect(state.inputValue).toBe('')
      expect(state.isLoading).toBe(false)
      expect(state.websocket).toBeDefined()
      expect(state.connectionRetry).toBeDefined()
      expect(state.recoveryState).toBeDefined()
      expect(state.retryState).toBeDefined()
    })

    it('should include mock action functions', () => {
      const state = createMockStoreState()

      expect(state.setWebSocketState).toBeDefined()
      expect(state.setStreamingState).toBeDefined()
      expect(state.setIsLoading).toBeDefined()
      expect(state.startNewStream).toBeDefined()
      expect(state.appendTextSegment).toBeDefined()
      expect(state.addToolStartSegment).toBeDefined()
      expect(state.finalizeStream).toBeDefined()
    })

    it('should allow overriding any field', () => {
      const customStream = { id: 'stream-1', content: 'Test' }
      const state = createMockStoreState({
        activeStream: customStream,
        currentAppId: 'test-app-123',
        isLoading: true
      })

      expect(state.activeStream).toBe(customStream)
      expect(state.currentAppId).toBe('test-app-123')
      expect(state.isLoading).toBe(true)
    })

    it('should create nested websocket state', () => {
      const state = createMockStoreState()

      expect(state.websocket.connected).toBe(false)
      expect(state.websocket.status).toBe('idle')
    })
  })

  describe('flushPromises', () => {
    it('should wait for pending promises', async () => {
      let resolved = false
      Promise.resolve().then(() => {
        resolved = true
      })

      expect(resolved).toBe(false)
      await flushPromises()
      expect(resolved).toBe(true)
    })
  })

  describe('createConsoleSpy', () => {
    it('should spy on console methods', () => {
      const spy = createConsoleSpy()

      console.log('test log')
      console.warn('test warn')
      console.error('test error')

      expect(spy.log).toHaveBeenCalledWith('test log')
      expect(spy.warn).toHaveBeenCalledWith('test warn')
      expect(spy.error).toHaveBeenCalledWith('test error')

      spy.restore()
    })

    it('should restore console after cleanup', () => {
      const originalLog = console.log
      const spy = createConsoleSpy()

      expect(console.log).not.toBe(originalLog)

      spy.restore()

      expect(console.log).toBe(originalLog)
    })
  })

  describe('expectCalledWithPartial', () => {
    it('should match partial arguments', () => {
      const mock = vi.fn()
      mock({ id: '123', name: 'Test', extra: 'data' })

      expect(() => {
        expectCalledWithPartial(mock, { id: '123', name: 'Test' })
      }).not.toThrow()
    })

    it('should throw on mismatch', () => {
      const mock = vi.fn()
      mock({ id: '123', name: 'Test' })

      expect(() => {
        expectCalledWithPartial(mock, { id: '456' })
      }).toThrow()
    })

    it('should support call index', () => {
      const mock = vi.fn()
      mock({ id: '1' })
      mock({ id: '2' })
      mock({ id: '3' })

      expect(() => {
        expectCalledWithPartial(mock, { id: '2' }, 1)
      }).not.toThrow()
    })

    it('should throw if call index does not exist', () => {
      const mock = vi.fn()
      mock({ id: '1' })

      expect(() => {
        expectCalledWithPartial(mock, { id: '1' }, 5)
      }).toThrow('Mock was not called at index 5')
    })
  })

  describe('createMockVisualContext', () => {
    it('should create visual context with screenshot and viewport', () => {
      const context = createMockVisualContext()

      expect(context.screenshot).toBe('data:image/png;base64,mock-screenshot')
      expect(context.viewport).toEqual({ width: 1920, height: 1080 })
      expect(context.timestamp).toBeTypeOf('number')
    })

    it('should generate current timestamp', () => {
      const before = Date.now()
      const context = createMockVisualContext()
      const after = Date.now()

      expect(context.timestamp).toBeGreaterThanOrEqual(before)
      expect(context.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('createMockAiEditContext', () => {
    it('should create AI edit context with element info', () => {
      const context = createMockAiEditContext()

      expect(context.elementInfo).toEqual({
        tagName: 'div',
        className: 'test-class',
        id: 'test-id'
      })
      expect(context.selector).toBe('#test-id')
      expect(context.devContext).toEqual({
        url: 'https://example.com',
        viewport: { width: 1920, height: 1080 }
      })
      expect(context.screenshot).toBeNull()
    })
  })

  describe('createMockAssets', () => {
    it('should create asset array with image data', () => {
      const assets = createMockAssets()

      expect(assets).toHaveLength(1)
      expect(assets[0]).toMatchObject({
        mediaType: 'IMAGE',
        sourceType: 'gc',
        imageUrl: 'https://example.com/image1.jpg',
        thumbnailUrl: 'https://example.com/thumb1.jpg',
        filename: 'image1.jpg',
        contentType: 'image/jpeg',
        size: 1024,
        dimensions: { width: 800, height: 600 }
      })
    })
  })
})
