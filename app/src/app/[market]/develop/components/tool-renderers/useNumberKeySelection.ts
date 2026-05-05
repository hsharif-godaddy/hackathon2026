import { useEffect } from 'react'

export function useNumberKeySelection({
  itemCount,
  disabled,
  onSelect,
}: {
  itemCount: number
  disabled: boolean
  onSelect: (index: number) => void
}): void {
  useEffect(() => {
    if (disabled || itemCount === 0) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return

      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl) {
        const tagName = activeEl.tagName
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          activeEl.isContentEditable ||
          activeEl.closest?.('[contenteditable="true"]')
        ) {
          return
        }
      }

      const keyNum = parseInt(e.key, 10)
      if (isNaN(keyNum) || keyNum < 1 || keyNum > itemCount) return

      e.preventDefault()
      onSelect(keyNum - 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, itemCount, onSelect])
}
