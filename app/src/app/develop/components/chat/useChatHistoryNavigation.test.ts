/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useChatHistoryNavigation } from './useChatHistoryNavigation'

function makeTextarea(value: string, selectionStart: number): HTMLTextAreaElement {
  return { value, selectionStart, setSelectionRange: vi.fn() } as unknown as HTMLTextAreaElement
}

const MESSAGES = ['first message', 'second message', 'third message']

describe('useChatHistoryNavigation', () => {
  const onInputChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderNav(overrides: Partial<Parameters<typeof useChatHistoryNavigation>[0]> = {}) {
    return renderHook(() =>
      useChatHistoryNavigation({
        userMessages: MESSAGES,
        inputValue: '',
        onInputChange,
        appId: 'app-1',
        isDisabled: false,
        ...overrides,
      })
    )
  }

  // ─── ArrowUp ───────────────────────────────────────────────────────────────

  describe('handleArrowUp', () => {
    it('navigates to most recent message when cursor is at start', () => {
      const { result } = renderNav({ inputValue: 'draft' })
      const textarea = makeTextarea('draft', 0)

      let triggered: boolean
      act(() => { triggered = result.current.handleArrowUp(textarea) })

      expect(triggered!).toBe(true)
      expect(onInputChange).toHaveBeenCalledWith('third message')
    })

    it('saves draft text on first ArrowUp', () => {
      const { result } = renderNav({ inputValue: 'my draft' })
      const textarea = makeTextarea('my draft', 0)

      act(() => { result.current.handleArrowUp(textarea) })
      // Navigate back past newest to restore draft
      act(() => { result.current.handleArrowDown(makeTextarea('third message', 'third message'.length)) })
      act(() => { result.current.handleArrowDown(makeTextarea('second message', 'second message'.length)) })
      act(() => { result.current.handleArrowDown(makeTextarea('first message', 'first message'.length)) })

      expect(onInputChange).toHaveBeenLastCalledWith('my draft')
    })

    it('does not navigate on a second ArrowUp when cursor is at end (as placed by useLayoutEffect)', () => {
      // After the first ArrowUp, useLayoutEffect moves the cursor to the end of the
      // recalled text. A second ArrowUp at that position should NOT navigate — the
      // user must press Home first to return to position 0.
      const { result } = renderNav()

      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      expect(onInputChange).toHaveBeenLastCalledWith('third message')

      // cursor is now at end of 'third message' (position 13) — ArrowUp does nothing
      let triggered: boolean
      act(() => { triggered = result.current.handleArrowUp(makeTextarea('third message', 13)) })
      expect(triggered!).toBe(false)
      expect(onInputChange).toHaveBeenCalledTimes(1)
    })

    it('continues navigating backwards when cursor is manually returned to position 0', () => {
      // Each makeTextarea(..., 0) simulates the user pressing Home to return the
      // cursor to the start before pressing ArrowUp again.
      const { result } = renderNav()

      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      expect(onInputChange).toHaveBeenLastCalledWith('third message')

      act(() => { result.current.handleArrowUp(makeTextarea('third message', 0)) })
      expect(onInputChange).toHaveBeenLastCalledWith('second message')

      act(() => { result.current.handleArrowUp(makeTextarea('second message', 0)) })
      expect(onInputChange).toHaveBeenLastCalledWith('first message')
    })

    it('does nothing when already at oldest message', () => {
      const { result } = renderNav()

      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      act(() => { result.current.handleArrowUp(makeTextarea('third message', 0)) })
      act(() => { result.current.handleArrowUp(makeTextarea('second message', 0)) })

      const callCountAtOldest = onInputChange.mock.calls.length
      let triggered: boolean
      act(() => { triggered = result.current.handleArrowUp(makeTextarea('first message', 0)) })

      expect(triggered!).toBe(false)
      expect(onInputChange).toHaveBeenCalledTimes(callCountAtOldest)
    })

    it('does not navigate when cursor is not at position 0', () => {
      const { result } = renderNav({ inputValue: 'hello' })
      const textarea = makeTextarea('hello', 3)

      let triggered: boolean
      act(() => { triggered = result.current.handleArrowUp(textarea) })

      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })

    it('does not navigate when userMessages is empty', () => {
      const { result } = renderNav({ userMessages: [] })
      const textarea = makeTextarea('', 0)

      let triggered: boolean
      act(() => { triggered = result.current.handleArrowUp(textarea) })

      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })

    it('does not navigate when isDisabled', () => {
      const { result } = renderNav({ isDisabled: true })
      const textarea = makeTextarea('', 0)

      let triggered: boolean
      act(() => { triggered = result.current.handleArrowUp(textarea) })

      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })
  })

  // ─── ArrowDown ─────────────────────────────────────────────────────────────

  describe('handleArrowDown', () => {
    it('does nothing when not in navigation mode', () => {
      const { result } = renderNav()
      const textarea = makeTextarea('', 0)

      let triggered: boolean
      act(() => { triggered = result.current.handleArrowDown(textarea) })

      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })

    it('does not navigate when isDisabled, even while in navigation mode', () => {
      // Simulates streaming starting while user is mid-history-navigation
      const { result, rerender } = renderHook(
        ({ isDisabled }: { isDisabled: boolean }) =>
          useChatHistoryNavigation({
            userMessages: MESSAGES,
            inputValue: '',
            onInputChange,
            appId: 'app-1',
            isDisabled,
          }),
        { initialProps: { isDisabled: false } }
      )

      // Enter navigation mode
      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      onInputChange.mockClear()

      // Streaming starts — isDisabled becomes true
      rerender({ isDisabled: true })

      let triggered: boolean
      act(() => { triggered = result.current.handleArrowDown(makeTextarea('third message', 'third message'.length)) })

      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })

    it('does not navigate when cursor is not at the end', () => {
      const { result } = renderNav()

      // Enter navigation mode first
      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      onInputChange.mockClear()

      // Cursor in middle of recalled message
      let triggered: boolean
      act(() => { triggered = result.current.handleArrowDown(makeTextarea('third message', 5)) })

      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })

    it('navigates forward through messages', () => {
      const { result } = renderNav()

      // Go to oldest
      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      act(() => { result.current.handleArrowUp(makeTextarea('third message', 0)) })
      act(() => { result.current.handleArrowUp(makeTextarea('second message', 0)) })
      onInputChange.mockClear()

      // Navigate forward
      act(() => { result.current.handleArrowDown(makeTextarea('first message', 'first message'.length)) })
      expect(onInputChange).toHaveBeenLastCalledWith('second message')

      act(() => { result.current.handleArrowDown(makeTextarea('second message', 'second message'.length)) })
      expect(onInputChange).toHaveBeenLastCalledWith('third message')
    })

    it('restores draft when navigating past newest message', () => {
      const { result } = renderNav({ inputValue: 'unsent draft' })

      act(() => { result.current.handleArrowUp(makeTextarea('unsent draft', 0)) })
      onInputChange.mockClear()

      act(() => { result.current.handleArrowDown(makeTextarea('third message', 'third message'.length)) })

      expect(onInputChange).toHaveBeenLastCalledWith('unsent draft')
    })

    it('long visually-wrapped message: only triggers when cursor is at very end', () => {
      const longMsg = 'Build a cozy website for my independent coffee shop. Show our menu, daily specials, story about our ethically-sourced beans, and location with hours.'
      const { result } = renderNav({ userMessages: [longMsg] })

      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      onInputChange.mockClear()

      // Cursor in the middle of the long recalled message — should NOT navigate
      let triggered: boolean
      act(() => { triggered = result.current.handleArrowDown(makeTextarea(longMsg, 50)) })
      expect(triggered!).toBe(false)

      // Cursor at the very end — should navigate (restore draft)
      act(() => { triggered = result.current.handleArrowDown(makeTextarea(longMsg, longMsg.length)) })
      expect(triggered!).toBe(true)
    })
  })

  // ─── Reset / Exit ──────────────────────────────────────────────────────────

  describe('resetNavigation', () => {
    it('clears navigation state and draft, preventing further ArrowDown', () => {
      const { result } = renderNav({ inputValue: 'draft' })

      act(() => { result.current.handleArrowUp(makeTextarea('draft', 0)) })
      act(() => { result.current.resetNavigation() })
      onInputChange.mockClear()

      // ArrowDown should now be a no-op (historyIndex is null)
      let triggered: boolean
      act(() => { triggered = result.current.handleArrowDown(makeTextarea('third message', 'third message'.length)) })
      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })
  })

  describe('exitNavigationMode', () => {
    it('exits navigation so ArrowDown no longer triggers', () => {
      const { result } = renderNav()

      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      act(() => { result.current.exitNavigationMode() })
      onInputChange.mockClear()

      let triggered: boolean
      act(() => { triggered = result.current.handleArrowDown(makeTextarea('third message', 'third message'.length)) })
      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })
  })

  // ─── App change ────────────────────────────────────────────────────────────

  describe('appId change', () => {
    it('resets navigation state when appId changes', () => {
      const { result, rerender } = renderHook(
        ({ appId }: { appId: string }) =>
          useChatHistoryNavigation({
            userMessages: MESSAGES,
            inputValue: '',
            onInputChange,
            appId,
            isDisabled: false,
          }),
        { initialProps: { appId: 'app-1' } }
      )

      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      onInputChange.mockClear()

      // Switch app
      rerender({ appId: 'app-2' })

      // ArrowDown should be a no-op — navigation was reset
      let triggered: boolean
      act(() => { triggered = result.current.handleArrowDown(makeTextarea('third message', 'third message'.length)) })
      expect(triggered!).toBe(false)
    })

    it('does not recall stale messages when userMessages is emptied on app switch', () => {
      // Mirrors the ChatPane guard: userMessages becomes [] when currentAppId !== appId.
      // Even if historyIndex is still set, ArrowUp should not navigate into stale data.
      const { result, rerender } = renderHook(
        ({ userMessages }: { userMessages: string[] }) =>
          useChatHistoryNavigation({
            userMessages,
            inputValue: '',
            onInputChange,
            appId: 'app-1',
            isDisabled: false,
          }),
        { initialProps: { userMessages: MESSAGES } }
      )

      act(() => { result.current.handleArrowUp(makeTextarea('', 0)) })
      onInputChange.mockClear()

      // App switch: ChatPane sets userMessages=[] because currentAppId !== appId
      rerender({ userMessages: [] })

      let triggered: boolean
      act(() => { triggered = result.current.handleArrowUp(makeTextarea('', 0)) })
      expect(triggered!).toBe(false)
      expect(onInputChange).not.toHaveBeenCalled()
    })
  })
})
