/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useAnimatedPlaceholder } from './useAnimatedPlaceholder'

// Stable intl reference across renders so the placeholders memo (keyed on intl)
// doesn't churn and restart the animation effect every render.
const { mockIntl } = vi.hoisted(() => ({
  mockIntl: {
    formatMessage: ({ id, defaultMessage }: { id: string; defaultMessage?: string }): string =>
      defaultMessage ?? id,
  },
}))
vi.mock('react-intl', () => ({ useIntl: () => mockIntl }))

let mockIsSafari = false
vi.mock('@/utils/browser', () => ({ isSafari: () => mockIsSafari }))

const EXAMPLES = [
  { id: 'ex_1', defaultMessage: 'Build me a store' },
  { id: 'ex_2', defaultMessage: 'Build me a portfolio' },
] as const

describe('useAnimatedPlaceholder', function placeholderTests() {
  beforeEach(function setup() {
    mockIsSafari = false
    vi.useFakeTimers()
  })

  afterEach(function teardown() {
    vi.useRealTimers()
  })

  it('animates a ghost-type placeholder when the field is empty and unfocused', function animates() {
    const { result } = renderHook(() =>
      useAnimatedPlaceholder({ isFocused: false, displayText: '', examples: EXAMPLES }),
    )

    act(() => { vi.advanceTimersByTime(300) })

    expect(result.current.length).toBeGreaterThan(0)
  })

  it('clears and stops the ghost-type once real text is present (keystroke)', function stopsOnText() {
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) =>
        useAnimatedPlaceholder({ isFocused: false, displayText: text, examples: EXAMPLES }),
      { initialProps: { text: '' } },
    )
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.length).toBeGreaterThan(0)

    // User types — the ghost-type must clear immediately and never resume.
    rerender({ text: 'I want a bakery site' })
    expect(result.current).toBe('')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current).toBe('')
  })

  it('does not animate while the field is focused', function stopsOnFocus() {
    const { result } = renderHook(() =>
      useAnimatedPlaceholder({ isFocused: true, displayText: '', examples: EXAMPLES }),
    )

    act(() => { vi.advanceTimersByTime(2000) })

    expect(result.current).toBe('')
  })

  it('shows a static placeholder (no animation) on Safari', function safariStatic() {
    mockIsSafari = true
    const { result } = renderHook(() =>
      useAnimatedPlaceholder({ isFocused: false, displayText: '', examples: EXAMPLES }),
    )

    const initial: string = result.current
    expect(EXAMPLES.map((e) => e.defaultMessage)).toContain(initial)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current).toBe(initial)
  })
})
