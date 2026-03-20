/**
 * Reset focus to a safe element when a modal closes.
 *
 * This is necessary when a modal is triggered from a temporary UI element
 * (like a popover button) that no longer exists when the modal closes.
 * Without this, focus-lock may return focus to a random element in the DOM.
 *
 * Uses setTimeout(0) to ensure we run after the modal's focus-lock cleanup,
 * which runs synchronously during React's unmount phase. Our macrotask
 * (setTimeout) is guaranteed to run after React's synchronous cleanup.
 */
export function resetFocusOnModalClose(): void {
  setTimeout(() => {
    // Guard against SSR/non-browser environments (defensive, matches codebase pattern)
    if (typeof document === 'undefined') return

    // Main is preferred because it represents the primary content region
    const main = document.querySelector('main')
    const target = main instanceof HTMLElement ? main : document.body

    // tabindex="-1" makes element programmatically focusable without
    // adding it to the tab order
    const hadTabIndex = target.hasAttribute('tabindex')
    if (!hadTabIndex) {
      target.setAttribute('tabindex', '-1')
    }

    target.focus({ preventScroll: true })

    // Clean up: remove tabindex if we added it (keeps DOM in original state)
    // Safe to remove immediately - focus() is synchronous
    if (!hadTabIndex) {
      target.removeAttribute('tabindex')
    }
  }, 0)
}
