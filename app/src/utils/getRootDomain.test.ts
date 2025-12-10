import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getRootDomain } from './getRootDomain';

describe('getRootDomain', () => {
  const originalWindow = global.window;

  afterEach(() => {
    // Restore window after each test
    global.window = originalWindow;
  });

  describe('server-side rendering', () => {
    it('should return null when window is undefined', () => {
      // @ts-expect-error - Intentionally setting window to undefined
      global.window = undefined;
      expect(getRootDomain()).toBeNull();
    });
  });

  describe('client-side with valid hostnames', () => {
    it('should extract root domain from subdomain', () => {
      global.window = {
        location: { hostname: 'airo-builder.test-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('test-godaddy.com');
    });

    it('should extract root domain from simple subdomain', () => {
      global.window = {
        location: { hostname: 'www.example.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example.com');
    });

    it('should extract root domain from multi-level subdomain', () => {
      global.window = {
        location: { hostname: 'api.staging.example.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example.com');
    });

    it('should handle root domain without subdomain', () => {
      global.window = {
        location: { hostname: 'example.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example.com');
    });

    it('should handle .org TLD', () => {
      global.window = {
        location: { hostname: 'subdomain.example.org' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example.org');
    });

    it('should handle .net TLD', () => {
      global.window = {
        location: { hostname: 'app.example.net' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example.net');
    });

    it('should handle hyphenated domains', () => {
      global.window = {
        location: { hostname: 'app.my-domain.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('my-domain.com');
    });

    it('should handle deeply nested subdomains', () => {
      global.window = {
        location: { hostname: 'a.b.c.d.example.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example.com');
    });
  });

  describe('ote to stg replacement', () => {
    it('should replace "ote" with "stg" in root domain', () => {
      global.window = {
        location: { hostname: 'airo-builder.test-godaddy-ote.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('test-godaddy-stg.com');
    });

    it('should replace "ote" in domain name', () => {
      global.window = {
        location: { hostname: 'app.example-ote.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example-stg.com');
    });

    it('should not replace "ote" when not present', () => {
      global.window = {
        location: { hostname: 'app.example.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example.com');
    });

    it('should handle multiple "ote" occurrences', () => {
      global.window = {
        location: { hostname: 'app.ote-domain-ote.com' },
      } as Window & typeof globalThis;

      // Note: replace() only replaces first occurrence
      expect(getRootDomain()).toBe('stg-domain-ote.com');
    });

    it('should replace "ote" in TLD part', () => {
      global.window = {
        location: { hostname: 'app.example-note.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example-nstg.com');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for localhost', () => {
      global.window = {
        location: { hostname: 'localhost' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('');
    });

    it('should return empty string for single word hostname', () => {
      global.window = {
        location: { hostname: 'singleword' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('');
    });

    it('should handle IP addresses', () => {
      global.window = {
        location: { hostname: '192.168.1.1' },
      } as Window & typeof globalThis;

      // IP addresses won't match the domain pattern
      expect(getRootDomain()).toBe('1.1');
    });

    it('should handle domains with numbers', () => {
      global.window = {
        location: { hostname: 'app.example123.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('example123.com');
    });

    it('should handle domains starting with numbers', () => {
      global.window = {
        location: { hostname: 'app.123example.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('123example.com');
    });
  });

  describe('real-world examples', () => {
    it('should handle godaddy.com domain', () => {
      global.window = {
        location: { hostname: 'airo.godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('godaddy.com');
    });

    it('should handle test-godaddy.com domain', () => {
      global.window = {
        location: { hostname: 'airo-builder.test-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('test-godaddy.com');
    });

    it('should handle secureserver.net domain', () => {
      global.window = {
        location: { hostname: 'app.secureserver.net' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('secureserver.net');
    });

    it('should transform ote environment to stg', () => {
      global.window = {
        location: { hostname: 'airo-builder.ote-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('stg-godaddy.com');
    });
  });

  describe('consistency', () => {
    it('should return consistent results for same hostname', () => {
      global.window = {
        location: { hostname: 'app.example.com' },
      } as Window & typeof globalThis;

      const result1 = getRootDomain();
      const result2 = getRootDomain();

      expect(result1).toBe(result2);
      expect(result1).toBe('example.com');
    });
  });
});
