import { describe, it, expect } from 'vitest';

import { SitemapDiscoveryService } from '../SitemapDiscoveryService.js';

describe('SitemapDiscoveryService', () => {
  describe('normalizeUrl', () => {
    function normalize(url: string): string {
      const service = new SitemapDiscoveryService('https://example.com');
      return (service as any).normalizeUrl(url);
    }

    it('strips query parameters', () => {
      expect(normalize('https://example.com/page?utm_source=google&utm_medium=local'))
        .toBe('https://example.com/page');
    });

    it('strips hash fragments', () => {
      expect(normalize('https://example.com/page#section'))
        .toBe('https://example.com/page');
    });

    it('strips trailing slash', () => {
      expect(normalize('https://example.com/page/'))
        .toBe('https://example.com/page');
    });

    it('strips all three: query, hash, and trailing slash', () => {
      expect(normalize('https://example.com/page/?foo=bar#top'))
        .toBe('https://example.com/page');
    });

    it('preserves path without query or hash', () => {
      expect(normalize('https://example.com/about'))
        .toBe('https://example.com/about');
    });

    it('handles root URL (pathname becomes empty, URL keeps trailing slash)', () => {
      const result = normalize('https://example.com/');
      expect(result).toBe('https://example.com/');
    });

    it('returns original string for malformed URLs', () => {
      expect(normalize('not-a-url')).toBe('not-a-url');
    });
  });
});
