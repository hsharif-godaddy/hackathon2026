import { type RefObject, useEffect } from 'react'

import {
  isNonChatTextEntryActive,
  shouldAllowChoiceListDigitShortcut,
} from '@/app/[market]/develop/components/tool-renderers/shortcutFocus'

/**
 * True when focus is on an `<input>` / `<textarea>` inside the ChoiceList container
 * and the field is empty. The Other free-text input lives next to the option list,
 * so a user reading the question naturally has cursor focus there — but until they
 * type anything, digit keys should still pick an option, not insert the digit.
 * Once they have any text in the field, digits go into the field as usual.
 */
function isEmptyOtherInputInContainer(
  activeEl: HTMLElement | null,
  containerRef?: RefObject<HTMLElement | null>,
): boolean {
  if (!activeEl || !containerRef?.current) return false
  if (!containerRef.current.contains(activeEl)) return false
  if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
    return activeEl.value.length === 0
  }
  return false
}

/**
 * Registers window digit shortcuts (1–N) for the ChoiceList row. Prefer
 * `focusChoiceListOptionByIndex` as the `onSelect` argument so the picked option
 * commits via the same path a mouse click takes (no need to also press Enter).
 * When `disabled` is true, no listener is attached — required so hidden or
 * non-applicable tool renderer instances (e.g. AskQuestion with hideQuestion or
 * incomplete tool status) do not accumulate idle keydown handlers.
 */
export function useNumberKeySelection({
  itemCount,
  disabled,
  onSelect,
  choiceListContainerRef,
}: {
  itemCount: number
  disabled: boolean
  onSelect: (index: number) => void
  choiceListContainerRef?: RefObject<HTMLElement | null>
}): void {
  useEffect(() => {
    if (disabled || itemCount === 0) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return

      const activeEl = document.activeElement as HTMLElement | null
      const emptyContainerInput = isEmptyOtherInputInContainer(activeEl, choiceListContainerRef)

      // Normally we suppress digit shortcuts when the user is typing in any
      // input — except when that input is the still-empty "Other" field of the
      // very ChoiceList we're listening for. There, digits are picks, not text.
      if (!emptyContainerInput) {
        if (isNonChatTextEntryActive(activeEl)) return
        if (!shouldAllowChoiceListDigitShortcut(activeEl, choiceListContainerRef)) return
      }

      const keyNum = parseInt(e.key, 10)
      if (isNaN(keyNum) || keyNum < 1 || keyNum > itemCount) return

      e.preventDefault()
      onSelect(keyNum - 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, itemCount, onSelect, choiceListContainerRef])
}
