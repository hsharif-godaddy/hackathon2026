/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { getPlainTextFromClipboard } from '../paste-plain-text';

// Minimal stand-in for the parts of DataTransfer the helper touches. Mirrors
// the makeTargetWindow pattern in postMessage.test.ts — we only need getData.
function makeClipboard(data: Record<string, string>): DataTransfer {
  return {
    getData: (type: string): string => data[type] ?? '',
  } as unknown as DataTransfer;
}

describe('getPlainTextFromClipboard', () => {
  it('returns the text/plain payload verbatim', () => {
    const clipboard = makeClipboard({ 'text/plain': 'Best known for my vibrant personality' });
    expect(getPlainTextFromClipboard(clipboard)).toBe('Best known for my vibrant personality');
  });

  it('preserves newlines in the text/plain payload', () => {
    const clipboard = makeClipboard({ 'text/plain': 'line one\nline two' });
    expect(getPlainTextFromClipboard(clipboard)).toBe('line one\nline two');
  });

  it('falls back to the text content of text/html when no text/plain is present', () => {
    const clipboard = makeClipboard({
      'text/html':
        '<span style="font-family:Calibri;font-size:14.6667px">Best known for ' +
        'my <strong>vibrant</strong> personality<span class="Apple-converted-space"> </span></span>',
    });
    expect(getPlainTextFromClipboard(clipboard)).toBe('Best known for my vibrant personality ');
  });

  it('converts <br> to a newline when extracting text from text/html', () => {
    const clipboard = makeClipboard({ 'text/html': 'line one<br>line two' });
    expect(getPlainTextFromClipboard(clipboard)).toBe('line one\nline two');
  });

  it('returns an empty string when the clipboard has neither text/plain nor text/html', () => {
    const clipboard = makeClipboard({});
    expect(getPlainTextFromClipboard(clipboard)).toBe('');
  });

  it('prefers text/plain over text/html when both are present', () => {
    const clipboard = makeClipboard({
      'text/plain': 'clean text',
      'text/html': '<span style="color:red">noisy <b>html</b></span>',
    });
    expect(getPlainTextFromClipboard(clipboard)).toBe('clean text');
  });
});
