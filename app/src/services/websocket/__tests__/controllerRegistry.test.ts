import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../storeUpdateBuffer', () => ({
  flushStoreUpdateBufferImmediate: vi.fn(),
}))

vi.mock('../toolDeltaBuffer', () => ({
  flushToolDeltaBufferImmediate: vi.fn(),
}))

import {
  clearController,
  getActiveHelpers,
  getController,
  getControllerAppId,
  type HookHelpers,
  scheduleControllerDestroy,
  setActiveHelpers,
  setController,
} from '../controllerRegistry'
import type { StreamingWebSocketController } from '../StreamingWebSocketController'

function createMockController(): StreamingWebSocketController {
  return { destroy: vi.fn() } as unknown as StreamingWebSocketController
}

describe('controllerRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getController()?.destroy()
    clearController()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('deferred destroy and remount reuse', () => {
    it('reuses controller when remount happens before deferred destroy fires', () => {
      const controller = createMockController()
      setController(controller, 'app-1')

      // Simulate unmount: schedule deferred destroy
      scheduleControllerDestroy(controller)

      // Controller is still in the registry (timer hasn't fired)
      expect(getController()).toBe(controller)

      // Simulate remount: reclaim the controller
      setController(controller, 'app-1')

      // Advance timers — the deferred destroy should have been cancelled
      vi.runAllTimers()

      expect(controller.destroy).not.toHaveBeenCalled()
      expect(getController()).toBe(controller)
      expect(getControllerAppId()).toBe('app-1')
    })

    it('destroys controller and clears all state when no remount reclaims it', () => {
      const controller = createMockController()
      const helpers = {
        clearStoredSocketId: vi.fn(),
        handleCommitComplete: vi.fn(),
        setConversationIdCookie: vi.fn(),
        clearConversationIdCookie: vi.fn(),
        getConversationIdFromCookie: vi.fn(),
        sendToolImpression: vi.fn(),
      } as HookHelpers

      setController(controller, 'app-1')
      setActiveHelpers(helpers)

      scheduleControllerDestroy(controller)

      // No remount — let the timer fire
      vi.runAllTimers()

      expect(controller.destroy).toHaveBeenCalledOnce()
      expect(getController()).toBeNull()
      expect(getControllerAppId()).toBeNull()
      expect(getActiveHelpers()).toBeNull()
    })

    it('updates app ID when controller is reclaimed after remount', () => {
      const controller = createMockController()
      setController(controller, 'app-1')

      scheduleControllerDestroy(controller)

      // Remount with a different app ID
      setController(controller, 'app-2')

      vi.runAllTimers()

      expect(controller.destroy).not.toHaveBeenCalled()
      expect(getControllerAppId()).toBe('app-2')
    })
  })

  describe('module-level helpers', () => {
    it('returns null when no helpers have been set', () => {
      expect(getActiveHelpers()).toBeNull()
    })

    it('stores and retrieves the latest helpers', () => {
      const helpers1 = {
        clearStoredSocketId: vi.fn(),
        handleCommitComplete: vi.fn(),
        setConversationIdCookie: vi.fn(),
        clearConversationIdCookie: vi.fn(),
        getConversationIdFromCookie: vi.fn(),
        sendToolImpression: vi.fn(),
      } as HookHelpers
      const helpers2 = { ...helpers1, clearStoredSocketId: vi.fn() } as HookHelpers

      setActiveHelpers(helpers1)
      expect(getActiveHelpers()).toBe(helpers1)

      setActiveHelpers(helpers2)
      expect(getActiveHelpers()).toBe(helpers2)
    })

    it('resets helpers when clearController is called', () => {
      const helpers = {
        clearStoredSocketId: vi.fn(),
        handleCommitComplete: vi.fn(),
        setConversationIdCookie: vi.fn(),
        clearConversationIdCookie: vi.fn(),
        getConversationIdFromCookie: vi.fn(),
        sendToolImpression: vi.fn(),
      } as HookHelpers

      setActiveHelpers(helpers)
      expect(getActiveHelpers()).toBe(helpers)

      clearController()
      expect(getActiveHelpers()).toBeNull()
    })
  })
})
