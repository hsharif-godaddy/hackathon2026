import { describe, expect, it } from 'vitest';

import {
  getByteLength,
  MAX_PROMPT_BYTES,
  truncateToByteLimit,
  validateAndClampPrompt,
} from '../waf-validation';

describe('waf-validation', () => {
  describe('getByteLength', () => {
    it('should return correct byte length for ASCII text', () => {
      expect(getByteLength('hello')).toBe(5);
      expect(getByteLength('test123')).toBe(7);
    });

    it('should return correct byte length for Unicode characters', () => {
      expect(getByteLength('café')).toBe(5); // é is 2 bytes
      expect(getByteLength('こんにちは')).toBe(15); // 5 chars × 3 bytes each
    });

    it('should return correct byte length for emojis', () => {
      expect(getByteLength('👋')).toBe(4);
      expect(getByteLength('🌐🏠👤')).toBe(12); // 3 emojis × 4 bytes each
    });

    it('should handle empty string', () => {
      expect(getByteLength('')).toBe(0);
    });

    it('should handle mixed content', () => {
      const text = 'Hello 世界 🌍'; // ASCII + CJK + emoji
      expect(getByteLength(text)).toBe(17); // 6 + 6 + 4 + 1 = 17
    });
  });

  describe('truncateToByteLimit', () => {
    it('should not truncate text within limit', () => {
      const text = 'a'.repeat(100);
      expect(truncateToByteLimit(text, 200)).toBe(text);
    });

    it('should truncate ASCII text at byte boundary', () => {
      const text = 'a'.repeat(100);
      const truncated = truncateToByteLimit(text, 50);
      expect(truncated.length).toBe(50);
      expect(getByteLength(truncated)).toBe(50);
    });

    it('should truncate multi-byte characters correctly', () => {
      const text = '🌐'.repeat(100); // 400 bytes
      const truncated = truncateToByteLimit(text, 50);
      // Should truncate to 12 emojis (48 bytes) to stay under 50 bytes
      expect(getByteLength(truncated)).toBeLessThanOrEqual(50);
    });

    it('should handle mixed ASCII and emoji', () => {
      const text = 'Hello 👋 World 🌍!';
      const truncated = truncateToByteLimit(text, 15);
      expect(getByteLength(truncated)).toBeLessThanOrEqual(15);
      // Should not cut emoji in half
      expect(truncated).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    it('should use default MAX_PROMPT_BYTES if no limit provided', () => {
      const text = 'a'.repeat(MAX_PROMPT_BYTES + 1000);
      const truncated = truncateToByteLimit(text);
      expect(getByteLength(truncated)).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    });

    it('should return empty string if limit is 0', () => {
      expect(truncateToByteLimit('hello', 0)).toBe('');
    });

    it('should not leave unpaired high surrogates at boundary', () => {
      // Create a string where truncation might split a surrogate pair
      // '💩' is 4 bytes (U+1F4A9), encoded as surrogate pair 0xD83D 0xDCA9
      const text = 'a'.repeat(100) + '💩💩💩';
      const truncated = truncateToByteLimit(text, 105); // Might cut in middle of emoji

      // Should not end with unpaired high surrogate (0xD800-0xDBFF)
      if (truncated.length > 0) {
        const lastCharCode = truncated.charCodeAt(truncated.length - 1);
        expect(lastCharCode < 0xD800 || lastCharCode > 0xDBFF).toBe(true);
      }

      // Verify the string is valid UTF-16
      expect(() => new TextEncoder().encode(truncated)).not.toThrow();
      expect(getByteLength(truncated)).toBeLessThanOrEqual(105);
    });

    it('should not produce unpaired surrogates when limit is smaller than an emoji', () => {
      const text = 'a👋b'; // ASCII + emoji (4 bytes) + ASCII

      for (const limit of [1, 2, 3]) {
        const truncated = truncateToByteLimit(text, limit);

        expect(getByteLength(truncated)).toBeLessThanOrEqual(limit);
        // Should not introduce replacement characters (U+FFFD)
        expect(truncated).not.toContain('\uFFFD');
        // Should not contain unpaired high surrogates
        expect(truncated).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
        // Should not contain unpaired low surrogates
        expect(truncated).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      }
    });
  });

  describe('validateAndClampPrompt', () => {
    it('should return valid for text within limit', () => {
      const text = 'a'.repeat(1000);
      const result = validateAndClampPrompt(text);

      expect(result.text).toBe(text);
      expect(result.isValid).toBe(true);
      expect(result.wasClipped).toBe(false);
      expect(result.charLength).toBe(1000);
      expect(result.byteLength).toBe(1000);
      expect(result.remainingChars).toBeGreaterThan(0);
    });

    it('should clamp text exceeding byte limit', () => {
      const text = 'a'.repeat(MAX_PROMPT_BYTES + 1000);
      const result = validateAndClampPrompt(text);

      expect(result.text.length).toBeLessThan(text.length);
      expect(result.wasClipped).toBe(true);
      expect(result.byteLength).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
      expect(result.remainingChars).toBe(0);
    });

    it('should handle emoji-heavy text', () => {
      // Emojis are 4 bytes each, so this is ~8000 bytes
      const text = '🌐'.repeat(2000);
      const result = validateAndClampPrompt(text);

      expect(result.wasClipped).toBe(true);
      expect(result.byteLength).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
      // Verify no partial emoji sequences
      expect(result.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    it('should return 0 remaining chars when at limit', () => {
      // Create text exactly at limit
      const text = 'a'.repeat(MAX_PROMPT_BYTES);
      const result = validateAndClampPrompt(text);

      expect(result.remainingChars).toBe(0);
      expect(result.wasClipped).toBe(false);
    });

    it('should estimate remaining characters correctly', () => {
      const text = 'hello';
      const result = validateAndClampPrompt(text);

      // Should estimate remaining characters based on 1.2 bytes per char average
      const expectedRemaining = Math.floor((MAX_PROMPT_BYTES - 5) / 1.2);
      expect(result.remainingChars).toBe(expectedRemaining);
    });

    it('should handle empty string', () => {
      const result = validateAndClampPrompt('');

      expect(result.text).toBe('');
      expect(result.isValid).toBe(true);
      expect(result.wasClipped).toBe(false);
      expect(result.charLength).toBe(0);
      expect(result.byteLength).toBe(0);
      expect(result.remainingChars).toBeGreaterThan(0);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle prompt within 7.4KB limit', () => {
      // 7000 ASCII chars = 7000 bytes, well within limit
      const text = 'a'.repeat(7000);
      const result = validateAndClampPrompt(text);

      expect(result.wasClipped).toBe(false);
      expect(result.isValid).toBe(true);
      expect(result.byteLength).toBe(7000);
    });

    it('should handle prompt exceeding 7.4KB limit', () => {
      // 8092 ASCII chars = 8092 bytes, exceeds limit
      const text = 'a'.repeat(8092);
      const result = validateAndClampPrompt(text);

      // Should be clipped to stay within limit
      expect(result.wasClipped).toBe(true);
      expect(result.byteLength).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
      expect(result.byteLength).toBe(MAX_PROMPT_BYTES);
    });

    it('should handle mixed content with various encodings', () => {
      // Simulate realistic prompt with ASCII, Unicode, and emojis
      const text = `
Create a website for my business! 🚀

# About Us
We're a café ☕ serving the best coffee in Tokyo 東京.

# Features:
- Online ordering 🛍️
- Location map 🗺️
- Gallery 📷

# Contact:
Email: hello@café.com
Phone: +1-555-0123
      `.repeat(100); // Repeat to exceed limit

      const result = validateAndClampPrompt(text);

      expect(result.byteLength).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
      expect(result.isValid).toBe(false); // Original text exceeded limit
      expect(result.wasClipped).toBe(true); // Should have been clipped
      // Verify no broken multibyte sequences
      expect(() => new TextEncoder().encode(result.text)).not.toThrow();
    });
  });
});
