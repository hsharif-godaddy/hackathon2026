/**
 * useWebSocketRetry Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useWebSocketRetry } from './useWebSocketRetry'

describe('useWebSocketRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.clearAllTimers()
  })

  it('initializes with empty retry state', () => {
    const { result } = renderHook(() => useWebSocketRetry())

    expect(result.current.retryStateRef.current).toEqual({
      retryCount: 0,
    })
  })

  it('clears retry timer when clearRetryState is called', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWebSocketRetry())

    // Set up a retry timer
    const timer = setTimeout(() => {}, 1000)
    result.current.retryStateRef.current = {
      retryCount: 3,
      retryTimer: timer,
    }

    // Clear retry state
    result.current.clearRetryState()

    // Verify state was reset
    expect(result.current.retryStateRef.current).toEqual({
      retryCount: 0,
    })

    vi.useRealTimers()
  })

  it('clears retry timer even if timer is undefined', () => {
    const { result } = renderHook(() => useWebSocketRetry())

    // Set retry state without timer
    result.current.retryStateRef.current = {
      retryCount: 2,
    }

    // Should not throw
    expect(() => result.current.clearRetryState()).not.toThrow()

    // Verify state was reset
    expect(result.current.retryStateRef.current).toEqual({
      retryCount: 0,
    })
  })

  it('clearRetryState is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useWebSocketRetry())

    const firstClearFn = result.current.clearRetryState

    rerender()

    const secondClearFn = result.current.clearRetryState

    expect(firstClearFn).toBe(secondClearFn)
  })

  it('retryStateRef persists across re-renders', () => {
    const { result, rerender } = renderHook(() => useWebSocketRetry())

    // Modify retry state
    result.current.retryStateRef.current = {
      retryCount: 5,
      pendingMessage: {
        chatMessage: { message: 'test' } as any,
        startTime: Date.now(),
      },
    }

    rerender()

    // Verify state persisted
    expect(result.current.retryStateRef.current.retryCount).toBe(5)
    expect(result.current.retryStateRef.current.pendingMessage).toBeDefined()
  })
})
