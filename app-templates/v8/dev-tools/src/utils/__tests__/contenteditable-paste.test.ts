/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { insertPlainTextOnPaste } from '../contenteditable-paste';

function makeClipboardEvent(data: Record<string, string> | null) {
  let prevented = false;
  return {
    clipboardData: data === null ? null : { getData: (type: string): string => data[type] ?? '' },
    preventDefault() {
      prevented = true;
    },
    wasPrevented: () => prevented,
  };
}

function setupEditable(initial: string): HTMLElement {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.textContent = initial;
  document.body.appendChild(el);
  return el;
}

function placeCaretAtEnd(el: HTMLElement): void {
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectAllContents(el: HTMLElement): void {
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('insertPlainTextOnPaste', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  it('prevents the default browser paste', () => {
    const el = setupEditable('hello');
    placeCaretAtEnd(el);
    const event = makeClipboardEvent({ 'text/plain': 'x' });
    insertPlainTextOnPaste(event as unknown as ClipboardEvent);
    expect(event.wasPrevented()).toBe(true);
  });

  it('inserts plain text at the caret', () => {
    const el = setupEditable('hello ');
    placeCaretAtEnd(el);
    insertPlainTextOnPaste(makeClipboardEvent({ 'text/plain': 'world' }) as unknown as ClipboardEvent);
    expect(el.textContent).toBe('hello world');
  });

  it('replaces the selected range with the pasted text', () => {
    const el = setupEditable('REPLACE ME');
    selectAllContents(el);
    insertPlainTextOnPaste(makeClipboardEvent({ 'text/plain': 'clean' }) as unknown as ClipboardEvent);
    expect(el.textContent).toBe('clean');
  });

  it('inserts only text content, no markup, from an HTML-only paste', () => {
    const el = setupEditable('');
    placeCaretAtEnd(el);
    insertPlainTextOnPaste(
      makeClipboardEvent({
        'text/html': '<span style="color:red">a <b>b</b></span><span class="Apple-converted-space"> </span>',
      }) as unknown as ClipboardEvent,
    );
    expect(el.textContent).toBe('a b ');
    expect(el.querySelector('span, b')).toBeNull();
  });

  it('preserves the selection and inserts nothing for a non-text (e.g. image) paste', () => {
    const el = setupEditable('keepme');
    selectAllContents(el);
    // clipboardData is present but has neither text/plain nor text/html (image-only).
    const event = makeClipboardEvent({});
    insertPlainTextOnPaste(event as unknown as ClipboardEvent);
    expect(el.textContent).toBe('keepme'); // selected text must NOT be destroyed
    expect(event.wasPrevented()).toBe(true); // non-text paste is blocked, not inserted
  });

  it('does nothing when the event carries no clipboard data', () => {
    const el = setupEditable('untouched');
    placeCaretAtEnd(el);
    const event = makeClipboardEvent(null);
    insertPlainTextOnPaste(event as unknown as ClipboardEvent);
    expect(event.wasPrevented()).toBe(false);
    expect(el.textContent).toBe('untouched');
  });
});
