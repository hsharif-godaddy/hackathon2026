import { describe, expect, it } from 'vitest';

import {
  isBlockedFetchHostname,
  resolvePublicHttpsFetchUrl,
  validatePublicHttpsFetchUrl,
} from '../public-fetch-url.js';

describe('public-fetch-url', function packageTests() {
  describe('#isBlockedFetchHostname', function blockedHostTests() {
    it('blocks localhost', function localhost() {
      expect(isBlockedFetchHostname('localhost')).toBe(true);
    });

    it('blocks loopback IP', function loopback() {
      expect(isBlockedFetchHostname('127.0.0.1')).toBe(true);
    });

    it('blocks metadata endpoint', function metadata() {
      expect(isBlockedFetchHostname('169.254.169.254')).toBe(true);
    });

    it('allows public hostnames', function publicHost() {
      expect(isBlockedFetchHostname('example.com')).toBe(false);
    });
  });

  describe('#validatePublicHttpsFetchUrl', function validateTests() {
    it('accepts valid https URLs', function validHttps() {
      const result = validatePublicHttpsFetchUrl('https://my-app.test-airoapp.ai/');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url.hostname).toBe('my-app.test-airoapp.ai');
      }
    });

    it('rejects http', function rejectHttp() {
      const result = validatePublicHttpsFetchUrl('http://example.com/');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('https required');
    });

    it('rejects private hosts', function rejectPrivate() {
      const result = validatePublicHttpsFetchUrl('https://10.0.0.1/');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('hostname not allowed');
    });
  });

  describe('#resolvePublicHttpsFetchUrl', function resolveTests() {
    it('prefers the first valid candidate', function firstValid() {
      expect(
        resolvePublicHttpsFetchUrl('https://db.example.com/', 'https://body.example.com/'),
      ).toBe('https://db.example.com');
    });

    it('falls back to the next valid candidate', function fallback() {
      expect(
        resolvePublicHttpsFetchUrl('http://bad.example.com/', 'https://good.example.com/'),
      ).toBe('https://good.example.com');
    });

    it('returns null when all candidates are invalid', function allInvalid() {
      expect(
        resolvePublicHttpsFetchUrl('https://127.0.0.1/', 'ftp://example.com/'),
      ).toBe(null);
    });
  });
});
