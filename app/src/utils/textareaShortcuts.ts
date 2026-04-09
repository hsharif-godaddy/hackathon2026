import type { KeyboardEvent } from 'react'

interface InsertTextAtCursorOptions {
  textarea: HTMLTextAreaElement
  currentValue: string
  insertedText: string
  onValueChange: (nextValue: string) => void
}

interface HandleModifierEnterNewlineOptions {
  currentValue: string
  onValueChange: (nextValue: string) => void
}

export function insertTextAtCursor({
  textarea,
  currentValue,
  insertedText,
  onValueChange,
}: InsertTextAtCursorOptions) {
  const selectionStart = textarea.selectionStart ?? currentValue.length
  const selectionEnd = textarea.selectionEnd ?? currentValue.length
  const nextValue =
    currentValue.slice(0, selectionStart) +
    insertedText +
    currentValue.slice(selectionEnd)
  const nextCursorPosition = selectionStart + insertedText.length

  onValueChange(nextValue)

  const restoreSelection = () => {
    textarea.setSelectionRange(nextCursorPosition, nextCursorPosition)
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(restoreSelection)
    return
  }

  setTimeout(restoreSelection, 0)
}

export function handleModifierEnterNewline(
  event: KeyboardEvent<HTMLTextAreaElement>,
  { currentValue, onValueChange }: HandleModifierEnterNewlineOptions,
) {
  if (event.key !== 'Enter' || !(event.altKey || event.metaKey || event.ctrlKey)) {
    return false
  }

  event.preventDefault()
  insertTextAtCursor({
    textarea: event.currentTarget,
    currentValue,
    insertedText: '\n',
    onValueChange,
  })
  return true
}
