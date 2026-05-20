/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  extractDisplayText,
  htmlStringToDisplayText,
  isWhitespaceOnlyChange,
  wrapInnerHtml,
  makeFixRequestId,
} from '../utils/text-fix-helpers';

describe('text-fix-helpers', () => {
  describe('extractDisplayText / htmlStringToDisplayText', () => {
    it('flattens nested inline elements to plain text', () => {
      expect(htmlStringToDisplayText('Welome to <strong>teh</strong> future'))
        .toBe('Welome to teh future');
    });

    it('treats <br> as newline', () => {
      expect(htmlStringToDisplayText('Line one<br>Line two')).toBe('Line one\nLine two');
    });

    it('returns empty string for empty input', () => {
      expect(htmlStringToDisplayText('')).toBe('');
    });
  });

  describe('isWhitespaceOnlyChange', () => {
    it('returns true for identical input', () => {
      expect(isWhitespaceOnlyChange('hello world', 'hello world')).toBe(true);
    });

    it('returns true when only whitespace runs differ', () => {
      expect(isWhitespaceOnlyChange('hello  world', 'hello world')).toBe(true);
      expect(isWhitespaceOnlyChange(' hello world ', 'hello world')).toBe(true);
    });

    it('returns false for substantive text changes', () => {
      expect(isWhitespaceOnlyChange('teh quick fox', 'the quick fox')).toBe(false);
    });

    it('ignores tag-only differences when display text matches', () => {
      // <strong>teh</strong> → <em>teh</em> — display text is "teh" both
      // times, so this counts as whitespace-only-equivalent. The tag-set
      // defense in the agent catches genuine tag introductions.
      expect(isWhitespaceOnlyChange('<strong>teh</strong>', '<em>teh</em>')).toBe(true);
    });
  });

  describe('wrapInnerHtml', () => {
    it('wraps content in the given tag with class attribute', () => {
      expect(wrapInnerHtml('hello', 'p', 'text-lg font-bold'))
        .toBe('<p class="text-lg font-bold">hello</p>');
    });

    it('omits class attribute when empty', () => {
      expect(wrapInnerHtml('hi', 'span', '')).toBe('<span>hi</span>');
    });

    it('escapes double quotes in class attribute', () => {
      expect(wrapInnerHtml('x', 'p', 'a"b')).toContain('class="a&quot;b"');
    });
  });

  describe('makeFixRequestId', () => {
    it('returns a non-empty string', () => {
      const id = makeFixRequestId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('returns distinct ids on successive calls', () => {
      const a = makeFixRequestId();
      const b = makeFixRequestId();
      expect(a).not.toBe(b);
    });
  });

  describe('extractDisplayText (DOM API)', () => {
    it('handles a real DOM node tree', () => {
      const div = document.createElement('div');
      div.innerHTML = 'Fresh from <strong>the the</strong><br>Gardens';
      expect(extractDisplayText(div)).toBe('Fresh from the the\nGardens');
    });
  });
});
