/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { type PendingError,useErrorFixState } from './useErrorFixState'

function setup(initialIsProcessing = false) {
  const onSendFix = vi.fn()
  let isProcessing = initialIsProcessing
  const { result, rerender } = renderHook(
    () => useErrorFixState(isProcessing, onSendFix),
  )

  const setIsProcessing = (value: boolean) => {
    isProcessing = value
    rerender()
  }

  return { result, onSendFix, setIsProcessing, rerender }
}

describe('useErrorFixState', () => {
  it('starts in none state', () => {
    const { result } = setup()
    expect(result.current.errorFixState).toBe('none')
    expect(result.current.userRequestedFix).toBe(false)
  })

  describe('error-fix-request while agent is processing', () => {
    it('sets state to pending when agent is already processing', () => {
      const { result, onSendFix } = setup(true)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Cannot read property x'
        })
      })

      expect(result.current.errorFixState).toBe('pending')
      expect(onSendFix).not.toHaveBeenCalled()
    })

    it('escalates to unresolved after grace period when agent finishes with error still pending', () => {
      vi.useFakeTimers()
      const { result, setIsProcessing } = setup(true)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Cannot read property x'
        })
      })
      expect(result.current.errorFixState).toBe('pending')

      // Agent finishes processing — grace period starts
      act(() => setIsProcessing(false))

      // Still pending during grace period (transient errors may resolve)
      expect(result.current.errorFixState).toBe('pending')

      // After grace period, escalates to unresolved
      act(() => vi.advanceTimersByTime(3000))

      expect(result.current.errorFixState).toBe('unresolved')
      vi.useRealTimers()
    })

    it('holds error as pending when received during grace window after agent finishes', () => {
      vi.useFakeTimers()
      const { result, setIsProcessing } = setup(true)

      // Agent finishes — grace window starts, no error yet
      act(() => setIsProcessing(false))
      expect(result.current.errorFixState).toBe('none')

      // Error arrives during grace window (agent no longer processing)
      act(() => {
        result.current.actions.handleErrorFixRequest({ errorMessage: 'navItems is not defined' })
      })
      // inGraceWindowRef keeps it pending, not unresolved
      expect(result.current.errorFixState).toBe('pending')

      // Grace period elapses without HMR resolution → escalate
      act(() => vi.advanceTimersByTime(3000))
      expect(result.current.errorFixState).toBe('unresolved')

      vi.useRealTimers()
    })

    it('shows compile error immediately when new error arrives after resolved during grace window', () => {
      vi.useFakeTimers()
      const { result, setIsProcessing } = setup(true)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'first error'
        })
      })

      // Agent finishes — grace window starts
      act(() => setIsProcessing(false))
      expect(result.current.errorFixState).toBe('pending')

      // HMR resolves the first error during grace window
      act(() => { result.current.actions.handleErrorFixResolved() })
      expect(result.current.errorFixState).toBe('none')

      // A NEW compile error arrives (agent is idle, grace window should be closed)
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'second error'
        })
      })
      // Should show immediately as unresolved, not held as pending
      expect(result.current.errorFixState).toBe('unresolved')

      vi.useRealTimers()
    })

    it('returns to none when error resolves during grace period after agent finishes', () => {
      vi.useFakeTimers()
      const { result, setIsProcessing } = setup(true)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'navItems is not defined'
        })
      })
      expect(result.current.errorFixState).toBe('pending')

      act(() => setIsProcessing(false))
      expect(result.current.errorFixState).toBe('pending')

      // HMR resolves before 3s timer fires
      act(() => { result.current.actions.handleErrorFixResolved() })
      expect(result.current.errorFixState).toBe('none')
      expect(result.current.pendingError).toBeNull()

      // Grace timer must be cancelled — no escalation after 3s
      act(() => vi.advanceTimersByTime(3000))
      expect(result.current.errorFixState).toBe('none')
      vi.useRealTimers()
    })

    it('returns to none when error resolved before agent finishes', () => {
      const { result, setIsProcessing } = setup(true)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Cannot read property x'
        })
      })
      expect(result.current.errorFixState).toBe('pending')

      // Error resolves while agent is still processing
      act(() => {
        result.current.actions.handleErrorFixResolved()
      })
      expect(result.current.errorFixState).toBe('none')

      // Agent finishes — should stay at none since error was resolved
      act(() => setIsProcessing(false))
      expect(result.current.errorFixState).toBe('none')
    })
  })

  describe('compile error with agent idle', () => {
    it('goes directly to unresolved for compile errors when agent is idle', () => {
      const { result, onSendFix } = setup(false)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Module not found'
        })
      })

      expect(result.current.errorFixState).toBe('unresolved')
      expect(onSendFix).not.toHaveBeenCalled()
    })
  })

  describe('runtime error with agent idle', () => {
    it('auto-sends runtime errors to agent and sets pending', () => {
      const { result, onSendFix } = setup(false)

      const error: PendingError = {
        errorData: {
          message: 'TypeError: x is undefined',
          name: 'TypeError'
        }
      }

      act(() => {
        result.current.actions.handleErrorFixRequest(error)
      })

      expect(result.current.errorFixState).toBe('pending')
      expect(result.current.userRequestedFix).toBe(true)
      expect(onSendFix).toHaveBeenCalledWith(error)
    })
  })

  describe('handleFixError (user clicks Ask Airo to Fix)', () => {
    it('sends fix request and transitions to pending', () => {
      const { result, onSendFix } = setup(false)

      // First, get into unresolved state
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Module not found'
        })
      })
      expect(result.current.errorFixState).toBe('unresolved')

      // User clicks fix
      act(() => {
        result.current.actions.handleFixError()
      })

      expect(result.current.errorFixState).toBe('pending')
      expect(result.current.userRequestedFix).toBe(true)
      expect(onSendFix).toHaveBeenCalledWith({ errorMessage: 'Module not found' })
    })

    it('does nothing when there is no pending error', () => {
      const { result, onSendFix } = setup(false)

      act(() => {
        result.current.actions.handleFixError()
      })

      expect(result.current.errorFixState).toBe('none')
      expect(onSendFix).not.toHaveBeenCalled()
    })
  })

  describe('fallback timeout', () => {
    it('reverts to unresolved when ws.actions.send fails silently', () => {
      vi.useFakeTimers()
      const { result } = setup(false)

      // Get into unresolved, then user clicks fix (pending), but agent never starts processing
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Module not found'
        })
      })
      act(() => {
        result.current.actions.handleFixError()
      })
      expect(result.current.errorFixState).toBe('pending')

      // Fallback timeout fires
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(result.current.errorFixState).toBe('unresolved')
      expect(result.current.userRequestedFix).toBe(false)

      vi.useRealTimers()
    })

    it('does not revert if agent starts processing before timeout', () => {
      vi.useFakeTimers()
      const { result, setIsProcessing } = setup(false)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Module not found'
        })
      })
      act(() => {
        result.current.actions.handleFixError()
      })
      expect(result.current.errorFixState).toBe('pending')

      // Agent starts processing before timeout
      act(() => setIsProcessing(true))

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      // Should still be pending (agent is working)
      expect(result.current.errorFixState).toBe('pending')

      vi.useRealTimers()
    })
  })

  describe('multiple rapid error-fix-request events with agent idle', () => {
    it('last error wins and overlay re-renders with latest message', () => {
      const { result } = setup(false)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Error 1'
        })
      })
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Error 2'
        })
      })
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Error 3'
        })
      })

      expect(result.current.errorFixState).toBe('unresolved')
      expect(result.current.pendingError).toEqual({ errorMessage: 'Error 3' })
    })

    it('handleFixError sends the most recent error', () => {
      const { result, onSendFix } = setup(false)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Error 1'
        })
      })
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Error 2'
        })
      })

      act(() => {
        result.current.actions.handleFixError()
      })

      expect(onSendFix).toHaveBeenCalledWith({ errorMessage: 'Error 2' })
    })
  })

  describe('error-fix-resolved', () => {
    it('clears everything back to none', () => {
      const { result } = setup(false)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorMessage: 'Module not found'
        })
      })
      expect(result.current.errorFixState).toBe('unresolved')

      act(() => {
        result.current.actions.handleErrorFixResolved()
      })

      expect(result.current.errorFixState).toBe('none')
      expect(result.current.userRequestedFix).toBe(false)
      expect(result.current.pendingError).toBeNull()
    })
  })

  describe('runtime error dedup', () => {
    it('does not auto-send the same runtime error signature twice', () => {
      vi.useFakeTimers()
      const { result, onSendFix, setIsProcessing } = setup(false)

      const error: PendingError = {
        errorData: { message: 'x is undefined', name: 'TypeError' }
      }

      // First auto-send
      act(() => { result.current.actions.handleErrorFixRequest(error) })
      expect(onSendFix).toHaveBeenCalledTimes(1)
      expect(result.current.errorFixState).toBe('pending')

      // Simulate agent finishing without resolving the error
      act(() => setIsProcessing(true))
      act(() => setIsProcessing(false))
      // Wait for grace period to elapse
      act(() => vi.advanceTimersByTime(3000))
      expect(result.current.errorFixState).toBe('unresolved')

      // Same error arrives again - should NOT auto-send
      act(() => { result.current.actions.handleErrorFixRequest(error) })
      expect(onSendFix).toHaveBeenCalledTimes(1) // still 1
      expect(result.current.errorFixState).toBe('unresolved')
      vi.useRealTimers()
    })

    it('auto-sends a different error signature', () => {
      vi.useFakeTimers()
      const { result, onSendFix, setIsProcessing } = setup(false)

      // First error
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorData: { message: 'x is undefined', name: 'TypeError' }
        })
      })
      expect(onSendFix).toHaveBeenCalledTimes(1)

      // Agent finishes + grace period
      act(() => setIsProcessing(true))
      act(() => setIsProcessing(false))
      act(() => vi.advanceTimersByTime(3000))

      // Different error
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorData: { message: 'y is not a function', name: 'TypeError' }
        })
      })
      expect(onSendFix).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })

    it('resets dedup after error resolves', () => {
      const { result, onSendFix, setIsProcessing } = setup(false)

      const error: PendingError = {
        errorData: { message: 'x is undefined', name: 'TypeError' }
      }

      // First auto-send
      act(() => { result.current.actions.handleErrorFixRequest(error) })
      expect(onSendFix).toHaveBeenCalledTimes(1)

      // Agent finishes
      act(() => setIsProcessing(true))
      act(() => setIsProcessing(false))

      // Error resolves
      act(() => { result.current.actions.handleErrorFixResolved() })

      // Same error comes back - should auto-send again (dedup was reset)
      act(() => { result.current.actions.handleErrorFixRequest(error) })
      expect(onSendFix).toHaveBeenCalledTimes(2)
    })

    it('does not re-send while already pending', () => {
      const { result, onSendFix } = setup(false)

      const error: PendingError = {
        errorData: { message: 'x is undefined', name: 'TypeError' }
      }

      act(() => { result.current.actions.handleErrorFixRequest(error) })
      expect(onSendFix).toHaveBeenCalledTimes(1)
      expect(result.current.errorFixState).toBe('pending')

      // Same error while still pending
      act(() => { result.current.actions.handleErrorFixRequest(error) })
      expect(onSendFix).toHaveBeenCalledTimes(1) // no additional send
    })
  })

  describe('handleDismissError', () => {
    it('clears state back to none and resets dedup', () => {
      const { result, onSendFix } = setup(false)

      const error: PendingError = {
        errorData: { message: 'x is undefined', name: 'TypeError' }
      }

      // Auto-send a runtime error
      act(() => { result.current.actions.handleErrorFixRequest(error) })
      expect(onSendFix).toHaveBeenCalledTimes(1)
      expect(result.current.fixAttemptCount).toBe(1)

      // Dismiss
      act(() => { result.current.actions.handleDismissError() })

      expect(result.current.errorFixState).toBe('none')
      expect(result.current.pendingError).toBeNull()
      expect(result.current.fixAttemptCount).toBe(0)

      // Same error should auto-send again (dedup reset by dismiss)
      act(() => { result.current.actions.handleErrorFixRequest(error) })
      expect(onSendFix).toHaveBeenCalledTimes(2)
    })
  })

  describe('fixAttemptCount', () => {
    it('increments on auto-send and manual fix', () => {
      const { result, setIsProcessing } = setup(false)

      expect(result.current.fixAttemptCount).toBe(0)

      // Auto-send increments
      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorData: { message: 'error', name: 'Error' }
        })
      })
      expect(result.current.fixAttemptCount).toBe(1)

      // Agent finishes
      act(() => setIsProcessing(true))
      act(() => setIsProcessing(false))

      // Manual fix increments
      act(() => { result.current.actions.handleFixError() })
      expect(result.current.fixAttemptCount).toBe(2)
    })

    it('resets on error resolved', () => {
      const { result } = setup(false)

      act(() => {
        result.current.actions.handleErrorFixRequest({
          errorData: { message: 'error', name: 'Error' }
        })
      })
      expect(result.current.fixAttemptCount).toBe(1)

      act(() => { result.current.actions.handleErrorFixResolved() })
      expect(result.current.fixAttemptCount).toBe(0)
    })
  })
})
