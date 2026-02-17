import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useToolResultSync } from './useToolResultSync'

const mockAppFetch = vi.fn()
const mockBuildDynamicAgentUrl = vi.fn()
const mockLoggerDebug = vi.fn()
const mockLoggerWarn = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args)
}))

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: (...args: unknown[]) => mockBuildDynamicAgentUrl(...args)
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args)
  }
}))

describe('useToolResultSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildDynamicAgentUrl.mockResolvedValue('https://agent.example.com/api/conversations/conv-123/tools/tool-456?appId=app-789')
    mockAppFetch.mockResolvedValue({
      ok: true,
      status: 200
    })
  })

  describe('successful sync', () => {
    it('syncs tool result and returns true', async () => {
      const { result } = renderHook(() =>
        useToolResultSync({
          conversationId: 'conv-123',
          toolId: 'tool-456',
          appId: 'app-789'
        })
      )

      const syncResult = result.current
      const testState = {
        action: 'publish',
        publishStatus: 'Success',
        publishResult: { platformUrl: 'https://example.com' }
      }

      const success = await syncResult(testState)

      expect(success).toBe(true)
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith(
        'api/conversations/conv-123/tools/tool-456?appId=app-789',
        'app-789'
      )
      expect(mockAppFetch).toHaveBeenCalledWith(
        'https://agent.example.com/api/conversations/conv-123/tools/tool-456?appId=app-789',
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ result: testState })
        }
      )
      expect(mockLoggerDebug).toHaveBeenCalledWith('tool-result-sync.success', {
        conversationId: 'conv-123',
        toolId: 'tool-456',
        appId: 'app-789'
      })
    })

    it('allows multiple syncs (caller manages frequency)', async () => {
      const { result } = renderHook(() =>
        useToolResultSync({
          conversationId: 'conv-123',
          toolId: 'tool-456',
          appId: 'app-789'
        })
      )

      const syncResult = result.current
      const testState = { action: 'publish', publishStatus: 'Success' }

      // First call should sync
      const firstResult = await syncResult(testState)
      expect(firstResult).toBe(true)
      expect(mockAppFetch).toHaveBeenCalledTimes(1)

      // Second call should also sync (caller manages frequency)
      const secondResult = await syncResult({ ...testState, publishStatus: 'Error' })
      expect(secondResult).toBe(true)
      expect(mockAppFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('missing parameters', () => {
    it('returns false when conversationId is missing', async () => {
      const { result } = renderHook(() =>
        useToolResultSync({
          conversationId: null,
          toolId: 'tool-456',
          appId: 'app-789'
        })
      )

      const syncResult = result.current
      const success = await syncResult({ action: 'publish' })

      expect(success).toBe(false)
      expect(mockAppFetch).not.toHaveBeenCalled()
      expect(mockLoggerWarn).toHaveBeenCalledWith('tool-result-sync.missing-params', {
        hasConversationId: false,
        hasToolId: true,
        hasAppId: true
      })
    })

    it('returns false when toolId is missing', async () => {
      const { result } = renderHook(() =>
        useToolResultSync({
          conversationId: 'conv-123',
          toolId: '',
          appId: 'app-789'
        })
      )

      const syncResult = result.current
      const success = await syncResult({ action: 'publish' })

      expect(success).toBe(false)
      expect(mockAppFetch).not.toHaveBeenCalled()
    })

    it('returns false when appId is missing', async () => {
      const { result } = renderHook(() =>
        useToolResultSync({
          conversationId: 'conv-123',
          toolId: 'tool-456',
          appId: ''
        })
      )

      const syncResult = result.current
      const success = await syncResult({ action: 'publish' })

      expect(success).toBe(false)
      expect(mockAppFetch).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('returns false when API call fails with non-ok response', async () => {
      mockAppFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      })

      const { result } = renderHook(() =>
        useToolResultSync({
          conversationId: 'conv-123',
          toolId: 'tool-456',
          appId: 'app-789'
        })
      )

      const syncResult = result.current
      const success = await syncResult({ action: 'publish' })

      expect(success).toBe(false)
      expect(mockLoggerError).toHaveBeenCalledWith('tool-result-sync.error', {
        conversationId: 'conv-123',
        toolId: 'tool-456',
        appId: 'app-789',
        error: 'Failed to sync tool result: 500 - Internal Server Error'
      })
    })

    it('returns false when API call throws exception', async () => {
      mockAppFetch.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() =>
        useToolResultSync({
          conversationId: 'conv-123',
          toolId: 'tool-456',
          appId: 'app-789'
        })
      )

      const syncResult = result.current
      const success = await syncResult({ action: 'publish' })

      expect(success).toBe(false)
      expect(mockLoggerError).toHaveBeenCalledWith('tool-result-sync.error', {
        conversationId: 'conv-123',
        toolId: 'tool-456',
        appId: 'app-789',
        error: 'Network error'
      })
    })

    it('returns false when buildDynamicAgentUrl fails', async () => {
      mockBuildDynamicAgentUrl.mockRejectedValue(new Error('Site not found'))

      const { result } = renderHook(() =>
        useToolResultSync({
          conversationId: 'conv-123',
          toolId: 'tool-456',
          appId: 'app-789'
        })
      )

      const syncResult = result.current
      const success = await syncResult({ action: 'publish' })

      expect(success).toBe(false)
      expect(mockAppFetch).not.toHaveBeenCalled()
      expect(mockLoggerError).toHaveBeenCalledWith('tool-result-sync.error', {
        conversationId: 'conv-123',
        toolId: 'tool-456',
        appId: 'app-789',
        error: 'Site not found'
      })
    })
  })

  describe('function stability', () => {
    it('returns stable function reference across re-renders', () => {
      const { result, rerender } = renderHook(() =>
        useToolResultSync({
          conversationId: 'conv-123',
          toolId: 'tool-456',
          appId: 'app-789'
        })
      )

      const firstFunction = result.current
      rerender()
      const secondFunction = result.current

      expect(firstFunction).toBe(secondFunction)
    })

    it('returns new function when params change', () => {
      const { result, rerender } = renderHook(
        ({ conversationId }) =>
          useToolResultSync({
            conversationId,
            toolId: 'tool-456',
            appId: 'app-789'
          }),
        {
          initialProps: { conversationId: 'conv-123' }
        }
      )

      const firstFunction = result.current
      rerender({ conversationId: 'conv-999' })
      const secondFunction = result.current

      expect(firstFunction).not.toBe(secondFunction)
    })
  })
})
