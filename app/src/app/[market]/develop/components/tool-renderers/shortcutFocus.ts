import type { RefObject } from 'react'

const CHAT_PROMPT_SELECTOR = '#chat-input-textarea, [data-testid="chat-input-textarea"]'

export function isChatPromptElement(activeEl: HTMLElement | null): boolean {
  if (!activeEl) return false
  return activeEl.closest(CHAT_PROMPT_SELECTOR) !== null
}

export function isChatPromptEffectivelyEmpty(): boolean {
  const el = document.querySelector<HTMLTextAreaElement | HTMLElement>(CHAT_PROMPT_SELECTOR)
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return el.value.trim().length === 0
  return (el.innerText ?? '').trim().length === 0
}

/**
 * True when focus is in a text-entry control that is not the main chat prompt
 * (e.g. ask-question “Other”, modal fields).
 */
export function isNonChatTextEntryActive(activeEl: HTMLElement | null): boolean {
  if (!activeEl) return false
  if (activeEl.closest(CHAT_PROMPT_SELECTOR)) return false
  const tag = activeEl.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (activeEl.isContentEditable || activeEl.closest?.('[contenteditable="true"]')) return true
  return false
}

/**
 * Global digit shortcuts for ChoiceList should only run when the user is not typing
 * prose elsewhere: empty main chat prompt, focus inside this list’s container, or
 * focus on a listbox inside the composer card (NBA / plan strip).
 *
 * Composer scope uses `data-chat-composer-card` (production anchor). `data-testid="chat-input-card"`
 * remains for tests and may duplicate the marker on the same node in ChatInput.
 */
export function shouldAllowChoiceListDigitShortcut(
  activeEl: HTMLElement | null,
  choiceListContainerRef?: RefObject<HTMLElement | null>,
): boolean {
  if (isChatPromptElement(activeEl) && isChatPromptEffectivelyEmpty()) return true
  if (choiceListContainerRef?.current && activeEl && choiceListContainerRef.current.contains(activeEl)) return true
  const card = activeEl?.closest?.('[data-chat-composer-card]')
  if (card && activeEl?.closest?.('[role="listbox"]')) return true
  return false
}
