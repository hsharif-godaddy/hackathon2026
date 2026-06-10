/**
 * @vitest-environment jsdom
 */


import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { ITC_STORAGE_KEY, ITC_TTL_MS } from './constants';
import {
  clearItcOverride,
  getEffectiveItc,
  getItcOverride,
  setItcOverride,
  validateItc,
} from './storage';

describe('validateItc', function validateItcTests() {
  it('accepts alphanumeric, underscore, hyphen', () => {
    expect(validateItc('email')).toBe('email');
    expect(validateItc('email_AAB-1')).toBe('email_AAB-1');
  });

  it('trims surrounding whitespace', () => {
    expect(validateItc('  email  ')).toBe('email');
  });

  it('returns null for null, undefined, and empty/whitespace input', () => {
    expect(validateItc(null)).toBeNull();
    expect(validateItc(undefined)).toBeNull();
    expect(validateItc('')).toBeNull();
    expect(validateItc('   ')).toBeNull();
  });

  it('rejects over-length and disallowed characters rather than stripping', () => {
    expect(validateItc('a'.repeat(129))).toBeNull();
    expect(validateItc('email source')).toBeNull(); // space
    expect(validateItc('email.source')).toBeNull(); // dot
  });
});

describe('lib/itc/storage', function itcStorageTests() {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Reset date mock
    vi.useRealTimers();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  describe('setItcOverride', function setItcOverrideTests() {
    it('should store ITC with expiration in localStorage', function storesWithExpiration() {
      const testItc = 'test-campaign-123';
      vi.useFakeTimers();
      const now = new Date('2024-01-15T12:00:00Z').getTime();
      vi.setSystemTime(now);

      setItcOverride(testItc);

      const stored = JSON.parse(localStorage.getItem(ITC_STORAGE_KEY) || '{}');
      expect(stored.value).toBe(testItc);
      expect(stored.expiresAt).toBe(now + ITC_TTL_MS);
    });

    it('should allow custom TTL', function customTtl() {
      const testItc = 'test-campaign';
      const customTtl = 1000 * 60 * 60; // 1 hour
      vi.useFakeTimers();
      const now = new Date('2024-01-15T12:00:00Z').getTime();
      vi.setSystemTime(now);

      setItcOverride(testItc, customTtl);

      const stored = JSON.parse(localStorage.getItem(ITC_STORAGE_KEY) || '{}');
      expect(stored.expiresAt).toBe(now + customTtl);
    });

    it('should overwrite existing ITC', function overwritesExisting() {
      setItcOverride('first-campaign');
      setItcOverride('second-campaign');

      const stored = JSON.parse(localStorage.getItem(ITC_STORAGE_KEY) || '{}');
      expect(stored.value).toBe('second-campaign');
    });

    it('should trim whitespace from ITC', function trimsWhitespace() {
      setItcOverride('  campaign-123  ');

      const stored = JSON.parse(localStorage.getItem(ITC_STORAGE_KEY) || '{}');
      expect(stored.value).toBe('campaign-123');
    });

    it('should reject empty ITC', function rejectsEmpty() {
      setItcOverride('');
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();

      setItcOverride('   ');
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should reject ITC with invalid characters', function rejectsInvalidChars() {
      setItcOverride('campaign<script>');
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();

      setItcOverride('campaign with spaces');
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should reject ITC exceeding max length', function rejectsLongItc() {
      const longItc = 'a'.repeat(129);
      setItcOverride(longItc);
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should accept valid ITC with underscores and hyphens', function acceptsValidChars() {
      setItcOverride('valid_campaign-123');

      const stored = JSON.parse(localStorage.getItem(ITC_STORAGE_KEY) || '{}');
      expect(stored.value).toBe('valid_campaign-123');
    });
  });

  describe('getItcOverride', function getItcOverrideTests() {
    it('should return stored ITC when valid', function returnsValidItc() {
      const testItc = 'test-campaign';
      setItcOverride(testItc);

      expect(getItcOverride()).toBe(testItc);
    });

    it('should return null when no ITC stored', function returnsNullWhenEmpty() {
      expect(getItcOverride()).toBeNull();
    });

    it('should return null and clear when ITC is expired', function clearsExpiredItc() {
      vi.useFakeTimers();
      const now = new Date('2024-01-15T12:00:00Z').getTime();
      vi.setSystemTime(now);

      // Store with default TTL
      setItcOverride('expired-campaign');

      // Advance time past expiration
      vi.setSystemTime(now + ITC_TTL_MS + 1000);

      expect(getItcOverride()).toBeNull();
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should return null and clear on invalid JSON', function clearsInvalidJson() {
      localStorage.setItem(ITC_STORAGE_KEY, 'invalid-json');

      expect(getItcOverride()).toBeNull();
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should return null and clear when stored value is missing', function clearsMissingValue() {
      localStorage.setItem(ITC_STORAGE_KEY, JSON.stringify({ expiresAt: Date.now() + 10000 }));

      expect(getItcOverride()).toBeNull();
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should return null and clear when expiresAt is missing', function clearsMissingExpiry() {
      localStorage.setItem(ITC_STORAGE_KEY, JSON.stringify({ value: 'test' }));

      expect(getItcOverride()).toBeNull();
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should return null and clear when expiresAt is NaN', function clearsNaNExpiry() {
      localStorage.setItem(ITC_STORAGE_KEY, JSON.stringify({ value: 'test', expiresAt: NaN }));

      expect(getItcOverride()).toBeNull();
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should return null and clear when stored is not an object', function clearsNonObject() {
      localStorage.setItem(ITC_STORAGE_KEY, JSON.stringify('just a string'));

      expect(getItcOverride()).toBeNull();
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });
  });

  describe('clearItcOverride', function clearItcOverrideTests() {
    it('should remove ITC from localStorage', function removesItc() {
      setItcOverride('test-campaign');
      expect(localStorage.getItem(ITC_STORAGE_KEY)).not.toBeNull();

      clearItcOverride();
      expect(localStorage.getItem(ITC_STORAGE_KEY)).toBeNull();
    });

    it('should not throw when no ITC stored', function noThrowWhenEmpty() {
      expect(() => clearItcOverride()).not.toThrow();
    });
  });

  describe('getEffectiveItc', function getEffectiveItcTests() {
    it('should return override when stored', function returnsOverride() {
      const override = 'campaign-override';
      setItcOverride(override);

      expect(getEffectiveItc('PUBLISH')).toBe(override);
      expect(getEffectiveItc('UPGRADE')).toBe(override);
      expect(getEffectiveItc('CREDITS')).toBe(override);
    });

    it('should return default PAYWALL_ITC when no override', function returnsDefaults() {
      expect(getEffectiveItc('PUBLISH')).toBe(PAYWALL_ITC.PUBLISH);
      expect(getEffectiveItc('UPGRADE')).toBe(PAYWALL_ITC.UPGRADE);
      expect(getEffectiveItc('CREDITS')).toBe(PAYWALL_ITC.CREDITS);
    });

    it('should return default when override is expired', function returnsDefaultWhenExpired() {
      vi.useFakeTimers();
      const now = new Date('2024-01-15T12:00:00Z').getTime();
      vi.setSystemTime(now);

      setItcOverride('expired-override');

      // Advance past expiration
      vi.setSystemTime(now + ITC_TTL_MS + 1000);

      expect(getEffectiveItc('UPGRADE')).toBe(PAYWALL_ITC.UPGRADE);
    });
  });
});
