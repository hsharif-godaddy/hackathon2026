/**
 * UX Listbox keeps roving `activeItemId` on the listbox element; Arrow keys use that
 * state. Focusing `[role="option"]` alone does not update it, so arrows jump wrong.
 * Blur clears internal state when focus leaves the listbox subtree; we then focus the
 * listbox and emit ArrowDown so each step runs after React applies the prior update.
 */
export function focusChoiceListOptionByIndex(root: HTMLElement | null, index: number): void {
  if (!root || index < 0) return

  const listbox = root.querySelector<HTMLElement>('[role="listbox"]')
  if (!listbox) return

  const active = document.activeElement
  if (active instanceof HTMLElement && root.contains(active)) {
    active.blur()
  }
  listbox.focus()

  const steps = index + 1
  let completed = 0

  function arrowDown() {
    listbox.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    completed++
    if (completed < steps) {
      setTimeout(arrowDown, 0)
    }
  }

  setTimeout(arrowDown, 0)
}
