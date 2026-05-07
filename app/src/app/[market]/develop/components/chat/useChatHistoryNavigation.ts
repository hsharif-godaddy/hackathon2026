import { useCallback, useEffect, useRef, useState } from 'react'

interface UseChatHistoryNavigationOptions {
  userMessages: string[]
  inputValue: string
  onInputChange: (value: string) => void
  appId?: string | null
  isDisabled: boolean
}

function isAtStart(cursorPos: number): boolean {
  return cursorPos === 0
}

function isAtEnd(value: string, cursorPos: number): boolean {
  return cursorPos === value.length
}

export function useChatHistoryNavigation({
  userMessages,
  inputValue,
  onInputChange,
  appId,
  isDisabled,
}: UseChatHistoryNavigationOptions) {
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const draftRef = useRef('')
  // Increments on each navigation to signal ChatInput to move cursor to end
  const [navRevision, setNavRevision] = useState(0)

  // Reset navigation state when app changes
  useEffect(() => {
    setHistoryIndex(null)
    draftRef.current = ''
  }, [appId])

  const handleArrowUp = useCallback((textarea: HTMLTextAreaElement | null): boolean => {
    if (isDisabled || userMessages.length === 0) return false

    // When textarea is null, cursor-at-start check was done by caller (Lexical path)
    if (textarea && !isAtStart(textarea.selectionStart)) return false

    let newIndex: number
    if (historyIndex === null) {
      draftRef.current = inputValue
      newIndex = userMessages.length - 1
    } else if (historyIndex > 0) {
      newIndex = historyIndex - 1
    } else {
      return false
    }

    setHistoryIndex(newIndex)
    onInputChange(userMessages[newIndex])
    setNavRevision(r => r + 1)

    return true
  }, [isDisabled, userMessages, historyIndex, inputValue, onInputChange])

  const handleArrowDown = useCallback((textarea: HTMLTextAreaElement | null): boolean => {
    if (isDisabled || historyIndex === null) return false

    // When textarea is null, cursor-at-end check was done by caller (Lexical path)
    if (textarea && !isAtEnd(textarea.value, textarea.selectionStart)) return false

    if (historyIndex < userMessages.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      onInputChange(userMessages[newIndex])
    } else {
      setHistoryIndex(null)
      onInputChange(draftRef.current)
    }

    setNavRevision(r => r + 1)
    return true
  }, [isDisabled, historyIndex, userMessages, onInputChange])

  const resetNavigation = useCallback(() => {
    setHistoryIndex(null)
    draftRef.current = ''
  }, [])

  const exitNavigationMode = useCallback(() => {
    setHistoryIndex(null)
  }, [])

  return { handleArrowUp, handleArrowDown, resetNavigation, exitNavigationMode, navRevision }
}
