/**
 * @vitest-environment jsdom
 */
/**
 * useToolDeltaBuffer Tests
 *
 * Tests both the React hook wrapper and the underlying module-level utility.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { getToolDeltaBuffer } from '@/services/websocket/toolDeltaBuffer'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { useToolDeltaBuffer } from './useToolDeltaBuffer'

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

const mockStore = useStreamingConversationStore as unknown as {
  getState: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}

describe('useToolDeltaBuffer', () => {
  let mockUpdateToolDelta: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateToolDelta = vi.fn()

    // Clear the shared module-level buffer between tests
    getToolDeltaBuffer().clear()

    mockStore.getState.mockReturnValue({
      updateToolDelta: mockUpdateToolDelta,
    })

    // Mock subscribe to immediately return unsubscribe function
    mockStore.subscribe.mockReturnValue(vi.fn())
  })

  it('initializes with empty buffer', () => {
    const { result } = renderHook(() => useToolDeltaBuffer())

    expect(result.current.toolDeltaBufferRef.current.size).toBe(0)
  })

  describe('flushToolDeltaBufferImmediate', () => {
    it('flushes buffered deltas immediately', () => {
      const { result } = renderHook(() => useToolDeltaBuffer())

      // Add some deltas to buffer
      result.current.toolDeltaBufferRef.current.set('tool-1', {
        name: 'read-file',
        delta: 'partial input',
        hasExplicitName: true,
      })

      result.current.flushToolDeltaBufferImmediate()

      expect(mockUpdateToolDelta).toHaveBeenCalledWith('tool-1', 'read-file', 'partial input')
      expect(result.current.toolDeltaBufferRef.current.size).toBe(0)
    })

    it('does nothing if buffer is empty', () => {
      const { result } = renderHook(() => useToolDeltaBuffer())

      result.current.flushToolDeltaBufferImmediate()

      expect(mockUpdateToolDelta).not.toHaveBeenCalled()
    })

    it('skips deltas with empty strings', () => {
      const { result } = renderHook(() => useToolDeltaBuffer())

      result.current.toolDeltaBufferRef.current.set('tool-1', {
        name: 'read-file',
        delta: '',
        hasExplicitName: true,
      })
      result.current.toolDeltaBufferRef.current.set('tool-2', {
        name: 'write-file',
        delta: 'content',
        hasExplicitName: true,
      })

      result.current.flushToolDeltaBufferImmediate()

      expect(mockUpdateToolDelta).toHaveBeenCalledTimes(1)
      expect(mockUpdateToolDelta).toHaveBeenCalledWith('tool-2', 'write-file', 'content')
    })

    it('clears buffer even if updateToolDelta is not available', () => {
      mockStore.getState.mockReturnValue({
        updateToolDelta: null,
      })

      const { result } = renderHook(() => useToolDeltaBuffer())

      result.current.toolDeltaBufferRef.current.set('tool-1', {
        name: 'read-file',
        delta: 'content',
        hasExplicitName: true,
      })

      result.current.flushToolDeltaBufferImmediate()

      expect(result.current.toolDeltaBufferRef.current.size).toBe(0)
    })

    it('clears buffer even if flush throws error', () => {
      mockUpdateToolDelta.mockImplementation(() => {
        throw new Error('Flush error')
      })

      const { result } = renderHook(() => useToolDeltaBuffer())

      result.current.toolDeltaBufferRef.current.set('tool-1', {
        name: 'read-file',
        delta: 'content',
        hasExplicitName: true,
      })

      result.current.flushToolDeltaBufferImmediate()

      // Buffer should be cleared despite error
      expect(result.current.toolDeltaBufferRef.current.size).toBe(0)
    })
  })

  describe('scheduleToolDeltaFlush', () => {
    it('schedules a flush using requestAnimationFrame', async () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

      const { result } = renderHook(() => useToolDeltaBuffer())

      result.current.toolDeltaBufferRef.current.set('tool-1', {
        name: 'read-file',
        delta: 'content',
        hasExplicitName: true,
      })

      result.current.scheduleToolDeltaFlush()

      expect(rafSpy).toHaveBeenCalled()

      // Wait for RAF to execute
      await waitFor(() => {
        expect(mockUpdateToolDelta).toHaveBeenCalledWith('tool-1', 'read-file', 'content')
      })

      rafSpy.mockRestore()
    })

    it('only schedules one flush if called multiple times', async () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

      const { result } = renderHook(() => useToolDeltaBuffer())

      result.current.toolDeltaBufferRef.current.set('tool-1', {
        name: 'read-file',
        delta: 'content',
        hasExplicitName: true,
      })

      // Call multiple times
      result.current.scheduleToolDeltaFlush()
      result.current.scheduleToolDeltaFlush()
      result.current.scheduleToolDeltaFlush()

      // Should only schedule once
      expect(rafSpy).toHaveBeenCalledTimes(1)

      await waitFor(() => {
        expect(mockUpdateToolDelta).toHaveBeenCalledTimes(1)
      })

      rafSpy.mockRestore()
    })

    it('falls back to setTimeout if requestAnimationFrame is not available', async () => {
      const originalRAF = window.requestAnimationFrame
      delete window.requestAnimationFrame

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      const { result } = renderHook(() => useToolDeltaBuffer())

      result.current.toolDeltaBufferRef.current.set('tool-1', {
        name: 'read-file',
        delta: 'content',
        hasExplicitName: true,
      })

      result.current.scheduleToolDeltaFlush()

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 16)

      await waitFor(() => {
        expect(mockUpdateToolDelta).toHaveBeenCalledWith('tool-1', 'read-file', 'content')
      })

      setTimeoutSpy.mockRestore()
      window.requestAnimationFrame = originalRAF
    })
  })

  it('functions are stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useToolDeltaBuffer())

    const firstScheduleFn = result.current.scheduleToolDeltaFlush
    const firstFlushFn = result.current.flushToolDeltaBufferImmediate

    rerender()

    expect(result.current.scheduleToolDeltaFlush).toBe(firstScheduleFn)
    expect(result.current.flushToolDeltaBufferImmediate).toBe(firstFlushFn)
  })

  it('buffer ref persists across re-renders', () => {
    const { result, rerender } = renderHook(() => useToolDeltaBuffer())

    result.current.toolDeltaBufferRef.current.set('tool-1', {
      name: 'read-file',
      delta: 'content',
      hasExplicitName: true,
    })

    rerender()

    expect(result.current.toolDeltaBufferRef.current.size).toBe(1)
    expect(result.current.toolDeltaBufferRef.current.get('tool-1')).toEqual({
      name: 'read-file',
      delta: 'content',
      hasExplicitName: true,
    })
  })
})
