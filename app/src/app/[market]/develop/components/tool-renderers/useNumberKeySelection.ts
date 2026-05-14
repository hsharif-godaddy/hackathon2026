import { type RefObject, useEffect } from 'react'

import {
  isNonChatTextEntryActive,
  shouldAllowChoiceListDigitShortcut,
} from '@/app/[market]/develop/components/tool-renderers/shortcutFocus'

/**
 * Registers window digit shortcuts (1–N) for the ChoiceList row. Prefer
 * `focusChoiceListOptionByIndex` as the `onSelect` argument so UX Listbox roving
 * state stays in sync with Arrow keys; focusing `[role="option"]` alone does not.
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
      if (isNonChatTextEntryActive(activeEl)) return
      if (!shouldAllowChoiceListDigitShortcut(activeEl, choiceListContainerRef)) return

      const keyNum = parseInt(e.key, 10)
      if (isNaN(keyNum) || keyNum < 1 || keyNum > itemCount) return

      e.preventDefault()
      onSelect(keyNum - 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, itemCount, onSelect, choiceListContainerRef])
}
