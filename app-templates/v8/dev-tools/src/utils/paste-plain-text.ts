import { htmlStringToDisplayText } from './text-fix-helpers';

/**
 * Extracts plain text from a paste's clipboard, discarding all markup.
 *
 * Inline editing commits whatever structure ends up in the editor. Pasting
 * from Word, Pages, Apple Notes, or email carries deeply nested spans with
 * inline styles and platform classes (e.g. `Apple-converted-space`), which
 * break the hover bar's editability detection once committed to source. By
 * inserting only the plain-text payload we strip that noise at the source —
 * see AIROBUILD-2429.
 */
export function getPlainTextFromClipboard(data: DataTransfer): string {
  const text = data.getData('text/plain');
  if (text) return text;
  // Some sources provide only text/html — derive its text content (mapping
  // <br> to newlines) so the paste isn't silently dropped.
  const html = data.getData('text/html');
  if (!html) return '';
  return htmlStringToDisplayText(html);
}
