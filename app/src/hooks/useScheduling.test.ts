import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { PublishTiming } from '@/types/social-posts'
import { useScheduling } from './useScheduling'

describe('useScheduling', () => {
  describe('default initialization', () => {
    it('should initialize with NOW timing by default', () => {
      const { result } = renderHook(() => useScheduling())

      expect(result.current.timing).toBe(PublishTiming.NOW)
      expect(result.current.date).toHaveLength(1)
      expect(result.current.time).toBeTruthy()
    })
  })

  describe('initialization with custom values', () => {
    it('should initialize with provided timing', () => {
      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER
      }))

      expect(result.current.timing).toBe(PublishTiming.LATER)
    })

    it('should initialize with provided date', () => {
      const { result } = renderHook(() => useScheduling({
        initialDate: '2026-02-14'
      }))

      expect(result.current.date).toEqual(['2026-02-14'])
    })

    it('should initialize with provided time', () => {
      const { result } = renderHook(() => useScheduling({
        initialTime: '5:00 AM'
      }))

      expect(result.current.time).toBe('5:00 AM')
    })

    it('should initialize with all custom values for NLP scheduling', () => {
      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: '2026-02-14',
        initialTime: '5:00 AM'
      }))

      expect(result.current.timing).toBe(PublishTiming.LATER)
      expect(result.current.date).toEqual(['2026-02-14'])
      expect(result.current.time).toBe('5:00 AM')
    })
  })

  describe('validation', () => {
    it('should be valid when timing is NOW', () => {
      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.NOW
      }))

      expect(result.current.isValid).toBe(true)
    })

    it('should validate scheduled date/time when timing is LATER', () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 2) // 2 days in future for safety
      const year = futureDate.getFullYear()
      const month = String(futureDate.getMonth() + 1).padStart(2, '0')
      const day = String(futureDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: '2:00 PM'
      }))

      expect(result.current.isValid).toBe(true)
    })
  })

  describe('timeout cleanup', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('should set timeout when timing is LATER with future date', () => {
      const futureDate = new Date()
      futureDate.setHours(futureDate.getHours() + 2) // 2 hours in future
      const year = futureDate.getFullYear()
      const month = String(futureDate.getMonth() + 1).padStart(2, '0')
      const day = String(futureDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`
      const timeStr = `${futureDate.getHours()}:${String(futureDate.getMinutes()).padStart(2, '0')}`

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: timeStr
      }))

      // Timeout should be created for future validation
      expect(setTimeoutSpy).toHaveBeenCalled()

      setTimeoutSpy.mockRestore()
    })

    it('should cleanup timeout when timing changes from LATER to NOW', () => {
      const futureDate = new Date()
      futureDate.setHours(futureDate.getHours() + 2)
      const year = futureDate.getFullYear()
      const month = String(futureDate.getMonth() + 1).padStart(2, '0')
      const day = String(futureDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`
      const timeStr = `${futureDate.getHours()}:${String(futureDate.getMinutes()).padStart(2, '0')}`

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: timeStr
      }))

      // Change timing to NOW (should cleanup timeout)
      act(() => {
        result.current.setTiming(PublishTiming.NOW)
      })

      // After changing to NOW, the timeout should be cleaned up
      expect(result.current.timing).toBe(PublishTiming.NOW)
      expect(clearTimeoutSpy).toHaveBeenCalled()

      clearTimeoutSpy.mockRestore()
    })

    it('should cleanup timeout on unmount', () => {
      const futureDate = new Date()
      futureDate.setHours(futureDate.getHours() + 2)
      const year = futureDate.getFullYear()
      const month = String(futureDate.getMonth() + 1).padStart(2, '0')
      const day = String(futureDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`
      const timeStr = `${futureDate.getHours()}:${String(futureDate.getMinutes()).padStart(2, '0')}`

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const { unmount } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: timeStr
      }))

      // Unmount should trigger cleanup
      unmount()

      // Verify clearTimeout was called
      expect(clearTimeoutSpy).toHaveBeenCalled()

      clearTimeoutSpy.mockRestore()
    })

    it('should not set timeout when timing is NOW', () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderHook(() => useScheduling({
        initialTiming: PublishTiming.NOW
      }))

      // No timeout should be created for NOW timing
      expect(setTimeoutSpy).not.toHaveBeenCalled()

      setTimeoutSpy.mockRestore()
    })

    it('should set timeout that fires when scheduled time approaches threshold', () => {
      // Use a far future date to ensure it's valid
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 2) // 2 days in future
      const year = futureDate.getFullYear()
      const month = String(futureDate.getMonth() + 1).padStart(2, '0')
      const day = String(futureDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: '2:00 PM'
      }))

      // Should be valid (far in future)
      expect(result.current.isValid).toBe(true)

      // Advance all timers to trigger any pending timeouts
      act(() => {
        vi.runAllTimers()
      })

      // Validation should still work after timeout fires
      expect(result.current.isValid).toBeDefined()
    })

    it('should handle validation for times that are too close', () => {
      // Use a past date (definitely invalid)
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)
      const year = pastDate.getFullYear()
      const month = String(pastDate.getMonth() + 1).padStart(2, '0')
      const day = String(pastDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: '2:00 PM'
      }))

      // Should be invalid (past date)
      expect(result.current.isValid).toBe(false)
    })
  })
})
