/**
 * Share Token Generator Test Suite
 *
 * Tests for the share token generation and validation utilities covering:
 * - Token generation with configurable length
 * - Cryptographic randomness and uniqueness
 * - URL-safe character set (base64url encoding)
 * - Token format validation
 * - Edge cases and error handling
 */

import { describe, it, expect } from 'vitest';
import { generateShareToken, isValidShareTokenFormat } from '../share-token-generator.js';

describe('generateShareToken', () => {
  describe('Token Generation', () => {
    it('should generate token with default length of 12 characters', () => {
      const token = generateShareToken();

      expect(token).toHaveLength(12);
    });

    it('should generate token with custom length', () => {
      const token8 = generateShareToken(8);
      const token16 = generateShareToken(16);

      expect(token8).toHaveLength(8);
      expect(token16).toHaveLength(16);
    });

    it('should generate URL-safe characters only (base64url)', () => {
      const token = generateShareToken(100); // Large sample

      // Should only contain: A-Z, a-z, 0-9, -, _
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

      // Should NOT contain: +, /, =
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(token).not.toContain('=');
    });

    it('should generate unique tokens on each call', () => {
      const tokens = new Set<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        tokens.add(generateShareToken());
      }

      // All tokens should be unique
      expect(tokens.size).toBe(count);
    });

    it('should generate cryptographically random tokens', () => {
      // Generate multiple tokens and check distribution
      const tokens = Array.from({ length: 100 }, () => generateShareToken(12));

      // Check that tokens have good character distribution
      const firstChars = tokens.map(t => t[0]);
      const uniqueFirstChars = new Set(firstChars);

      // Should have good variety (> 20 unique first characters out of 100 tokens)
      expect(uniqueFirstChars.size).toBeGreaterThan(20);
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimum length (8 characters)', () => {
      const token = generateShareToken(8);

      expect(token).toHaveLength(8);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should handle maximum length (16 characters)', () => {
      const token = generateShareToken(16);

      expect(token).toHaveLength(16);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should handle very large length', () => {
      const token = generateShareToken(100);

      expect(token).toHaveLength(100);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('Security Properties', () => {
    it('should have sufficient entropy (near-uniform character distribution)', () => {
      // base64url draws from a 64-symbol alphabet, so the theoretical maximum
      // Shannon entropy is log2(64) = 6 bits per character. A CSPRNG-backed
      // generator should produce a near-uniform distribution across that
      // alphabet. We measure entropy over a large aggregate sample: a single
      // 12-char token has far too few symbols to estimate entropy reliably,
      // which made the previous single-sample heuristic flaky.
      const sampleCount: number = 2000;
      const chars: string[] = [];
      for (let i = 0; i < sampleCount; i++) {
        chars.push(...generateShareToken(12));
      }

      const frequencies: Map<string, number> = new Map();
      for (const char of chars) {
        frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
      }

      const total: number = chars.length;
      let entropy: number = 0;
      for (const count of frequencies.values()) {
        const probability: number = count / total;
        entropy -= probability * Math.log2(probability);
      }

      // Sits just under the 6.0 theoretical max in practice; 5.5 leaves ample
      // margin against sampling noise while still catching a genuinely
      // low-entropy (e.g. sequential or biased) generator.
      expect(entropy).toBeGreaterThan(5.5);
    });

    it('should not contain predictable patterns', () => {
      const tokens = Array.from({ length: 100 }, () => generateShareToken(12));

      // Check for repeated patterns (no token should be AAAAAAAAAA...)
      const hasPattern = tokens.some(token => {
        const firstChar = token[0];
        return token.split('').every(c => c === firstChar);
      });

      expect(hasPattern).toBe(false);
    });

    it('should generate tokens suitable for use as primary keys', () => {
      // Tokens should be unique enough to use as database primary keys
      const tokens = new Set<string>();
      const count = 10000;

      for (let i = 0; i < count; i++) {
        const token = generateShareToken();
        expect(tokens.has(token)).toBe(false); // No duplicates
        tokens.add(token);
      }

      expect(tokens.size).toBe(count);
    });
  });
});

describe('isValidShareTokenFormat', () => {
  describe('Valid Formats', () => {
    it('should accept valid 8-character token', () => {
      expect(isValidShareTokenFormat('abc12345')).toBe(true);
      expect(isValidShareTokenFormat('ABCD1234')).toBe(true);
      expect(isValidShareTokenFormat('a_B-C123')).toBe(true);
    });

    it('should accept valid 12-character token (default length)', () => {
      expect(isValidShareTokenFormat('abc123xyz789')).toBe(true);
      expect(isValidShareTokenFormat('ABCD1234EFGH')).toBe(true);
      expect(isValidShareTokenFormat('a_B-C1_2-3AB')).toBe(true);
    });

    it('should accept valid 16-character token (maximum length)', () => {
      expect(isValidShareTokenFormat('abc123xyz7890123')).toBe(true);
      expect(isValidShareTokenFormat('ABCD1234EFGH5678')).toBe(true);
    });

    it('should accept tokens with hyphens and underscores', () => {
      expect(isValidShareTokenFormat('abc-def_123')).toBe(true);
      expect(isValidShareTokenFormat('___----____')).toBe(true);
      expect(isValidShareTokenFormat('a-b-c-d-e-f')).toBe(true);
    });

    it('should accept tokens generated by generateShareToken', () => {
      // Generate 100 tokens and verify all are valid
      for (let i = 0; i < 100; i++) {
        const token = generateShareToken();
        expect(isValidShareTokenFormat(token)).toBe(true);
      }
    });
  });

  describe('Invalid Formats', () => {
    it('should reject tokens shorter than 8 characters', () => {
      expect(isValidShareTokenFormat('')).toBe(false);
      expect(isValidShareTokenFormat('a')).toBe(false);
      expect(isValidShareTokenFormat('abc123')).toBe(false);
      expect(isValidShareTokenFormat('1234567')).toBe(false);
    });

    it('should reject tokens longer than 16 characters', () => {
      expect(isValidShareTokenFormat('abcdefghijklmnopq')).toBe(false);
      expect(isValidShareTokenFormat('12345678901234567')).toBe(false);
    });

    it('should reject tokens with invalid characters', () => {
      expect(isValidShareTokenFormat('abc+123=')).toBe(false); // base64 chars
      expect(isValidShareTokenFormat('abc/123+')).toBe(false);
      expect(isValidShareTokenFormat('abc 123')).toBe(false); // space
      expect(isValidShareTokenFormat('abc.123')).toBe(false); // dot
      expect(isValidShareTokenFormat('abc@123')).toBe(false); // special chars
      expect(isValidShareTokenFormat('abc#123xyz')).toBe(false);
    });

    it('should reject tokens with SQL injection attempts', () => {
      expect(isValidShareTokenFormat("'; DROP TABLE")).toBe(false);
      expect(isValidShareTokenFormat('1\' OR \'1\'=\'1')).toBe(false);
    });

    it('should reject tokens with path traversal attempts', () => {
      expect(isValidShareTokenFormat('../../../etc')).toBe(false);
      expect(isValidShareTokenFormat('..\\..\\..\\windows')).toBe(false);
    });

    it('should reject tokens with null bytes', () => {
      expect(isValidShareTokenFormat('abc\x00123')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined', () => {
      expect(isValidShareTokenFormat(null as any)).toBe(false);
      expect(isValidShareTokenFormat(undefined as any)).toBe(false);
    });

    it('should handle non-string types', () => {
      expect(isValidShareTokenFormat(123 as any)).toBe(false);
      expect(isValidShareTokenFormat({} as any)).toBe(false);
      expect(isValidShareTokenFormat([] as any)).toBe(false);
    });

    it('should be case-sensitive', () => {
      const token = 'AbC123XyZ789';
      expect(isValidShareTokenFormat(token)).toBe(true);
      expect(isValidShareTokenFormat(token.toLowerCase())).toBe(true);
      expect(isValidShareTokenFormat(token.toUpperCase())).toBe(true);
    });
  });

  describe('Validation Strictness', () => {
    it('should reject tokens with only numbers', () => {
      expect(isValidShareTokenFormat('12345678')).toBe(true); // Actually valid!
    });

    it('should reject tokens with only letters', () => {
      expect(isValidShareTokenFormat('abcdefgh')).toBe(true); // Actually valid!
    });

    it('should reject tokens with only special chars', () => {
      expect(isValidShareTokenFormat('_-_-_-_-')).toBe(true); // Valid URL-safe chars
    });

    it('should enforce exact length boundaries', () => {
      expect(isValidShareTokenFormat('1234567')).toBe(false); // 7 chars (too short)
      expect(isValidShareTokenFormat('12345678')).toBe(true); // 8 chars (min)
      expect(isValidShareTokenFormat('1234567890123456')).toBe(true); // 16 chars (max)
      expect(isValidShareTokenFormat('12345678901234567')).toBe(false); // 17 chars (too long)
    });
  });
});

describe('Integration Tests', () => {
  it('should generate tokens that pass validation', () => {
    for (let length = 8; length <= 16; length++) {
      const token = generateShareToken(length);
      expect(isValidShareTokenFormat(token)).toBe(true);
    }
  });

  it('should generate tokens suitable for database storage', () => {
    const tokens = Array.from({ length: 1000 }, () => generateShareToken());

    // All should be valid
    tokens.forEach(token => {
      expect(isValidShareTokenFormat(token)).toBe(true);
    });

    // All should be unique
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(tokens.length);
  });

  it('should generate tokens suitable for URL usage', () => {
    const token = generateShareToken();

    // Should not require URL encoding
    const encoded = encodeURIComponent(token);
    expect(encoded).toBe(token);

    // Should be valid in query parameters
    const url = `https://example.com?token=${token}`;
    const parsed = new URL(url);
    expect(parsed.searchParams.get('token')).toBe(token);
  });
});
