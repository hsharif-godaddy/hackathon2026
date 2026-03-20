import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetFocusOnModalClose } from './focus'

describe('resetFocusOnModalClose', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    // Clean up any main elements we added
    document.body.innerHTML = ''
  })

  it('should focus main element when present', () => {
    // Create a main element
    const main = document.createElement('main')
    document.body.appendChild(main)
    vi.spyOn(main, 'focus')

    resetFocusOnModalClose()

    // Should not focus immediately
    expect(main.focus).not.toHaveBeenCalled()

    // Run the setTimeout(0)
    vi.runAllTimers()

    // Now main should be focused
    expect(main.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('should temporarily add tabindex to main if not present', () => {
    const main = document.createElement('main')
    document.body.appendChild(main)
    vi.spyOn(main, 'focus')

    expect(main.hasAttribute('tabindex')).toBe(false)

    resetFocusOnModalClose()
    vi.runAllTimers()

    // tabindex should be added then removed
    expect(main.focus).toHaveBeenCalled()
    expect(main.hasAttribute('tabindex')).toBe(false)
  })

  it('should preserve existing tabindex on main', () => {
    const main = document.createElement('main')
    main.setAttribute('tabindex', '-1')
    document.body.appendChild(main)
    vi.spyOn(main, 'focus')

    resetFocusOnModalClose()
    vi.runAllTimers()

    // tabindex should still be present
    expect(main.getAttribute('tabindex')).toBe('-1')
  })

  it('should focus body as fallback when no main element', () => {
    // Create and focus a button (no main element)
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    vi.spyOn(document.body, 'focus')

    expect(document.activeElement).toBe(button)

    resetFocusOnModalClose()
    vi.runAllTimers()

    // Body should be focused as fallback
    expect(document.body.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('should temporarily add tabindex to body when used as fallback', () => {
    // No main element
    vi.spyOn(document.body, 'focus')
    const originalTabIndex = document.body.getAttribute('tabindex')

    resetFocusOnModalClose()
    vi.runAllTimers()

    // Body should be focused and tabindex restored to original state
    expect(document.body.focus).toHaveBeenCalled()
    expect(document.body.getAttribute('tabindex')).toBe(originalTabIndex)
  })
})
