import { describe, it, expect } from 'vitest';

import {
  MAX_ASSISTANT_TOOL_MESSAGE_CONTENT_LENGTH,
  MAX_USER_MESSAGE_CONTENT_LENGTH,
  truncateContent,
} from '../summarization-guards.js';

describe('summarization-guards', () => {
  describe('#truncateContent', () => {
    it('returns empty string for null input', () => {
      expect(truncateContent(null, MAX_USER_MESSAGE_CONTENT_LENGTH)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(truncateContent(undefined, MAX_USER_MESSAGE_CONTENT_LENGTH)).toBe('');
    });

    it('returns empty string for empty string input', () => {
      expect(truncateContent('', MAX_USER_MESSAGE_CONTENT_LENGTH)).toBe('');
    });

    it('returns content unchanged when under the limit', () => {
      expect(truncateContent('short message', MAX_USER_MESSAGE_CONTENT_LENGTH)).toBe('short message');
    });

    it('returns content unchanged at exactly the limit', () => {
      const exact = 'x'.repeat(MAX_USER_MESSAGE_CONTENT_LENGTH);
      expect(truncateContent(exact, MAX_USER_MESSAGE_CONTENT_LENGTH)).toBe(exact);
    });

    it('truncates content exceeding the limit and appends marker', () => {
      const oversized = 'a'.repeat(MAX_USER_MESSAGE_CONTENT_LENGTH + 500);
      const result = truncateContent(oversized, MAX_USER_MESSAGE_CONTENT_LENGTH);

      expect(result.length).toBeLessThan(oversized.length);
      expect(result.endsWith('\n[...truncated]')).toBe(true);
      expect(result.slice(0, MAX_USER_MESSAGE_CONTENT_LENGTH)).toBe('a'.repeat(MAX_USER_MESSAGE_CONTENT_LENGTH));
    });

    it('preserves exactly maxLength characters of original content', () => {
      const content = 'abcdefghij'.repeat(1000);
      const result = truncateContent(content, MAX_USER_MESSAGE_CONTENT_LENGTH);
      const withoutMarker = result.replace('\n[...truncated]', '');

      expect(withoutMarker.length).toBe(MAX_USER_MESSAGE_CONTENT_LENGTH);
    });

    it('allows longer strings when using assistant/tool limit', () => {
      const between = 'z'.repeat(MAX_USER_MESSAGE_CONTENT_LENGTH + 5_000);
      const result = truncateContent(between, MAX_ASSISTANT_TOOL_MESSAGE_CONTENT_LENGTH);

      expect(result).toBe(between);
      expect(result).not.toContain('[...truncated]');
    });
  });
});
