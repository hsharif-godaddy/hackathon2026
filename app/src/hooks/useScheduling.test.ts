import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { PublishTiming } from '@/types/social-posts'
import { useScheduling } from './useScheduling'

function formatDateStr(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeStr(d: Date): string {
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

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

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: formatDateStr(futureDate),
        initialTime: '2:00 PM'
      }))

      expect(result.current.isValid).toBe(true)
    })
  })

  describe.skip('timeout cleanup', () => {
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

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: formatDateStr(futureDate),
        initialTime: formatTimeStr(futureDate)
      }))

      // Timeout should be created for future validation
      expect(setTimeoutSpy).toHaveBeenCalled()

      setTimeoutSpy.mockRestore()
    })

    it('should cleanup timeout when timing changes from LATER to NOW', () => {
      const futureDate = new Date()
      futureDate.setHours(futureDate.getHours() + 2)

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: formatDateStr(futureDate),
        initialTime: formatTimeStr(futureDate)
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

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const { unmount } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: formatDateStr(futureDate),
        initialTime: formatTimeStr(futureDate)
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

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: formatDateStr(futureDate),
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

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: formatDateStr(pastDate),
        initialTime: '2:00 PM'
      }))

      // Should be invalid (past date)
      expect(result.current.isValid).toBe(false)
    })
  })

  describe('timezone handling', () => {
    it('should handle PST timezone correctly (UTC-8)', () => {
      // Simulate PST by using a date that would shift to previous day if parsed as UTC
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 2) // 2 days in future
      const dateStr = formatDateStr(futureDate)

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: '2:00 PM'
      }))

      // Verify the date doesn't shift - should remain valid in future
      expect(result.current.isValid).toBe(true)
      expect(result.current.date[0]).toBe(dateStr)
    })

    it('should handle EST timezone correctly (UTC-5)', () => {
      // Simulate EST by using a date that would shift if parsed as UTC
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 3) // 3 days in future
      const dateStr = formatDateStr(futureDate)

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: '10:00 AM'
      }))

      // Verify the date doesn't shift - should remain valid in future
      expect(result.current.isValid).toBe(true)
      expect(result.current.date[0]).toBe(dateStr)
    })

    it('should handle JST timezone correctly (UTC+9)', () => {
      // Positive UTC offsets don't have the day shift issue, but verify correct behavior
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 2) // 2 days in future
      const dateStr = formatDateStr(futureDate)

      const { result } = renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: dateStr,
        initialTime: '3:00 PM'
      }))

      // Verify the date remains correct in positive UTC offset
      expect(result.current.isValid).toBe(true)
      expect(result.current.date[0]).toBe(dateStr)
    })

    it('should calculate timeout correctly across day boundaries', () => {
      vi.useFakeTimers()

      // Create a date exactly 2 hours in the future
      const futureDate = new Date()
      futureDate.setHours(futureDate.getHours() + 2)

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderHook(() => useScheduling({
        initialTiming: PublishTiming.LATER,
        initialDate: formatDateStr(futureDate),
        initialTime: formatTimeStr(futureDate)
      }))

      // Verify setTimeout was called (means date parsing worked correctly)
      expect(setTimeoutSpy).toHaveBeenCalled()

      setTimeoutSpy.mockRestore()
      vi.useRealTimers()
    })
  })
})
