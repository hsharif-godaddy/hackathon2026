import { getPlainTextFromClipboard } from './paste-plain-text';

/**
 * Paste handler for the legacy contentEditable editing path: replaces the
 * clipboard's rich markup with plain text inserted at the caret, so inline
 * styles and nested spans from Word, Pages, Apple Notes, or email never enter
 * the edited element (AIROBUILD-2429).
 */
export function insertPlainTextOnPaste(event: ClipboardEvent): void {
  if (!event.clipboardData) return;
  event.preventDefault();
  const text = getPlainTextFromClipboard(event.clipboardData);
  // No plain text to insert (e.g. an image-only paste). Bail before mutating —
  // deleteContents() here would destroy the user's selection for nothing.
  if (!text) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  range.deleteContents(); // replace any selected text
  const node = document.createTextNode(text);
  range.insertNode(node);

  // Place the caret immediately after the inserted text.
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
